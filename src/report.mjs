import { SCHEMA_VERSION } from './config.mjs'
import { TrackerError } from './errors.mjs'
import { apportion, attribute } from './attribute.mjs'
import { loadProjects } from './projects.mjs'
import { entryEndMs, entryStartMs, readEntriesIntersecting } from './store.mjs'
import { addDays, dayEndMs, dayStartMs, humanMinutes, localDateKey, minutesBetween, parseDateKey } from './time.mjs'

const round2 = (n) => Math.round(n * 100) / 100

export function resolveRange(cfg, opts, nowDate) {
  const today = localDateKey(nowDate, cfg.tz)

  if (opts.from || opts.to) {
    const from = opts.from ?? opts.to
    const to = opts.to ?? opts.from
    parseDateKey(from)
    parseDateKey(to)
    if (dayStartMs(from, cfg.tz) > dayStartMs(to, cfg.tz)) {
      throw new TrackerError(`--from ${from} is after --to ${to}`, { hint: 'Swap them.' })
    }
    return { from, to, label: from === to ? from : `${from}..${to}` }
  }

  if (opts.week) {
    const { year, month, day } = parseDateKey(today)
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
    const from = addDays(today, -((dow + 6) % 7)) // ISO week starts Monday
    return { from, to: addDays(from, 6), label: `week of ${from}` }
  }

  if (opts.month) {
    const { year, month } = parseDateKey(today)
    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
    return { from, to: addDays(nextMonth, -1), label: `${year}-${String(month).padStart(2, '0')}` }
  }

  const date = opts.date ?? today
  parseDateKey(date)
  return { from: date, to: date, label: date }
}

/**
 * Collects everything whose interval intersects the window, then attributes over
 * the window as a single sweep. Attributing per-day and summing would double-count
 * work that spans midnight.
 */
function gather(cfg, { from, to, project, nowDate, strategy }) {
  const fromMs = dayStartMs(from, cfg.tz)
  const toMs = dayEndMs(to, cfg.tz)
  const found = readEntriesIntersecting(cfg, from, to, { fromMs, toMs })

  const filtered = project ? found.filter(({ entry }) => entry.project === project) : found

  const intervals = filtered.map(({ entry }) => ({
    id: entry.id,
    startMs: entryStartMs(entry),
    endMs: entryEndMs(entry),
    weight: entry.weight,
  }))

  const attribution = attribute(intervals, {
    strategy,
    windowStart: fromMs,
    windowEnd: toMs,
    // An open entry is only "spent" up to now, not to the end of the window.
    openEndMs: Math.min(nowDate.getTime(), toMs),
  })

  return { entries: filtered, attribution, fromMs, toMs }
}

/** Minutes of an entry that fall inside the window (what a per-day view should show). */
function windowMinutes(entry, fromMs, toMs, nowMs) {
  const s = Math.max(entryStartMs(entry), fromMs)
  const rawEnd = entryEndMs(entry) ?? Math.min(nowMs, toMs)
  const e = Math.min(rawEnd, toMs)
  return e > s ? minutesBetween(s, e) : 0
}

export function buildReport(cfg, opts) {
  const { nowDate } = opts
  const range = resolveRange(cfg, opts, nowDate)
  const strategy = opts.strategy ?? cfg.attributionStrategy
  const useAttribution = Boolean(opts.attribute || opts.strategy)
  const step = opts.round ?? cfg.roundStep ?? null
  const balance = opts.balance !== false
  const warnings = []

  const { entries, attribution, fromMs, toMs } = gather(cfg, { ...range, project: opts.project, nowDate, strategy })
  const nowMs = nowDate.getTime()
  const projectMeta = new Map(loadProjects(cfg).map((p) => [p.id, p]))

  // Group project -> task. Leaves are (project, task) pairs; that is the level
  // rounding is applied at, so parent rows are always the sum of their children.
  const leaves = new Map()
  for (const { entry, dateKey } of entries) {
    const key = `${entry.project}\x00${entry.task}`
    if (!leaves.has(key)) {
      leaves.set(key, {
        project: entry.project,
        task: entry.task,
        entryIds: [],
        dateKeys: new Set(),
        rawMinutes: 0,
        windowMinutes: 0,
        attributedMinutes: 0,
        open: false,
      })
    }
    const leaf = leaves.get(key)
    leaf.entryIds.push(entry.id)
    leaf.dateKeys.add(dateKey)
    leaf.rawMinutes += entryEndMs(entry) == null ? minutesBetween(entryStartMs(entry), nowMs) : entry.durationMinutes
    leaf.windowMinutes += windowMinutes(entry, fromMs, toMs, nowMs)
    leaf.attributedMinutes += attribution.attributed[entry.id] ?? 0
    if (entryEndMs(entry) == null) leaf.open = true
  }

  const leafList = [...leaves.values()].sort(
    (a, b) => a.project.localeCompare(b.project) || b.attributedMinutes - a.attributedMinutes,
  )

  // The column that gets rounded: attributed when attribution is on, otherwise the
  // in-window duration.
  const basis = leafList.map((l) => (useAttribution ? l.attributedMinutes : l.windowMinutes))
  let rounding = null
  if (step) {
    const result = apportion(basis, step, {
      balance: useAttribution ? balance : false,
      total: basis.reduce((a, b) => a + b, 0),
    })
    leafList.forEach((leaf, i) => {
      leaf.roundedMinutes = result.rounded[i]
    })
    rounding = {
      step,
      balanced: useAttribution ? balance : false,
      residual: round2(result.residual),
      vanished: result.vanished.map((i) => ({ project: leafList[i].project, task: leafList[i].task, exactMinutes: round2(basis[i]) })),
    }
    if (rounding.vanished.length > 0) {
      // Silence here is how a timesheet ends up quietly wrong.
      warnings.push(
        `${rounding.vanished.length} entr${rounding.vanished.length === 1 ? 'y' : 'ies'} rounded away to zero at ` +
          `${step}m granularity: ${rounding.vanished.map((v) => `"${v.task}" (${round2(v.exactMinutes)}m)`).join(', ')}`,
      )
    }
    if (Math.abs(rounding.residual) > 0.001) {
      warnings.push(
        `rounding to ${step}m changes the total by ${rounding.residual > 0 ? '+' : ''}${rounding.residual}m ` +
          `(unavoidable when putting ${round2(basis.reduce((a, b) => a + b, 0))}m on a ${step}m grid)`,
      )
    }
  }

  const byProject = new Map()
  for (const leaf of leafList) {
    if (!byProject.has(leaf.project)) {
      byProject.set(leaf.project, {
        id: leaf.project,
        name: projectMeta.get(leaf.project)?.name ?? leaf.project,
        rawMinutes: 0,
        windowMinutes: 0,
        attributedMinutes: 0,
        roundedMinutes: step ? 0 : null,
        tasks: [],
      })
    }
    const p = byProject.get(leaf.project)
    p.rawMinutes = round2(p.rawMinutes + leaf.rawMinutes)
    p.windowMinutes = round2(p.windowMinutes + leaf.windowMinutes)
    p.attributedMinutes = round2(p.attributedMinutes + leaf.attributedMinutes)
    if (step) p.roundedMinutes = round2(p.roundedMinutes + leaf.roundedMinutes)
    p.tasks.push({
      task: leaf.task,
      entryIds: leaf.entryIds,
      dateKeys: [...leaf.dateKeys].sort(),
      open: leaf.open,
      rawMinutes: round2(leaf.rawMinutes),
      windowMinutes: round2(leaf.windowMinutes),
      attributedMinutes: round2(leaf.attributedMinutes),
      roundedMinutes: step ? round2(leaf.roundedMinutes) : null,
    })
  }

  const projects = [...byProject.values()].sort((a, b) => b.attributedMinutes - a.attributedMinutes)

  return {
    schemaVersion: SCHEMA_VERSION,
    tz: cfg.tz,
    range: { from: range.from, to: range.to, label: range.label },
    attribution: useAttribution
      ? {
          strategy,
          explanation: EXPLANATIONS[strategy],
          rawMinutes: round2(attribution.rawMinutes),
          attributedMinutes: round2(attribution.attributedMinutes),
          unionMinutes: round2(attribution.unionMinutes),
          overlapFactor: attribution.overlapFactor,
          maxConcurrency: attribution.maxConcurrency,
        }
      : null,
    rounding,
    projects,
    totals: {
      rawMinutes: round2(projects.reduce((s, p) => s + p.rawMinutes, 0)),
      windowMinutes: round2(projects.reduce((s, p) => s + p.windowMinutes, 0)),
      attributedMinutes: round2(projects.reduce((s, p) => s + p.attributedMinutes, 0)),
      roundedMinutes: step ? round2(projects.reduce((s, p) => s + p.roundedMinutes, 0)) : null,
      unionMinutes: round2(attribution.unionMinutes),
    },
    entryCount: entries.length,
    openCount: entries.filter(({ entry }) => entryEndMs(entry) == null).length,
    warnings,
  }
}

export const EXPLANATIONS = {
  equal: 'time is split evenly among the tasks running at the same moment',
  weighted: 'each moment is split in proportion to per-entry weight',
  exclusive: 'each moment goes entirely to the most recently started task that was open',
}

export function buildAnalysis(cfg, opts) {
  const { nowDate } = opts
  const range = resolveRange(cfg, opts, nowDate)
  const strategy = opts.strategy ?? cfg.attributionStrategy
  const { entries, attribution } = gather(cfg, { ...range, project: opts.project, nowDate, strategy })

  const perProject = new Map()
  for (const { entry } of entries) {
    perProject.set(entry.project, round2((perProject.get(entry.project) ?? 0) + (attribution.attributed[entry.id] ?? 0)))
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    tz: cfg.tz,
    range: { from: range.from, to: range.to, label: range.label },
    strategy,
    explanation: EXPLANATIONS[strategy],
    rawMinutes: round2(attribution.rawMinutes),
    attributedMinutes: round2(attribution.attributedMinutes),
    unionMinutes: round2(attribution.unionMinutes),
    // How much apparent effort was overlap: the honest reading of raw-minus-attributed.
    overlapMinutes: round2(attribution.rawMinutes - attribution.unionMinutes),
    overlapFactor: attribution.overlapFactor,
    maxConcurrency: attribution.maxConcurrency,
    concurrencyHistogram: attribution.histogram.map((h) => ({ ...h, minutes: round2(h.minutes) })),
    contextSwitches: attribution.contextSwitches,
    entryCount: entries.length,
    perProject: [...perProject.entries()]
      .map(([id, minutes]) => ({ id, attributedMinutes: minutes }))
      .sort((a, b) => b.attributedMinutes - a.attributedMinutes),
  }
}

/**
 * Flat, one row per entry: the shape a spreadsheet or dataframe wants. A nested
 * rollup is a presentation, not an analysis input.
 */
export function buildExport(cfg, opts) {
  const { nowDate } = opts
  const range = resolveRange(cfg, opts, nowDate)
  const strategy = opts.strategy ?? cfg.attributionStrategy
  const { entries, attribution, fromMs, toMs } = gather(cfg, { ...range, project: opts.project, nowDate, strategy })
  const nowMs = nowDate.getTime()

  return {
    schemaVersion: SCHEMA_VERSION,
    tz: cfg.tz,
    range: { from: range.from, to: range.to, label: range.label },
    strategy,
    rows: entries.map(({ entry, dateKey }) => ({
      id: entry.id,
      dateKey,
      project: entry.project,
      task: entry.task,
      start: entry.start,
      end: entry.end,
      open: entry.end == null,
      weight: entry.weight,
      // Full entry duration, even the part outside the window.
      rawMinutes: round2(entry.end == null ? minutesBetween(entryStartMs(entry), nowMs) : entry.durationMinutes),
      // The part inside the window, and the share of it this entry is charged.
      windowMinutes: round2(windowMinutes(entry, fromMs, toMs, nowMs)),
      attributedMinutes: round2(attribution.attributed[entry.id] ?? 0),
      tags: entry.tags.join('|'),
      links: Object.entries(entry.links)
        .map(([k, v]) => `${k}=${v}`)
        .join('|'),
      noteCount: entry.notes.length,
    })),
  }
}

/* ---------------------------------- formatters --------------------------------- */

export function reportToMarkdown(report) {
  const lines = []
  const attributed = Boolean(report.attribution)
  const step = report.rounding?.step ?? null
  const col = (leaf) => (step ? leaf.roundedMinutes : attributed ? leaf.attributedMinutes : leaf.windowMinutes)

  lines.push(`### ${report.range.label}${attributed ? ` — attributed (${report.attribution.strategy})` : ''}`)
  lines.push('')
  if (attributed) {
    lines.push(`_${report.attribution.explanation}._`)
    lines.push('')
  }

  if (report.projects.length === 0) {
    lines.push('_No time tracked in this range._')
    return lines.join('\n')
  }

  const header = attributed ? ['Project / task', 'Raw', 'Attributed'] : ['Project / task', 'Time']
  if (step) header.push(`Rounded (${step}m)`)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map((_, i) => (i === 0 ? ':--' : '--:')).join(' | ')} |`)

  for (const p of report.projects) {
    const row = attributed
      ? [`**${p.name}**`, humanMinutes(p.rawMinutes), `**${humanMinutes(p.attributedMinutes)}**`]
      : [`**${p.name}**`, `**${humanMinutes(p.windowMinutes)}**`]
    if (step) row.push(`**${humanMinutes(p.roundedMinutes)}**`)
    lines.push(`| ${row.join(' | ')} |`)
    for (const t of p.tasks) {
      const label = `  ${t.task}${t.open ? ' ⏱' : ''}`
      const trow = attributed
        ? [label, humanMinutes(t.rawMinutes), humanMinutes(t.attributedMinutes)]
        : [label, humanMinutes(t.windowMinutes)]
      if (step) trow.push(humanMinutes(t.roundedMinutes))
      lines.push(`| ${trow.join(' | ')} |`)
    }
  }

  const totalRow = attributed
    ? ['**Total**', humanMinutes(report.totals.rawMinutes), `**${humanMinutes(report.totals.attributedMinutes)}**`]
    : ['**Total**', `**${humanMinutes(report.totals.windowMinutes)}**`]
  if (step) totalRow.push(`**${humanMinutes(report.totals.roundedMinutes)}**`)
  lines.push(`| ${totalRow.join(' | ')} |`)

  if (attributed) {
    lines.push('')
    lines.push(
      `_Raw ${humanMinutes(report.totals.rawMinutes)} over ${humanMinutes(report.totals.unionMinutes)} of wall clock ` +
        `(overlap factor ${report.attribution.overlapFactor}, up to ${report.attribution.maxConcurrency} at once)._`,
    )
  }
  if (report.openCount > 0) lines.push(`\n_⏱ ${report.openCount} still running._`)
  for (const w of report.warnings) lines.push(`\n> ⚠ ${w}`)
  return lines.join('\n')
}

export function csvEscape(value) {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function rowsToCsv(rows, columns) {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : [])
  const out = [cols.join(',')]
  for (const row of rows) out.push(cols.map((c) => csvEscape(row[c])).join(','))
  return out.join('\n')
}

export function reportToCsv(report) {
  const step = report.rounding?.step ?? null
  const rows = []
  for (const p of report.projects) {
    for (const t of p.tasks) {
      rows.push({
        project: p.id,
        projectName: p.name,
        task: t.task,
        entryIds: t.entryIds.join('|'),
        rawMinutes: t.rawMinutes,
        windowMinutes: t.windowMinutes,
        attributedMinutes: t.attributedMinutes,
        roundedMinutes: step ? t.roundedMinutes : '',
        open: t.open,
      })
    }
  }
  return rowsToCsv(rows, [
    'project',
    'projectName',
    'task',
    'entryIds',
    'rawMinutes',
    'windowMinutes',
    'attributedMinutes',
    'roundedMinutes',
    'open',
  ])
}
