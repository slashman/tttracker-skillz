import { TrackerError } from './errors.mjs'
import {
  entryEndMs,
  entryStartMs,
  findOpenEntries,
  listAllDayKeys,
  maybeAutoCommit,
  newId,
  readDay,
  writeDay,
} from './store.mjs'
import { resolveProject } from './projects.mjs'
import { assertNotFuture, localDateKey, minutesBetween, parseAt, toLocalISO } from './time.mjs'

// How close to the resume instant an entry's end has to be to read as "I just stopped that",
// generous enough to cover a stop and a resume typed as two commands in the same breath.
const JUST_STOPPED_MS = 2 * 60 * 1000

function parseTags(spec) {
  if (!spec) return []
  return String(spec)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function parseLinks(specs) {
  const links = {}
  for (const spec of specs ?? []) {
    const idx = String(spec).indexOf('=')
    if (idx <= 0) {
      throw new TrackerError(`--link must look like key=value, got: ${spec}`, { hint: 'For example --link linear=ENG-412.' })
    }
    links[String(spec).slice(0, idx).trim()] = String(spec).slice(idx + 1).trim()
  }
  return links
}

function resolveAt(cfg, at, nowDate, { allowFuture = false, flag = '--at' } = {}) {
  if (!at) return nowDate.getTime()
  const parsed = parseAt(at, { tz: cfg.tz, nowDate })
  if (!allowFuture) assertNotFuture(parsed, { nowDate, flag })
  return parsed.ms
}

function describe(entry) {
  return `${entry.id} ${entry.project}: ${entry.task}`
}

/**
 * Never guesses. A query that matches nothing, or more than one thing, is an error
 * that lists the candidates - with concurrent work being normal, silently picking
 * one would stop the wrong task.
 */
function matchOne(candidates, query, { what = 'entry' } = {}) {
  const q = String(query).trim().toLowerCase()
  if (!q) throw new TrackerError(`no ${what} query given`)

  const byId = candidates.filter(({ entry }) => entry.id.toLowerCase() === q)
  if (byId.length === 1) return byId[0]

  const byIdPrefix = candidates.filter(({ entry }) => entry.id.toLowerCase().startsWith(q))
  if (byIdPrefix.length === 1) return byIdPrefix[0]

  const bySubstring = candidates.filter(
    ({ entry }) => entry.task.toLowerCase().includes(q) || String(entry.project).toLowerCase().includes(q),
  )
  if (bySubstring.length === 1) return bySubstring[0]

  if (bySubstring.length === 0 && byIdPrefix.length === 0) {
    throw new TrackerError(`no ${what} matches "${query}"`, {
      hint: candidates.length
        ? `Candidates: ${candidates.map(({ entry }) => describe(entry)).join(' | ')}`
        : 'Nothing is running.',
    })
  }

  const ambiguous = bySubstring.length ? bySubstring : byIdPrefix
  throw new TrackerError(`"${query}" matches ${ambiguous.length} entries`, {
    hint: `Be more specific, or use an id: ${ambiguous.map(({ entry }) => describe(entry)).join(' | ')}`,
    data: { candidates: ambiguous.map(({ entry }) => entry) },
  })
}

function findById(cfg, id) {
  const wanted = String(id).trim().toLowerCase()
  for (const key of listAllDayKeys(cfg).reverse()) {
    const day = readDay(cfg, key)
    const entry = day.entries.find((e) => e.id.toLowerCase() === wanted)
    if (entry) return { entry, dateKey: key, day }
  }
  throw new TrackerError(`no entry with id ${id}`, { hint: 'Use `tracker today` or `tracker report` to find the id.' })
}

function saveInto(cfg, dateKey, mutate) {
  const day = readDay(cfg, dateKey)
  const result = mutate(day)
  writeDay(cfg, day)
  return result
}

export function startEntry(cfg, opts) {
  const { nowDate } = opts
  const task = String(opts.task ?? '').trim()
  if (!task) throw new TrackerError('no task description given', { hint: 'For example: start fix checkout webhook retry' })

  const projectInput = opts.project ?? cfg.defaultProject
  if (!projectInput) {
    throw new TrackerError('no project given', {
      hint: 'Pass --project <name>, or set defaultProject in tracker.config.json.',
    })
  }
  const resolved = resolveProject(cfg, projectInput)

  const startMs = resolveAt(cfg, opts.at, nowDate)
  const dateKey = localDateKey(new Date(startMs), cfg.tz)

  // Captured before the write so the caller can report what else is running.
  const alsoOpen = findOpenEntries(cfg, { nowDate })

  const entry = saveInto(cfg, dateKey, (day) => {
    const created = {
      id: newId(day.entries.map((e) => e.id)),
      project: resolved.id,
      task,
      start: toLocalISO(new Date(startMs), cfg.tz),
      end: null,
      weight: Number.isFinite(opts.weight) && opts.weight > 0 ? opts.weight : 1,
      tags: parseTags(opts.tags),
      notes: opts.note ? [{ at: toLocalISO(nowDate, cfg.tz), text: String(opts.note) }] : [],
      links: parseLinks(opts.link),
    }
    day.entries.push(created)
    return created
  })

  return {
    entry,
    dateKey,
    project: resolved.project,
    projectCreated: resolved.created,
    // Informational, NOT a warning: parallel work is the normal case here, and
    // flagging it as a warning would train the reader to ignore warnings.
    alsoOpen: alsoOpen.map(({ entry: e, dateKey: k, carriedOver }) => ({
      id: e.id,
      project: e.project,
      task: e.task,
      dateKey: k,
      carriedOver,
      elapsedMinutes: round2(minutesBetween(entryStartMs(e), nowDate.getTime())),
    })),
    warnings: [...resolved.warnings, ...maybeAutoCommit(cfg, `start ${entry?.id ?? ''} ${task}`.trim())],
  }
}

/**
 * One closed entry, one write. The two-command `start --at` + `stop --at` dance this
 * replaces is not just clumsy: between the two commands the entry is genuinely open,
 * so a crash leaves a dangling clock, and if anything else was already running the
 * `stop` goes ambiguous and refuses. Neither can happen here - nothing is ever open.
 */
export function logEntry(cfg, opts) {
  const { nowDate } = opts
  const task = String(opts.task ?? '').trim()
  if (!task) throw new TrackerError('no task description given', { hint: 'For example: log sync --from 8:00 --to 8:40' })
  if (!opts.from || !opts.to) {
    throw new TrackerError('log needs --from and --to', {
      hint: 'For example: log "Orion sync" --project orion --from 8:00 --to 8:40. To start a running clock, use `start`.',
    })
  }

  const projectInput = opts.project ?? cfg.defaultProject
  if (!projectInput) {
    throw new TrackerError('no project given', {
      hint: 'Pass --project <name>, or set defaultProject in tracker.config.json.',
    })
  }
  const resolved = resolveProject(cfg, projectInput)

  const startMs = resolveAt(cfg, opts.from, nowDate, { flag: '--from' })
  const endMs = resolveAt(cfg, opts.to, nowDate, { flag: '--to' })
  if (endMs < startMs) {
    throw new TrackerError('--to is before --from', {
      hint: `Got --from ${toLocalISO(new Date(startMs), cfg.tz)} and --to ${toLocalISO(new Date(endMs), cfg.tz)}.`,
    })
  }

  const dateKey = localDateKey(new Date(startMs), cfg.tz)
  const entry = saveInto(cfg, dateKey, (day) => {
    const created = {
      id: newId(day.entries.map((e) => e.id)),
      project: resolved.id,
      task,
      start: toLocalISO(new Date(startMs), cfg.tz),
      end: toLocalISO(new Date(endMs), cfg.tz),
      weight: Number.isFinite(opts.weight) && opts.weight > 0 ? opts.weight : 1,
      tags: parseTags(opts.tags),
      notes: opts.note ? [{ at: toLocalISO(nowDate, cfg.tz), text: String(opts.note) }] : [],
      links: parseLinks(opts.link),
    }
    day.entries.push(created)
    return created
  })

  return {
    entry,
    dateKey,
    project: resolved.project,
    projectCreated: resolved.created,
    durationMinutes: round2(minutesBetween(startMs, endMs)),
    warnings: [...resolved.warnings, ...maybeAutoCommit(cfg, `log ${entry.id} ${task}`)],
  }
}

/**
 * Cuts one entry in two at an instant, for when the activity changed but the clock
 * did not. The boundary is a single value used for both halves, so unlike closing
 * one entry and opening another by hand it cannot leave a gap or an overlap between
 * them. An open entry stays open: the second half inherits the running clock.
 */
export function splitEntry(cfg, opts) {
  const { nowDate } = opts
  const found = findById(cfg, opts.id)
  if (!opts.at) throw new TrackerError('split needs --at', { hint: 'Where to cut, e.g. --at 15:58 or --at -20m.' })

  const atMs = resolveAt(cfg, opts.at, nowDate, { allowFuture: true, flag: '--at' })
  const startMs = entryStartMs(found.entry)
  const wasOpen = found.entry.end == null

  if (atMs <= startMs) {
    throw new TrackerError('--at is at or before the start of the entry', {
      hint: `${describe(found.entry)} starts ${found.entry.start}. A split must leave time on both sides.`,
    })
  }
  if (!wasOpen && atMs >= entryEndMs(found.entry)) {
    throw new TrackerError('--at is at or after the end of the entry', {
      hint: `${describe(found.entry)} ends ${found.entry.end}. A split must leave time on both sides.`,
    })
  }

  const boundary = toLocalISO(new Date(atMs), cfg.tz)
  const originalEnd = found.entry.end

  const first = saveInto(cfg, found.dateKey, (day) => {
    const e = day.entries.find((x) => x.id === found.entry.id)
    e.end = boundary
    if (opts.firstTask != null) e.task = String(opts.firstTask).trim()
    return { ...e }
  })

  // The cut can land on the far side of a local-day boundary, and an entry always
  // lives in the file of its start date.
  const secondDateKey = localDateKey(new Date(atMs), cfg.tz)
  const second = saveInto(cfg, secondDateKey, (day) => {
    const created = {
      id: newId(day.entries.map((e) => e.id)),
      project: first.project,
      task: opts.task != null ? String(opts.task).trim() : first.task,
      start: boundary,
      end: originalEnd,
      weight: first.weight,
      tags: [...first.tags],
      notes: opts.note ? [{ at: toLocalISO(nowDate, cfg.tz), text: String(opts.note) }] : [],
      links: { ...first.links },
    }
    day.entries.push(created)
    return created
  })

  const nowMs = nowDate.getTime()
  return {
    first: { ...first, dateKey: found.dateKey, durationMinutes: round2(minutesBetween(startMs, atMs)) },
    second: {
      ...second,
      dateKey: secondDateKey,
      open: second.end == null,
      durationMinutes: round2(minutesBetween(atMs, second.end == null ? nowMs : entryEndMs(second))),
    },
    warnings: maybeAutoCommit(cfg, `split ${first.id} -> ${second.id}`),
  }
}

export function stopEntries(cfg, opts) {
  const { nowDate } = opts
  const open = findOpenEntries(cfg, { nowDate })
  if (open.length === 0) {
    throw new TrackerError('nothing is running', { hint: 'Start something with `tracker start <task> --project <p>`.' })
  }

  let targets
  if (opts.all) {
    targets = open
  } else if (opts.query) {
    targets = [matchOne(open, opts.query, { what: 'open entry' })]
  } else if (open.length === 1) {
    targets = open
  } else {
    // Several things are running and no query was given. Guessing would stop the
    // wrong task, so this is a hard error that lists the ids.
    throw new TrackerError(`${open.length} entries are running; say which one`, {
      hint: `Use \`stop <id-or-text>\` or \`stop --all\`: ${open.map(({ entry }) => describe(entry)).join(' | ')}`,
      data: { open: open.map(({ entry }) => entry) },
    })
  }

  const endMs = resolveAt(cfg, opts.at, nowDate)
  const stopped = []
  const warnings = []

  for (const { entry, dateKey } of targets) {
    // Equality is allowed on purpose. Timestamps have second precision, so starting
    // and immediately stopping something lands end === start; refusing that would
    // leave an entry that cannot be stopped at all until the clock ticks past it.
    // A zero-minute entry is odd but honest, and `rm` removes it.
    if (endMs < entryStartMs(entry)) {
      throw new TrackerError(`--at is before the start of ${describe(entry)}`, {
        hint: `That entry started ${entry.start}. An entry cannot have a negative duration.`,
      })
    }
    const updated = saveInto(cfg, dateKey, (day) => {
      const target = day.entries.find((e) => e.id === entry.id)
      target.end = toLocalISO(new Date(endMs), cfg.tz)
      if (opts.note) target.notes.push({ at: toLocalISO(nowDate, cfg.tz), text: String(opts.note) })
      return target
    })
    stopped.push({ ...updated, dateKey, durationMinutes: round2(minutesBetween(entryStartMs(updated), endMs)) })
  }

  warnings.push(...maybeAutoCommit(cfg, `stop ${stopped.map((s) => s.id).join(' ')}`))
  return { stopped, warnings }
}

export function switchTo(cfg, opts) {
  const open = findOpenEntries(cfg, { nowDate: opts.nowDate })
  let closed = []
  const warnings = []
  if (open.length > 0) {
    const result = stopEntries(cfg, { ...opts, all: true, query: null, note: null })
    closed = result.stopped
    warnings.push(...result.warnings)
  }
  const started = startEntry(cfg, opts)
  warnings.push(...started.warnings)
  return { closed, started, warnings }
}

export function statusOf(cfg, { nowDate }) {
  const open = findOpenEntries(cfg, { nowDate })
  return {
    concurrency: open.length,
    open: open.map(({ entry, dateKey, carriedOver }) => ({
      ...entry,
      dateKey,
      carriedOver,
      elapsedMinutes: round2(minutesBetween(entryStartMs(entry), nowDate.getTime())),
    })),
  }
}

export function addNote(cfg, opts) {
  const { nowDate } = opts
  const text = String(opts.text ?? '').trim()
  if (!text) throw new TrackerError('no note text given')

  let target
  if (opts.last) {
    const open = findOpenEntries(cfg, { nowDate })
    if (open.length === 0) throw new TrackerError('nothing is running to attach a note to')
    if (open.length > 1) {
      throw new TrackerError(`${open.length} entries are running; --last is ambiguous`, {
        hint: `Name one: ${open.map(({ entry }) => describe(entry)).join(' | ')}`,
      })
    }
    target = open[0]
  } else if (opts.query) {
    const open = findOpenEntries(cfg, { nowDate })
    try {
      target = matchOne(open, opts.query, { what: 'open entry' })
    } catch {
      target = findById(cfg, opts.query)
    }
  } else {
    throw new TrackerError('no entry given', { hint: 'Pass a query or --last.' })
  }

  const updated = saveInto(cfg, target.dateKey, (day) => {
    const e = day.entries.find((x) => x.id === target.entry.id)
    e.notes.push({ at: toLocalISO(nowDate, cfg.tz), text })
    return e
  })
  return { entry: updated, dateKey: target.dateKey, warnings: maybeAutoCommit(cfg, `note ${updated.id}`) }
}

export function addLink(cfg, opts) {
  const { nowDate } = opts
  const links = parseLinks(opts.pairs)
  if (Object.keys(links).length === 0) throw new TrackerError('no key=value pair given')

  const open = findOpenEntries(cfg, { nowDate })
  let target
  try {
    target = matchOne(open, opts.query, { what: 'open entry' })
  } catch {
    target = findById(cfg, opts.query)
  }

  const updated = saveInto(cfg, target.dateKey, (day) => {
    const e = day.entries.find((x) => x.id === target.entry.id)
    e.links = { ...e.links, ...links }
    return e
  })
  return { entry: updated, dateKey: target.dateKey, warnings: maybeAutoCommit(cfg, `link ${updated.id}`) }
}

export function editEntry(cfg, opts) {
  const { nowDate } = opts
  const found = findById(cfg, opts.id)
  const warnings = []

  const next = { ...found.entry }
  if (opts.task != null) next.task = String(opts.task).trim()
  if (opts.project != null) {
    const resolved = resolveProject(cfg, opts.project)
    next.project = resolved.id
    warnings.push(...resolved.warnings)
  }
  if (opts.tags != null) next.tags = parseTags(opts.tags)
  if (opts.weight != null) {
    if (!(Number.isFinite(opts.weight) && opts.weight > 0)) throw new TrackerError('--weight must be a positive number')
    next.weight = opts.weight
  }
  if (opts.link != null) next.links = { ...next.links, ...parseLinks(opts.link) }

  // `edit` is the after-the-fact repair tool, so unlike start/stop it may set a
  // future timestamp - that is the only place +Nm is meaningful.
  if (opts.start != null) {
    next.start = toLocalISO(new Date(resolveAt(cfg, opts.start, nowDate, { allowFuture: true, flag: '--start' })), cfg.tz)
  }
  if (opts.end != null) {
    next.end =
      String(opts.end).trim().toLowerCase() === 'null' || String(opts.end).trim() === ''
        ? null
        : toLocalISO(new Date(resolveAt(cfg, opts.end, nowDate, { allowFuture: true, flag: '--end' })), cfg.tz)
  }

  if (next.end != null && entryEndMs(next) < entryStartMs(next)) {
    throw new TrackerError('end cannot be before start', {
      hint: `Got start ${next.start} and end ${next.end}.`,
    })
  }

  const newDateKey = localDateKey(new Date(entryStartMs(next)), cfg.tz)

  if (newDateKey !== found.dateKey) {
    // The start moved across a local-day boundary, so the entry has to move file:
    // an entry always lives in the file of its start date.
    saveInto(cfg, found.dateKey, (day) => {
      day.entries = day.entries.filter((e) => e.id !== next.id)
    })
    saveInto(cfg, newDateKey, (day) => {
      day.entries.push(next)
    })
    warnings.push(`entry moved from ${found.dateKey} to ${newDateKey} because its start date changed`)
  } else {
    saveInto(cfg, found.dateKey, (day) => {
      const idx = day.entries.findIndex((e) => e.id === next.id)
      day.entries[idx] = next
    })
  }

  warnings.push(...maybeAutoCommit(cfg, `edit ${next.id}`))
  return { entry: readDay(cfg, newDateKey).entries.find((e) => e.id === next.id), dateKey: newDateKey, warnings }
}

export function removeEntry(cfg, opts) {
  const found = findById(cfg, opts.id)
  const deleted = { ...found.entry }
  saveInto(cfg, found.dateKey, (day) => {
    day.entries = day.entries.filter((e) => e.id !== deleted.id)
  })
  return {
    // Echoed back in full so the entry can be recreated if this was a mistake.
    deleted,
    dateKey: found.dateKey,
    warnings: maybeAutoCommit(cfg, `rm ${deleted.id}`),
  }
}

export function resumeEntry(cfg, opts) {
  const { nowDate } = opts
  const candidates = []
  for (const key of listAllDayKeys(cfg).reverse().slice(0, 60)) {
    for (const entry of readDay(cfg, key).entries) candidates.push({ entry, dateKey: key })
  }
  if (candidates.length === 0) throw new TrackerError('no previous entries to resume')
  // "what I was doing before" is the work that stopped most recently, which is not the same as
  // the entry that started most recently: a long task started first can outlast a short one.
  candidates.sort((a, b) => entryStartMs(b.entry) - entryStartMs(a.entry))
  const finished = candidates
    .filter((c) => c.entry.end != null)
    .sort((a, b) => entryEndMs(b.entry) - entryEndMs(a.entry))

  if (!opts.query && finished.length === 0) {
    throw new TrackerError('no finished entries to resume', {
      hint: 'everything tracked is still running — stop one first, or name the task to resume',
    })
  }

  // "the meeting is done, back to work" arrives as stop-then-resume in one breath, so the
  // entry that ended a moment ago is the thing being left, never the thing being returned to.
  // Skip those and take the next most recently finished; if there is nothing else, that entry
  // really is the only work to go back to, and resuming it gets said out loud.
  const resumeMs = resolveAt(cfg, opts.at, nowDate)
  const justStopped = finished.filter(({ entry }) => Math.abs(resumeMs - entryEndMs(entry)) <= JUST_STOPPED_MS)
  const earlier = finished.filter((c) => !justStopped.includes(c))

  const guardWarnings = []
  let source
  if (opts.query) {
    source = matchOne(candidates, opts.query, { what: 'entry' })
  } else if (earlier.length > 0) {
    source = earlier[0]
    if (justStopped.length > 0) {
      guardWarnings.push(
        `skipped ${justStopped.map(({ entry }) => describe(entry)).join(', ')} — stopped just now, not resumed`,
      )
    }
  } else {
    source = finished[0]
    guardWarnings.push(`${describe(source.entry)} was stopped just now and is the only finished entry — resumed it`)
  }

  const started = startEntry(cfg, {
    nowDate,
    task: source.entry.task,
    project: source.entry.project,
    at: opts.at,
    tags: source.entry.tags.join(','),
    weight: source.entry.weight,
    link: Object.entries(source.entry.links).map(([k, v]) => `${k}=${v}`),
  })
  return { ...started, resumedFrom: source.entry.id, warnings: [...guardWarnings, ...started.warnings] }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
