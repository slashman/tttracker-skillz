import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { SCHEMA_VERSION } from './config.mjs'
import { TrackerError } from './errors.mjs'
import { addDays, dateKeyRange, localDateKey, minutesBetween } from './time.mjs'

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/

export function daysRoot(cfg) {
  return path.join(cfg.dataDir, 'days')
}

export function dayFilePath(cfg, dateKey) {
  const [year, month] = dateKey.split('-')
  return path.join(daysRoot(cfg), year, month, `${dateKey}.json`)
}

export function emptyDay(dateKey, tz) {
  return { schemaVersion: SCHEMA_VERSION, date: dateKey, tz, entries: [] }
}

export function entryStartMs(entry) {
  const ms = Date.parse(entry.start)
  if (Number.isNaN(ms)) throw new TrackerError(`entry ${entry.id} has an unparseable start: ${entry.start}`)
  return ms
}

export function entryEndMs(entry) {
  if (entry.end == null) return null
  const ms = Date.parse(entry.end)
  if (Number.isNaN(ms)) throw new TrackerError(`entry ${entry.id} has an unparseable end: ${entry.end}`)
  return ms
}

/**
 * durationMinutes in the file is a convenience for humans reading the JSON, never
 * a source of truth: it is recomputed from the two offset-bearing instants on
 * every read. That is what keeps a timezone change or a DST boundary from
 * silently corrupting past totals.
 */
function normalizeEntry(entry) {
  const out = { ...entry }
  out.tags = Array.isArray(out.tags) ? out.tags : []
  out.notes = Array.isArray(out.notes) ? out.notes : []
  out.links = out.links && typeof out.links === 'object' ? out.links : {}
  out.weight = Number.isFinite(out.weight) && out.weight > 0 ? out.weight : 1
  if (out.end == null) {
    out.end = null
    delete out.durationMinutes
  } else {
    out.durationMinutes = Math.round(minutesBetween(entryStartMs(out), entryEndMs(out)) * 100) / 100
  }
  return out
}

function migrate(day, dateKey, tz) {
  const version = Number.isInteger(day.schemaVersion) ? day.schemaVersion : 1
  if (version > SCHEMA_VERSION) {
    throw new TrackerError(
      `${dateKey}.json was written by a newer tracker (schemaVersion ${version}, this build understands ${SCHEMA_VERSION})`,
      { hint: 'Update this checkout rather than letting an older build rewrite the file.' },
    )
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    date: day.date ?? dateKey,
    tz: day.tz ?? tz,
    entries: (Array.isArray(day.entries) ? day.entries : []).map(normalizeEntry),
  }
}

export function readDay(cfg, dateKey) {
  const file = dayFilePath(cfg, dateKey)
  if (!existsSync(file)) return emptyDay(dateKey, cfg.tz)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new TrackerError(`${file} is not valid JSON: ${err.message}`, {
      hint: 'The file was hand-edited or a write was interrupted. Restore it from the data dir git history.',
    })
  }
  return migrate(parsed, dateKey, cfg.tz)
}

/**
 * Atomic: full content into a pid-scoped temp file, fsync, then rename. A crash
 * mid-write leaves the previous day file untouched and a stray .tmp- behind.
 */
export function writeDay(cfg, day) {
  const file = dayFilePath(cfg, day.date)
  mkdirSync(path.dirname(file), { recursive: true })
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    date: day.date,
    tz: day.tz ?? cfg.tz,
    entries: [...day.entries].map(normalizeEntry).sort((a, b) => entryStartMs(a) - entryStartMs(b)),
  }
  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, file)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* leave the temp file for inspection if it cannot be cleaned up */
    }
    throw err
  }
  return payload
}

/** Every day key that has a file on disk, ascending. */
export function listAllDayKeys(cfg) {
  const root = daysRoot(cfg)
  if (!existsSync(root)) return []
  const keys = []
  for (const year of readdirSync(root)) {
    const yearDir = path.join(root, year)
    if (!/^\d{4}$/.test(year)) continue
    for (const month of readdirSync(yearDir)) {
      const monthDir = path.join(yearDir, month)
      if (!/^\d{2}$/.test(month)) continue
      for (const file of readdirSync(monthDir)) {
        const m = DAY_FILE_RE.exec(file)
        if (m) keys.push(m[1])
      }
    }
  }
  return keys.sort()
}

export function readDaysInRange(cfg, from, to) {
  return dateKeyRange(from, to).map((key) => readDay(cfg, key))
}

/**
 * Entries whose interval intersects [fromMs, toMs). Scans a couple of days before
 * `from` because an entry lives in the file of its START date: work that began at
 * 23:00 yesterday and ran past midnight belongs to yesterday's file but overlaps
 * today's window.
 */
export function readEntriesIntersecting(cfg, from, to, { fromMs, toMs, spillDays = 2 }) {
  const out = []
  for (const key of dateKeyRange(addDays(from, -spillDays), to)) {
    const day = readDay(cfg, key)
    for (const entry of day.entries) {
      const s = entryStartMs(entry)
      const e = entryEndMs(entry)
      // An open entry has no end yet, so it intersects anything that has not finished.
      if (e === null ? s < toMs : s < toMs && e > fromMs) {
        out.push({ entry, dateKey: key })
      }
    }
  }
  return out.sort((a, b) => entryStartMs(a.entry) - entryStartMs(b.entry))
}

/**
 * Shared by status, stop, note --last, switch and today. Anything that reasons
 * about "what is running" must use this rather than looking only at today, or an
 * entry started yesterday becomes invisible.
 */
export function findOpenEntries(cfg, { nowDate, lookbackDays = cfg.lookbackDays } = {}) {
  const todayKey = localDateKey(nowDate, cfg.tz)
  const found = []
  for (let i = 0; i <= lookbackDays; i++) {
    const key = addDays(todayKey, -i)
    for (const entry of readDay(cfg, key).entries) {
      if (entry.end == null) found.push({ entry, dateKey: key, carriedOver: key !== todayKey })
    }
  }
  return found.sort((a, b) => entryStartMs(a.entry) - entryStartMs(b.entry))
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function newId(existingIds = []) {
  const taken = new Set(existingIds)
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = ''
    for (let i = 0; i < 6; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
    if (!taken.has(id)) return id
  }
  throw new TrackerError('could not generate a unique entry id', { hint: 'That day file is implausibly full.' })
}

/**
 * Opt-in, off by default. Failures are surfaced as warnings rather than aborting:
 * the time entry is already safely on disk, and losing it because git complained
 * would be worse than an uncommitted data dir.
 */
export function maybeAutoCommit(cfg, message) {
  if (!cfg.autoCommit) return []
  if (!existsSync(path.join(cfg.dataDir, '.git'))) {
    return [`autoCommit is on but ${cfg.dataDir} is not a git repository; skipped`]
  }
  try {
    execFileSync('git', ['-C', cfg.dataDir, 'add', '-A'], { stdio: 'pipe' })
    const status = execFileSync('git', ['-C', cfg.dataDir, 'status', '--porcelain'], { stdio: 'pipe' }).toString()
    if (status.trim() === '') return []
    execFileSync('git', ['-C', cfg.dataDir, 'commit', '-m', message], { stdio: 'pipe' })
    return []
  } catch (err) {
    const detail = (err.stderr?.toString() || err.message || '').trim().split('\n')[0]
    return [`autoCommit failed (data is saved): ${detail}`]
  }
}
