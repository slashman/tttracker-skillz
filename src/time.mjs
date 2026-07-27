import { TrackerError } from './errors.mjs'

/**
 * All instants are stored as local-ISO-with-offset ("2026-07-27T09:12:04-05:00")
 * rather than UTC Z, so day files read naturally in their own git history.
 * Durations are always computed from the two offset-bearing instants, which is
 * what makes DST transitions and timezone changes harmless.
 */

const MIN = 60_000

/** Injectable clock. Tests set TRACKER_NOW to a fixed ISO instant. */
export function now(env = process.env) {
  if (env.TRACKER_NOW) {
    const d = new Date(env.TRACKER_NOW)
    if (Number.isNaN(d.getTime())) {
      throw new TrackerError(`TRACKER_NOW is not a valid instant: ${env.TRACKER_NOW}`, {
        hint: 'Use a full ISO instant, e.g. 2026-07-27T09:00:00-05:00.',
      })
    }
    return d
  }
  return new Date()
}

const offsetFmtCache = new Map()
function offsetFmt(tz) {
  let f = offsetFmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    offsetFmtCache.set(tz, f)
  }
  return f
}

/** Minutes east of UTC for `date` in `tz` (-300 for GMT-05:00, +525 for GMT+08:45). */
export function offsetMinutes(tz, date) {
  const name = offsetFmt(tz).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  // Bare "GMT" is emitted by some ICU builds for UTC; treat as zero.
  const m = /^GMT([+-])(\d{1,2}):?(\d{2})?$/.exec(name)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

export function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

const partsFmtCache = new Map()
function partsFmt(tz) {
  let f = partsFmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsFmtCache.set(tz, f)
  }
  return f
}

/** Wall-clock components of `date` as seen in `tz`. */
export function localParts(date, tz) {
  const out = {}
  for (const p of partsFmt(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

/** "YYYY-MM-DD" for the local day `date` falls in. */
export function localDateKey(date, tz) {
  const p = localParts(date, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** "2026-07-27T09:12:04-05:00" */
export function toLocalISO(date, tz) {
  const p = localParts(date, tz)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    formatOffset(offsetMinutes(tz, date))
  )
}

/**
 * Epoch ms for a wall-clock time in `tz`. Two-pass because the offset depends on
 * the instant we are trying to find. In the one ambiguous hour of a DST fall-back
 * this resolves deterministically to one of the two valid instants, which is
 * enough: entries store the resolved offset, so the duration stays correct.
 */
export function zonedMs({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = offsetMinutes(tz, new Date(guess))
  let ms = guess - first * MIN
  const second_ = offsetMinutes(tz, new Date(ms))
  if (second_ !== first) ms = guess - second_ * MIN
  return ms
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key).trim())
  if (!m) {
    throw new TrackerError(`not a date: ${key}`, { hint: 'Use YYYY-MM-DD.' })
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** Local midnight of `dateKey`, as epoch ms. */
export function dayStartMs(dateKey, tz) {
  return zonedMs(parseDateKey(dateKey), tz)
}

/** Exclusive end of the local day: midnight of the following day. */
export function dayEndMs(dateKey, tz) {
  return dayStartMs(addDays(dateKey, 1), tz)
}

export function addDays(dateKey, n) {
  const { year, month, day } = parseDateKey(dateKey)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + n)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Inclusive list of date keys from `from` to `to`. */
export function dateKeyRange(from, to) {
  const out = []
  let cur = from
  // Guard against a reversed range producing an unbounded loop.
  if (dayStartMs(from, 'UTC') > dayStartMs(to, 'UTC')) return out
  for (let i = 0; i < 4000; i++) {
    out.push(cur)
    if (cur === to) break
    cur = addDays(cur, 1)
  }
  return out
}

export function minutesBetween(startMs, endMs) {
  return (endMs - startMs) / MIN
}

/**
 * `--at` accepts three shapes, and the caller needs to know which one it got in
 * order to give a useful error when the result lands in the future:
 *   relative   -20m, +90m, -2h
 *   timeOfDay  9:15, 9:15am, 14:30       (today, in the configured tz)
 *   absolute   2026-07-26T09:00, 2026-07-26 09:00, full ISO with offset or Z
 */
export function parseAt(spec, { tz, nowDate }) {
  const s = String(spec).trim()
  if (!s) throw new TrackerError('--at was empty', { hint: 'Try --at 9:15 or --at -20m.' })

  const rel = /^([+-])\s*(\d+(?:\.\d+)?)\s*([mh])$/i.exec(s)
  if (rel) {
    const sign = rel[1] === '-' ? -1 : 1
    const unit = rel[3].toLowerCase() === 'h' ? 60 : 1
    return { ms: nowDate.getTime() + sign * Number(rel[2]) * unit * MIN, kind: 'relative' }
  }

  const abs = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s)
  if (abs) {
    const [, y, mo, d, h, mi, sec, off] = abs
    if (off) {
      const iso = `${y}-${mo}-${d}T${(h ?? '00').padStart(2, '0')}:${mi ?? '00'}:${sec ?? '00'}${
        off.toUpperCase() === 'Z' ? 'Z' : off.includes(':') ? off : `${off.slice(0, 3)}:${off.slice(3)}`
      }`
      const t = Date.parse(iso)
      if (Number.isNaN(t)) throw new TrackerError(`could not parse --at ${spec}`, { hint: 'Try a full ISO instant.' })
      return { ms: t, kind: 'absolute' }
    }
    return {
      ms: zonedMs(
        { year: +y, month: +mo, day: +d, hour: +(h ?? 0), minute: +(mi ?? 0), second: +(sec ?? 0) },
        tz,
      ),
      kind: 'absolute',
    }
  }

  const tod = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])\.?m?\.?$|^(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(s)
  if (tod) {
    let hour
    let minute
    let sec
    if (tod[4]) {
      hour = Number(tod[1])
      minute = Number(tod[2] ?? 0)
      sec = Number(tod[3] ?? 0)
      if (hour < 1 || hour > 12) {
        throw new TrackerError(`--at ${spec}: hour must be 1-12 with am/pm`, { hint: 'Try --at 9:15am or --at 21:15.' })
      }
      const pm = tod[4].toLowerCase() === 'p'
      hour = hour === 12 ? (pm ? 12 : 0) : pm ? hour + 12 : hour
    } else {
      hour = Number(tod[5])
      minute = Number(tod[6])
      sec = Number(tod[7] ?? 0)
    }
    if (hour > 23 || minute > 59 || sec > 59) {
      throw new TrackerError(`--at ${spec}: not a valid time of day`, { hint: 'Use HH:MM in 24h form, or H:MMam/pm.' })
    }
    const today = parseDateKey(localDateKey(nowDate, tz))
    return { ms: zonedMs({ ...today, hour, minute, second: sec }, tz), kind: 'timeOfDay' }
  }

  throw new TrackerError(`could not parse --at ${spec}`, {
    hint: 'Accepted: 9:15, 9:15am, 14:30, -20m, -2h, 2026-07-26T09:00, or a full ISO instant.',
  })
}

/**
 * `start` and `stop` record something that already happened, so a resolved
 * instant in the future is always an error. The hint depends on which shape the
 * user wrote: a bare time that lands in the future is usually yesterday, and
 * guessing that silently would corrupt the data.
 */
export function assertNotFuture(parsed, { nowDate, flag = '--at' }) {
  if (parsed.ms <= nowDate.getTime()) return parsed
  if (parsed.kind === 'relative') {
    throw new TrackerError(`${flag} resolves to the future`, {
      hint: 'Relative offsets here must look backwards, e.g. -20m. Use `edit` to set a future timestamp.',
    })
  }
  if (parsed.kind === 'timeOfDay') {
    throw new TrackerError(`${flag} resolves to later today`, {
      hint: 'If you meant yesterday, pass the full date: --at 2026-07-26T23:00 (with the real date).',
    })
  }
  throw new TrackerError(`${flag} resolves to the future`, { hint: 'Times recorded by start/stop must be in the past.' })
}

export function humanMinutes(mins) {
  const sign = mins < 0 ? '-' : ''
  const total = Math.round(Math.abs(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${sign}${m}m`
  if (m === 0) return `${sign}${h}h`
  return `${sign}${h}h${String(m).padStart(2, '0')}m`
}
