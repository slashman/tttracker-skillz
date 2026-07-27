import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SCHEMA_VERSION } from '../src/config.mjs'
import { dayFilePath, findOpenEntries, newId, readDay, writeDay } from '../src/store.mjs'
import { tempDataDir } from './helpers.mjs'

const TZ = 'America/Bogota'
const cfg = (dataDir) => ({ dataDir, tz: TZ, autoCommit: false, lookbackDays: 3 })

function seed(dataDir, dateKey, entries, extra = {}) {
  const file = dayFilePath(cfg(dataDir), dateKey)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ schemaVersion: SCHEMA_VERSION, date: dateKey, tz: TZ, entries, ...extra }, null, 2))
  return file
}

const entry = (over = {}) => ({
  id: 'aaa111',
  project: 'p',
  task: 'a task',
  start: '2026-07-27T09:00:00-05:00',
  end: '2026-07-27T10:28:00-05:00',
  tags: [],
  notes: [],
  links: {},
  ...over,
})

describe('day files', () => {
  test('a missing day reads as empty rather than throwing', (t) => {
    const dir = tempDataDir(t)
    const day = readDay(cfg(dir), '2026-07-27')
    assert.deepEqual(day.entries, [])
    assert.equal(day.schemaVersion, SCHEMA_VERSION)
  })

  test('writes are atomic and leave no temp file behind', (t) => {
    const dir = tempDataDir(t)
    const c = cfg(dir)
    writeDay(c, { date: '2026-07-27', tz: TZ, entries: [entry()] })
    const file = dayFilePath(c, '2026-07-27')
    assert.ok(existsSync(file))
    assert.equal(existsSync(`${file}.tmp-${process.pid}`), false)
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')))
  })

  test('entries are stored sorted by start', (t) => {
    const dir = tempDataDir(t)
    const written = writeDay(cfg(dir), {
      date: '2026-07-27',
      tz: TZ,
      entries: [
        entry({ id: 'late00', start: '2026-07-27T14:00:00-05:00', end: '2026-07-27T15:00:00-05:00' }),
        entry({ id: 'early0', start: '2026-07-27T08:00:00-05:00', end: '2026-07-27T09:00:00-05:00' }),
      ],
    })
    assert.deepEqual(
      written.entries.map((e) => e.id),
      ['early0', 'late00'],
    )
  })

  test('durationMinutes is recomputed from the instants, never trusted from the file', (t) => {
    const dir = tempDataDir(t)
    // A file claiming a wildly wrong duration must not be believed.
    seed(dir, '2026-07-27', [entry({ durationMinutes: 99999 })])
    assert.equal(readDay(cfg(dir), '2026-07-27').entries[0].durationMinutes, 88)
  })

  test('an interrupted write leaves the real file readable', (t) => {
    const dir = tempDataDir(t)
    const c = cfg(dir)
    writeDay(c, { date: '2026-07-27', tz: TZ, entries: [entry()] })
    const file = dayFilePath(c, '2026-07-27')
    // Simulate a crash mid-write: a stray temp file with truncated JSON.
    writeFileSync(`${file}.tmp-999999`, '{"schemaVersion":1,"entries":[{"id":"trunc')
    const day = readDay(c, '2026-07-27')
    assert.equal(day.entries.length, 1)
    assert.equal(day.entries[0].id, 'aaa111')
  })

  test('a corrupt day file fails loudly with a hint', (t) => {
    const dir = tempDataDir(t)
    const file = dayFilePath(cfg(dir), '2026-07-27')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{not json')
    assert.throws(() => readDay(cfg(dir), '2026-07-27'), /is not valid JSON/)
  })
})

describe('schemaVersion', () => {
  test('a newer file is refused, not misparsed', (t) => {
    const dir = tempDataDir(t)
    seed(dir, '2026-07-27', [entry()], { schemaVersion: SCHEMA_VERSION + 1 })
    assert.throws(
      () => readDay(cfg(dir), '2026-07-27'),
      (err) => {
        assert.match(err.message, /written by a newer tracker/)
        assert.match(err.hint, /Update this checkout/)
        return true
      },
    )
  })

  test('a file with no version is treated as version 1 and migrated on write', (t) => {
    const dir = tempDataDir(t)
    const c = cfg(dir)
    const file = dayFilePath(c, '2026-07-27')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ date: '2026-07-27', tz: TZ, entries: [entry()] }))
    const day = readDay(c, '2026-07-27')
    assert.equal(day.schemaVersion, SCHEMA_VERSION)
    writeDay(c, day)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, SCHEMA_VERSION)
  })
})

describe('findOpenEntries', () => {
  const now = new Date('2026-07-28T15:00:00-05:00')

  test('finds an entry left open yesterday, flagged as carried over', (t) => {
    const dir = tempDataDir(t)
    seed(dir, '2026-07-27', [entry({ id: 'night0', start: '2026-07-27T23:00:00-05:00', end: null })])
    const open = findOpenEntries(cfg(dir), { nowDate: now })
    assert.equal(open.length, 1)
    assert.equal(open[0].entry.id, 'night0')
    assert.equal(open[0].dateKey, '2026-07-27')
    assert.equal(open[0].carriedOver, true)
  })

  test('ignores closed entries', (t) => {
    const dir = tempDataDir(t)
    seed(dir, '2026-07-28', [entry({ start: '2026-07-28T09:00:00-05:00', end: '2026-07-28T10:00:00-05:00' })])
    assert.deepEqual(findOpenEntries(cfg(dir), { nowDate: now }), [])
  })

  test('respects the lookback window', (t) => {
    const dir = tempDataDir(t)
    seed(dir, '2026-07-20', [entry({ id: 'stale0', start: '2026-07-20T09:00:00-05:00', end: null })])
    assert.equal(findOpenEntries(cfg(dir), { nowDate: now }).length, 0)
    assert.equal(findOpenEntries(cfg(dir), { nowDate: now, lookbackDays: 30 }).length, 1)
  })

  test('returns several open entries sorted by start', (t) => {
    const dir = tempDataDir(t)
    seed(dir, '2026-07-28', [
      entry({ id: 'second', start: '2026-07-28T10:00:00-05:00', end: null }),
      entry({ id: 'first0', start: '2026-07-28T09:00:00-05:00', end: null }),
    ])
    assert.deepEqual(
      findOpenEntries(cfg(dir), { nowDate: now }).map((o) => o.entry.id),
      ['first0', 'second'],
    )
  })
})

describe('newId', () => {
  test('avoids collisions with ids already in the day', () => {
    const taken = Array.from({ length: 50 }, (_, i) => `id${String(i).padStart(4, '0')}`)
    const id = newId(taken)
    assert.equal(taken.includes(id), false)
    assert.match(id, /^[0-9a-z]{6}$/)
  })
})
