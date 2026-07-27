import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { apportion, attribute } from '../src/attribute.mjs'

const DAY = '2026-07-27'
const at = (hhmm) => Date.parse(`${DAY}T${hhmm}:00-05:00`)
const WINDOW = { windowStart: at('00:00'), windowEnd: Date.parse('2026-07-28T00:00:00-05:00') }

/** The worked example from the design: A 9-12, B 10-11, C 11:30-13, D 14-14:30. */
const EXAMPLE = [
  { id: 'A', startMs: at('09:00'), endMs: at('12:00') },
  { id: 'B', startMs: at('10:00'), endMs: at('11:00') },
  { id: 'C', startMs: at('11:30'), endMs: at('13:00') },
  { id: 'D', startMs: at('14:00'), endMs: at('14:30') },
]

const totalOf = (result) => Object.values(result.attributed).reduce((a, b) => a + b, 0)

describe('attribute: the worked example', () => {
  test('equal splits each overlapping moment evenly', () => {
    const r = attribute(EXAMPLE, { ...WINDOW, strategy: 'equal' })
    assert.deepEqual(r.attributed, { A: 135, B: 30, C: 75, D: 30 })
    assert.equal(r.rawMinutes, 360)
    assert.equal(r.unionMinutes, 270)
  })

  test('weighted splits in proportion to weight', () => {
    const weighted = EXAMPLE.map((e) => ({ ...e, weight: e.id === 'A' ? 3 : 1 }))
    const r = attribute(weighted, { ...WINDOW, strategy: 'weighted' })
    assert.deepEqual(r.attributed, { A: 157.5, B: 15, C: 67.5, D: 30 })
  })

  test('exclusive gives each moment to the most recently started task', () => {
    const r = attribute(EXAMPLE, { ...WINDOW, strategy: 'exclusive' })
    assert.deepEqual(r.attributed, { A: 90, B: 60, C: 90, D: 30 })
  })

  test('reports the parallelism metrics', () => {
    const r = attribute(EXAMPLE, { ...WINDOW })
    assert.equal(r.overlapFactor, 1.333)
    assert.equal(r.maxConcurrency, 2)
    assert.equal(r.contextSwitches, 5)
    assert.deepEqual(r.histogram, [
      { concurrency: 1, minutes: 180 },
      { concurrency: 2, minutes: 90 },
    ])
  })
})

describe('attribute: the invariant', () => {
  // This is the correctness property the whole feature rests on: however the time is
  // apportioned, the per-task totals must add up to the wall clock actually occupied.
  for (const strategy of ['equal', 'weighted', 'exclusive']) {
    test(`sum(attributed) === unionMinutes for ${strategy}, over 400 random interval sets`, () => {
      // A small deterministic LCG: a property test that cannot be reproduced is not
      // much use when it fails.
      let seed = 0x2f6e2b1
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }

      for (let iteration = 0; iteration < 400; iteration++) {
        const count = 1 + Math.floor(rand() * 6)
        const intervals = []
        for (let i = 0; i < count; i++) {
          const start = Math.floor(rand() * 1400)
          const length = Math.floor(rand() * 200) // may be 0, which must be skipped
          intervals.push({
            id: `e${i}`,
            startMs: at('00:00') + start * 60_000,
            endMs: at('00:00') + (start + length) * 60_000,
            weight: 1 + Math.floor(rand() * 4),
          })
        }
        const r = attribute(intervals, { ...WINDOW, strategy })
        assert.ok(
          Math.abs(totalOf(r) - r.unionMinutes) < 1e-9,
          `iteration ${iteration}: total ${totalOf(r)} !== union ${r.unionMinutes}`,
        )
        assert.ok(r.rawMinutes >= r.unionMinutes - 1e-9, 'raw can never be less than the union')
      }
    })
  }
})

describe('attribute: edge cases', () => {
  test('gaps contribute nothing', () => {
    const r = attribute(
      [
        { id: 'A', startMs: at('09:00'), endMs: at('10:00') },
        { id: 'B', startMs: at('14:00'), endMs: at('15:00') },
      ],
      { ...WINDOW },
    )
    assert.equal(r.unionMinutes, 120)
    assert.equal(r.maxConcurrency, 1)
    assert.equal(r.contextSwitches, 1)
  })

  test('a fully contained interval is handled', () => {
    const r = attribute(
      [
        { id: 'outer', startMs: at('09:00'), endMs: at('12:00') },
        { id: 'inner', startMs: at('10:00'), endMs: at('11:00') },
      ],
      { ...WINDOW },
    )
    assert.deepEqual(r.attributed, { outer: 150, inner: 30 })
    assert.equal(totalOf(r), r.unionMinutes)
  })

  test('identical intervals split evenly', () => {
    const r = attribute(
      [
        { id: 'A', startMs: at('09:00'), endMs: at('10:00') },
        { id: 'B', startMs: at('09:00'), endMs: at('10:00') },
        { id: 'C', startMs: at('09:00'), endMs: at('10:00') },
      ],
      { ...WINDOW },
    )
    assert.deepEqual(r.attributed, { A: 20, B: 20, C: 20 })
    assert.equal(r.unionMinutes, 60)
  })

  test('zero-length intervals are dropped, not counted', () => {
    const r = attribute(
      [
        { id: 'A', startMs: at('09:00'), endMs: at('09:00') },
        { id: 'B', startMs: at('09:00'), endMs: at('10:00') },
      ],
      { ...WINDOW },
    )
    assert.deepEqual(r.attributed, { B: 60 })
    assert.equal(r.intervalCount, 1)
  })

  test('no intervals at all is not an error', () => {
    const r = attribute([], { ...WINDOW })
    assert.deepEqual(r.attributed, {})
    assert.equal(r.unionMinutes, 0)
    assert.equal(r.overlapFactor, 0)
    assert.equal(r.maxConcurrency, 0)
  })

  test('exclusive breaks start-time ties deterministically', () => {
    const tied = [
      { id: 'zzz', startMs: at('09:00'), endMs: at('10:00') },
      { id: 'aaa', startMs: at('09:00'), endMs: at('10:00') },
    ]
    const first = attribute(tied, { ...WINDOW, strategy: 'exclusive' })
    const second = attribute([...tied].reverse(), { ...WINDOW, strategy: 'exclusive' })
    assert.deepEqual(first.attributed, second.attributed)
    assert.equal(first.attributed.aaa, 60)
  })

  test('an unknown strategy is rejected', () => {
    assert.throws(() => attribute(EXAMPLE, { ...WINDOW, strategy: 'vibes' }), /unknown attribution strategy/)
  })
})

describe('attribute: window clipping', () => {
  const crossMidnight = [{ id: 'night', startMs: Date.parse(`${DAY}T23:00:00-05:00`), endMs: Date.parse('2026-07-28T02:00:00-05:00') }]

  test('a 23:00-02:00 entry gives 60 minutes to the first day', () => {
    const r = attribute(crossMidnight, { windowStart: at('00:00'), windowEnd: Date.parse('2026-07-28T00:00:00-05:00') })
    assert.equal(r.attributed.night, 60)
  })

  test('and 120 minutes to the second day', () => {
    const r = attribute(crossMidnight, {
      windowStart: Date.parse('2026-07-28T00:00:00-05:00'),
      windowEnd: Date.parse('2026-07-29T00:00:00-05:00'),
    })
    assert.equal(r.attributed.night, 120)
  })

  test('and 180 minutes across a window covering both, not 240', () => {
    const r = attribute(crossMidnight, { windowStart: at('00:00'), windowEnd: Date.parse('2026-07-29T00:00:00-05:00') })
    assert.equal(r.attributed.night, 180)
  })

  test('an interval entirely outside the window is dropped', () => {
    const r = attribute([{ id: 'old', startMs: at('09:00'), endMs: at('10:00') }], {
      windowStart: Date.parse('2026-07-28T00:00:00-05:00'),
      windowEnd: Date.parse('2026-07-29T00:00:00-05:00'),
    })
    assert.deepEqual(r.attributed, {})
  })

  test('an open interval clips at openEndMs, not the end of the window', () => {
    const r = attribute([{ id: 'running', startMs: at('09:00'), endMs: null }], {
      ...WINDOW,
      openEndMs: at('10:30'),
    })
    assert.equal(r.attributed.running, 90)
  })
})

describe('apportion: rounding', () => {
  // The measured numbers from the design work. Naive rounding of fractional
  // attributed values makes the columns stop adding up; these pin both behaviours.
  const CASES = [
    { vals: [27.5, 17.5, 5], total: 50, step: 6, balanced: [24, 18, 6], naiveResidual: 4 },
    { vals: [27.5, 17.5, 5], total: 50, step: 15, balanced: [30, 15, 0], naiveResidual: -5 },
    { vals: [20, 20, 20], total: 60, step: 6, balanced: [24, 18, 18], naiveResidual: -6 },
    { vals: [20, 20, 20], total: 60, step: 15, balanced: [30, 15, 15], naiveResidual: -15 },
    { vals: [135, 30, 75, 30], total: 270, step: 6, balanced: [138, 30, 72, 30], naiveResidual: 6 },
    { vals: [135, 30, 75, 30], total: 270, step: 15, balanced: [135, 30, 75, 30], naiveResidual: 0 },
    { vals: [52.5, 5, 2.5], total: 60, step: 6, balanced: [54, 6, 0], naiveResidual: 0 },
    { vals: [52.5, 5, 2.5], total: 60, step: 15, balanced: [60, 0, 0], naiveResidual: 0 },
  ]

  for (const c of CASES) {
    test(`balanced [${c.vals}] at ${c.step}m sums to the target`, () => {
      const r = apportion(c.vals, c.step, { total: c.total })
      assert.deepEqual(r.rounded, c.balanced)
      assert.equal(
        r.rounded.reduce((a, b) => a + b, 0),
        r.target,
        'rounded columns must sum to the rounded target',
      )
    })

    test(`naive [${c.vals}] at ${c.step}m drifts by ${c.naiveResidual}`, () => {
      const r = apportion(c.vals, c.step, { total: c.total, balance: false })
      assert.equal(r.residual, c.naiveResidual)
    })
  }

  test('reports entries that round away to zero', () => {
    const r = apportion([52.5, 5, 2.5], 15, { total: 60 })
    assert.deepEqual(r.vanished, [1, 2])
  })

  test('nothing vanishes when every value clears the step', () => {
    assert.deepEqual(apportion([30, 30], 15, { total: 60 }).vanished, [])
  })

  test('a zero or missing step is a no-op', () => {
    assert.deepEqual(apportion([27.5, 17.5], 0).rounded, [27.5, 17.5])
    assert.deepEqual(apportion([27.5, 17.5], null).rounded, [27.5, 17.5])
  })

  test('balanced apportionment is deterministic on tied remainders', () => {
    const a = apportion([10, 10, 10], 15, { total: 30 })
    const b = apportion([10, 10, 10], 15, { total: 30 })
    assert.deepEqual(a.rounded, b.rounded)
    assert.equal(
      a.rounded.reduce((x, y) => x + y, 0),
      30,
    )
  })
})
