import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  addDays,
  assertNotFuture,
  dateKeyRange,
  dayEndMs,
  dayStartMs,
  formatOffset,
  humanMinutes,
  localDateKey,
  offsetMinutes,
  parseAt,
  toLocalISO,
} from '../src/time.mjs'

const TZ = 'America/Bogota'
const nowDate = new Date('2026-07-27T14:00:00Z') // 09:00 local in Bogota

describe('timezone handling', () => {
  test('offsets are read from Intl, including 45-minute zones', () => {
    assert.equal(offsetMinutes(TZ, nowDate), -300)
    assert.equal(offsetMinutes('UTC', nowDate), 0)
    assert.equal(offsetMinutes('Asia/Kolkata', nowDate), 330)
    assert.equal(offsetMinutes('Australia/Eucla', nowDate), 525)
  })

  test('DST is followed rather than assumed', () => {
    assert.equal(offsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z')), 60)
    assert.equal(offsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z')), 0)
  })

  test('offsets format back to ISO form', () => {
    assert.equal(formatOffset(-300), '-05:00')
    assert.equal(formatOffset(525), '+08:45')
    assert.equal(formatOffset(0), '+00:00')
  })

  test('instants render as local ISO with offset, not UTC', () => {
    assert.equal(toLocalISO(nowDate, TZ), '2026-07-27T09:00:00-05:00')
    assert.equal(localDateKey(nowDate, TZ), '2026-07-27')
  })

  test('the local day key follows the zone, not UTC', () => {
    // 02:00Z on the 28th is still the 27th in Bogota.
    assert.equal(localDateKey(new Date('2026-07-28T02:00:00Z'), TZ), '2026-07-27')
  })

  test('day boundaries are local midnight', () => {
    assert.equal(toLocalISO(new Date(dayStartMs('2026-07-27', TZ)), TZ), '2026-07-27T00:00:00-05:00')
    assert.equal(toLocalISO(new Date(dayEndMs('2026-07-27', TZ)), TZ), '2026-07-28T00:00:00-05:00')
  })

  test('midnight resolves on a DST transition day', () => {
    // 2025-11-02 is the US fall-back date; midnight is still on the pre-transition offset.
    assert.equal(
      toLocalISO(new Date(dayStartMs('2025-11-02', 'America/New_York')), 'America/New_York'),
      '2025-11-02T00:00:00-04:00',
    )
  })
})

describe('date keys', () => {
  test('addDays crosses month and year boundaries', () => {
    assert.equal(addDays('2026-07-31', 1), '2026-08-01')
    assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  })

  test('ranges are inclusive, and a reversed range is empty rather than infinite', () => {
    assert.deepEqual(dateKeyRange('2026-07-26', '2026-07-28'), ['2026-07-26', '2026-07-27', '2026-07-28'])
    assert.deepEqual(dateKeyRange('2026-07-28', '2026-07-26'), [])
  })
})

describe('--at parsing', () => {
  const at = (spec) => parseAt(spec, { tz: TZ, nowDate })
  const iso = (spec) => toLocalISO(new Date(at(spec).ms), TZ)

  test('bare times of day', () => {
    assert.equal(iso('9:15'), '2026-07-27T09:15:00-05:00')
    assert.equal(iso('14:30'), '2026-07-27T14:30:00-05:00')
    assert.equal(at('9:15').kind, 'timeOfDay')
  })

  test('12-hour times, including the 12am/12pm corners', () => {
    assert.equal(iso('9:15am'), '2026-07-27T09:15:00-05:00')
    assert.equal(iso('8am'), '2026-07-27T08:00:00-05:00')
    assert.equal(iso('12am'), '2026-07-27T00:00:00-05:00')
    assert.equal(iso('12pm'), '2026-07-27T12:00:00-05:00')
  })

  test('relative offsets', () => {
    assert.equal(iso('-20m'), '2026-07-27T08:40:00-05:00')
    assert.equal(iso('-2h'), '2026-07-27T07:00:00-05:00')
    assert.equal(at('-20m').kind, 'relative')
  })

  test('absolute forms, with and without an explicit offset', () => {
    assert.equal(iso('2026-07-26T09:00'), '2026-07-26T09:00:00-05:00')
    assert.equal(iso('2026-07-26 09:00'), '2026-07-26T09:00:00-05:00')
    assert.equal(iso('2026-07-26T09:00:00-05:00'), '2026-07-26T09:00:00-05:00')
    assert.equal(iso('2026-07-26T14:00:00Z'), '2026-07-26T09:00:00-05:00')
    assert.equal(at('2026-07-26T09:00').kind, 'absolute')
  })

  test('nonsense is rejected with a hint rather than silently accepted', () => {
    for (const bad of ['25:00', '9:99', 'nonsense', '', '  ']) {
      assert.throws(() => at(bad), /could not parse|not a valid time|was empty/, `should reject ${JSON.stringify(bad)}`)
    }
  })

  test('a 12-hour clock hour outside 1-12 is rejected', () => {
    assert.throws(() => at('13pm'), /hour must be 1-12/)
  })
})

describe('future timestamps', () => {
  // start and stop record something that already happened, so a future instant is
  // always an error - and the hint has to differ by shape, because a bare time that
  // lands in the future usually means yesterday and guessing would corrupt data.
  test('+Nm is rejected for start/stop by construction', () => {
    assert.throws(
      () => assertNotFuture(parseAt('+5m', { tz: TZ, nowDate }), { nowDate }),
      /resolves to the future/,
    )
  })

  test('a bare time later today is rejected, and says to pass a full date', () => {
    try {
      assertNotFuture(parseAt('23:00', { tz: TZ, nowDate }), { nowDate })
      assert.fail('should have thrown')
    } catch (err) {
      assert.match(err.message, /later today/)
      assert.match(err.hint, /full date/)
    }
  })

  test('a past instant passes through untouched', () => {
    const parsed = parseAt('-20m', { tz: TZ, nowDate })
    assert.equal(assertNotFuture(parsed, { nowDate }), parsed)
  })
})

describe('humanMinutes', () => {
  test('formats durations compactly', () => {
    assert.equal(humanMinutes(0), '0m')
    assert.equal(humanMinutes(45), '45m')
    assert.equal(humanMinutes(60), '1h')
    assert.equal(humanMinutes(88), '1h28m')
    assert.equal(humanMinutes(-30), '-30m')
  })
})
