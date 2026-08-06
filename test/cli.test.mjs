import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { readFileSync } from 'node:fs'
import { dayFilePath } from '../src/store.mjs'
import { run, runRaw, tempDataDir } from './helpers.mjs'

const NOW = '2026-07-27T17:00:00-05:00'
const dayFile = (dir, key) => JSON.parse(readFileSync(dayFilePath({ dataDir: dir }, key), 'utf8'))

describe('start / status / stop', () => {
  test('a full cycle records the right duration', (t) => {
    const dir = tempDataDir(t)
    const started = run(dir, ['start', 'Fix', 'checkout', 'webhook', 'retry', '--project', 'Client Co', '--at', '09:00'])
    assert.equal(started.data.entry.project, 'client-co')
    assert.equal(started.data.entry.end, null)

    const status = run(dir, ['status'])
    assert.equal(status.data.concurrency, 1)
    assert.equal(status.data.open[0].elapsedMinutes, 480)

    const stopped = run(dir, ['stop', '--at', '10:28'])
    assert.equal(stopped.data.stopped[0].durationMinutes, 88)
    assert.equal(dayFile(dir, '2026-07-27').entries[0].durationMinutes, 88)
  })

  test('start does not stop anything, and reports what else is running as info', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'First', '--project', 'A', '--at', '09:00'])
    const second = run(dir, ['start', 'Second', '--project', 'B', '--at', '10:00'])

    // Concurrency is the normal case here, so this must not be a warning.
    assert.equal(second.data.alsoOpen.length, 1)
    assert.equal(second.data.alsoOpen[0].task, 'First')
    assert.deepEqual(second.warnings, [])
    assert.equal(run(dir, ['status']).data.concurrency, 2)
  })

  test('a project is required', (t) => {
    const dir = tempDataDir(t)
    const failed = run(dir, ['start', 'No project'], { expectFail: true })
    assert.match(failed.error, /no project given/)
    assert.match(failed.hint, /--project/)
  })

  test('--at in the future is refused for start', (t) => {
    const dir = tempDataDir(t)
    assert.match(run(dir, ['start', 'X', '--project', 'A', '--at', '+5m'], { expectFail: true }).error, /future/)
    assert.match(
      run(dir, ['start', 'X', '--project', 'A', '--at', '23:00'], { expectFail: true }).error,
      /later today/,
    )
  })

  test('a negative relative --at works in both spellings', (t) => {
    // Regression: parseArgs rejects a value beginning with '-' as ambiguous, so the
    // documented `--at -20m` form failed while `--at=-20m` worked. Unit tests of
    // parseAt could not catch it — the argument never reached the parser.
    const dir = tempDataDir(t)
    const spaced = run(dir, ['start', 'Spaced', '--project', 'A', '--at', '-20m'])
    assert.equal(spaced.data.entry.start, '2026-07-27T16:40:00-05:00')

    const equals = run(dir, ['start', 'Equals', '--project', 'A', '--at=-2h'])
    assert.equal(equals.data.entry.start, '2026-07-27T15:00:00-05:00')
  })

  test('edit accepts negative relative --start and --end', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '10:00']).data.entry.id
    run(dir, ['stop', '--at', '11:00'])
    const edited = run(dir, ['edit', id, '--end', '-30m'])
    assert.equal(edited.data.entry.end, '2026-07-27T16:30:00-05:00')
  })

  test('a flag following a time option is not swallowed as its value', (t) => {
    // The '=' joining must be narrow enough that `--at --json` still errors rather
    // than silently consuming the next flag as a time.
    const dir = tempDataDir(t)
    assert.match(run(dir, ['start', 'X', '--project', 'A', '--at'], { expectFail: true }).error, /ambiguous|argument/)
  })

  test('stopping before the start is refused', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'X', '--project', 'A', '--at', '10:00'])
    assert.match(run(dir, ['stop', '--at', '09:00'], { expectFail: true }).error, /before the start/)
  })

  test('starting and immediately stopping is allowed, not a trap', (t) => {
    // Timestamps have second precision, so start-then-stop-at-once lands end === start.
    // Refusing it would leave an entry that cannot be stopped until the clock moves on.
    const dir = tempDataDir(t)
    run(dir, ['start', 'Oops wrong task', '--project', 'A'])
    const stopped = run(dir, ['stop', '--all'])
    assert.equal(stopped.data.stopped[0].durationMinutes, 0)
    assert.equal(run(dir, ['status']).data.concurrency, 0)
  })

  test('an entry started at an explicit time can be stopped at that same time', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'X', '--project', 'A', '--at', '10:00'])
    assert.equal(run(dir, ['stop', '--at', '10:00']).data.stopped[0].durationMinutes, 0)
  })
})

describe('concurrent entries', () => {
  const twoOpen = (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Webhook retry', '--project', 'Client', '--at', '09:00'])
    run(dir, ['start', 'Code review', '--project', 'Tracker', '--at', '10:00'])
    return dir
  }

  test('a bare stop with several running is an error listing both', (t) => {
    const dir = twoOpen(t)
    const failed = run(dir, ['stop'], { expectFail: true })
    assert.match(failed.error, /2 entries are running/)
    // The ids have to be in the output, or the user cannot act on it.
    assert.match(failed.hint, /Webhook retry/)
    assert.match(failed.hint, /Code review/)
    assert.equal(run(dir, ['status']).data.concurrency, 2, 'nothing should have been stopped')
  })

  test('stop with a query closes only the match', (t) => {
    const dir = twoOpen(t)
    const stopped = run(dir, ['stop', 'review', '--at', '11:00'])
    assert.equal(stopped.data.stopped.length, 1)
    assert.equal(stopped.data.stopped[0].task, 'Code review')
    assert.equal(run(dir, ['status']).data.concurrency, 1)
  })

  test('stop --all closes both', (t) => {
    const dir = twoOpen(t)
    assert.equal(run(dir, ['stop', '--all', '--at', '11:00']).data.stopped.length, 2)
    assert.equal(run(dir, ['status']).data.concurrency, 0)
  })

  test('an ambiguous query is an error, not a guess', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Review one', '--project', 'A', '--at', '09:00'])
    run(dir, ['start', 'Review two', '--project', 'A', '--at', '09:30'])
    assert.match(run(dir, ['stop', 'review'], { expectFail: true }).error, /matches 2 entries/)
  })

  test('switch closes everything and names what it closed', (t) => {
    const dir = twoOpen(t)
    const switched = run(dir, ['switch', 'Something', 'else', '--project', 'C', '--at', '11:00'])
    assert.equal(switched.data.closed.length, 2)
    assert.equal(switched.data.started.entry.task, 'Something else')
    assert.match(switched.message, /closed/)
    assert.match(switched.message, /Webhook retry/)
  })
})

describe('cross-midnight work', () => {
  const seedNight = (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Night deploy', '--project', 'Ops', '--at', '23:00'], { now: '2026-07-27T23:30:00-05:00' })
    return dir
  }
  const NEXT_DAY = '2026-07-28T10:00:00-05:00'

  test('an entry open since yesterday is visible to status', (t) => {
    const dir = seedNight(t)
    const status = run(dir, ['status'], { now: NEXT_DAY })
    assert.equal(status.data.open[0].carriedOver, true)
    assert.equal(status.data.open[0].dateKey, '2026-07-27')
  })

  test('and can be stopped, keeping the full duration', (t) => {
    const dir = seedNight(t)
    const stopped = run(dir, ['stop', 'night', '--at', '2026-07-28T02:00'], { now: NEXT_DAY })
    assert.equal(stopped.data.stopped[0].durationMinutes, 180)
  })

  test('and stays in the file of its start date', (t) => {
    const dir = seedNight(t)
    run(dir, ['stop', 'night', '--at', '2026-07-28T02:00'], { now: NEXT_DAY })
    assert.equal(dayFile(dir, '2026-07-27').entries.length, 1)
    assert.throws(() => dayFile(dir, '2026-07-28'), /ENOENT/)
  })

  test('each day is charged only its own share, and the range is not double-counted', (t) => {
    const dir = seedNight(t)
    run(dir, ['stop', 'night', '--at', '2026-07-28T02:00'], { now: NEXT_DAY })

    const first = run(dir, ['day', '2026-07-27', '--attribute'], { now: NEXT_DAY })
    const second = run(dir, ['day', '2026-07-28', '--attribute'], { now: NEXT_DAY })
    const both = run(dir, ['report', '--from', '2026-07-27', '--to', '2026-07-28', '--attribute'], { now: NEXT_DAY })

    assert.equal(first.data.totals.attributedMinutes, 60)
    assert.equal(second.data.totals.attributedMinutes, 120)
    assert.equal(both.data.totals.attributedMinutes, 180, 'must be 180, not 240')
  })
})

describe('reports', () => {
  /** Exact attributed values 27.5 / 17.5 / 5 over a 50-minute union. */
  const messyOverlap = (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Task A', '--project', 'P', '--at', '09:00'])
    run(dir, ['start', 'Task B', '--project', 'P', '--at', '09:10'])
    run(dir, ['start', 'Task C', '--project', 'P', '--at', '09:20'])
    run(dir, ['stop', 'Task C', '--at', '09:35'])
    run(dir, ['stop', 'Task A', '--at', '09:50'])
    run(dir, ['stop', 'Task B', '--at', '09:50'])
    return dir
  }

  test('attributed totals equal the wall clock actually occupied', (t) => {
    const dir = messyOverlap(t)
    const report = run(dir, ['day', '--attribute'])
    assert.deepEqual(
      report.data.projects[0].tasks.map((task) => [task.task, task.attributedMinutes]),
      [
        ['Task A', 27.5],
        ['Task B', 17.5],
        ['Task C', 5],
      ],
    )
    assert.equal(report.data.totals.attributedMinutes, 50)
    assert.equal(report.data.totals.unionMinutes, 50)
    assert.equal(report.data.totals.rawMinutes, 105)
  })

  test('rounded columns still sum to the rounded total', (t) => {
    const dir = messyOverlap(t)
    for (const step of ['6', '15']) {
      const report = run(dir, ['day', '--attribute', '--round', step])
      const leaves = report.data.projects[0].tasks.reduce((s, task) => s + task.roundedMinutes, 0)
      assert.equal(leaves, report.data.projects[0].roundedMinutes, `project row must equal its children at ${step}m`)
      assert.equal(leaves, report.data.totals.roundedMinutes, `total must equal the leaves at ${step}m`)
    }
  })

  test('naive rounding is offered but drifts, which is the point of the default', (t) => {
    const dir = messyOverlap(t)
    assert.equal(run(dir, ['day', '--attribute', '--round', '6']).data.rounding.residual, -2)
    assert.equal(run(dir, ['day', '--attribute', '--round', '6', '--no-balance']).data.rounding.residual, 4)
  })

  test('an entry that rounds away to zero is named in warnings', (t) => {
    const dir = messyOverlap(t)
    const report = run(dir, ['day', '--attribute', '--round', '15'])
    assert.equal(report.data.rounding.vanished.length, 1)
    assert.equal(report.data.rounding.vanished[0].task, 'Task C')
    assert.ok(
      report.warnings.some((w) => /rounded away to zero/.test(w) && /Task C/.test(w)),
      `expected a vanish warning, got ${JSON.stringify(report.warnings)}`,
    )
  })

  test('a range report groups project then task across days', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Day one', '--project', 'A', '--at', '2026-07-26T09:00'])
    run(dir, ['stop', '--all', '--at', '2026-07-26T10:00'])
    run(dir, ['start', 'Day two', '--project', 'A', '--at', '2026-07-27T09:00'])
    run(dir, ['stop', '--all', '--at', '2026-07-27T11:00'])
    const report = run(dir, ['report', '--from', '2026-07-26', '--to', '2026-07-27'])
    assert.equal(report.data.projects.length, 1)
    assert.equal(report.data.projects[0].tasks.length, 2)
    assert.equal(report.data.totals.windowMinutes, 180)
  })

  test('analyze reports the parallelism metrics', (t) => {
    const dir = messyOverlap(t)
    const analysis = run(dir, ['analyze']).data
    assert.equal(analysis.unionMinutes, 50)
    assert.equal(analysis.rawMinutes, 105)
    assert.equal(analysis.overlapMinutes, 55)
    assert.equal(analysis.maxConcurrency, 3)
    assert.ok(analysis.concurrencyHistogram.length >= 2)
    assert.ok(analysis.contextSwitches > 0)
  })

  test('an empty range is reported, not an error', (t) => {
    const dir = tempDataDir(t)
    const report = run(dir, ['day', '2026-01-01'])
    assert.deepEqual(report.data.projects, [])
    assert.match(report.message, /No time tracked/)
  })
})

describe('log', () => {
  test('writes one closed entry in a single command', (t) => {
    const dir = tempDataDir(t)
    const res = run(dir, ['log', 'Orion sync', '--project', 'orion', '--from', '8:00', '--to', '8:40'])
    assert.equal(res.data.entry.end != null, true, 'the entry must land closed')
    assert.equal(res.data.durationMinutes, 40)
    assert.equal(run(dir, ['status']).data.concurrency, 0, 'log must never leave a clock running')
  })

  test('is unaffected by an open clock, unlike start-then-stop', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Long running thing', '--project', 'P', '--at', '09:00'])
    // The two-command backfill would make a bare `stop` ambiguous here; log cannot.
    const res = run(dir, ['log', 'A meeting', '--project', 'P', '--from', '10:00', '--to', '11:00'])
    assert.equal(res.data.durationMinutes, 60)
    assert.equal(run(dir, ['status']).data.concurrency, 1, 'the pre-existing clock must be untouched')
  })

  test('carries tags, links and a note, and rejects a backwards range', (t) => {
    const dir = tempDataDir(t)
    const res = run(dir, [
      'log', 'Review', '--project', 'P', '--from', '9:00', '--to', '9:30',
      '--tags', 'bug', '--link', 'ticket=ENG-1', '--note', 'done',
    ])
    assert.deepEqual(res.data.entry.links, { ticket: 'ENG-1' })
    assert.deepEqual(res.data.entry.tags, ['bug'])
    assert.equal(res.data.entry.notes.length, 1)

    const bad = run(dir, ['log', 'Backwards', '--project', 'P', '--from', '10:00', '--to', '9:00'], { expectFail: true })
    assert.match(bad.error, /--to is before --from/)
  })

  test('requires both ends of the range', (t) => {
    const dir = tempDataDir(t)
    const res = run(dir, ['log', 'Half a range', '--project', 'P', '--from', '9:00'], { expectFail: true })
    assert.match(res.error, /--from and --to/)
    assert.match(res.hint, /`start`/, 'the hint should point at the running-clock command')
  })
})

describe('split', () => {
  test('cuts a closed entry in two with no gap and no overlap', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'verification', '--project', 'P', '--at', '09:00'])
    const stopped = run(dir, ['stop', '--at', '10:00']).data.stopped[0]
    const res = run(dir, ['split', stopped.id, '--at', '09:20', '--task', 'code vetting'])

    assert.equal(res.data.first.durationMinutes, 20)
    assert.equal(res.data.second.durationMinutes, 40)
    assert.equal(res.data.first.end, res.data.second.start, 'one boundary value, so no gap and no overlap')
    assert.equal(res.data.second.task, 'code vetting')
    assert.equal(res.data.first.task, 'verification', 'the first half keeps its name unless renamed')
  })

  test('an open entry stays open: the second half inherits the clock', (t) => {
    const dir = tempDataDir(t)
    const started = run(dir, ['start', 'one thing', '--project', 'P', '--at', '09:00'])
    const res = run(dir, ['split', started.data.entry.id, '--at', '09:30', '--task', 'another thing'])

    assert.equal(res.data.second.open, true)
    assert.equal(res.data.first.end, '2026-07-27T09:30:00-05:00')
    const status = run(dir, ['status'])
    assert.equal(status.data.concurrency, 1)
    assert.equal(status.data.open[0].task, 'another thing')
  })

  test('inherits project, tags, weight and links, and can rename both halves', (t) => {
    const dir = tempDataDir(t)
    run(dir, [
      'start', 'ticket title', '--project', 'P', '--at', '09:00',
      '--tags', 'a,b', '--weight', '0.5', '--link', 'ticket=ENG-1',
    ])
    const stopped = run(dir, ['stop', '--at', '10:00']).data.stopped[0]
    const res = run(dir, [
      'split', stopped.id, '--at', '09:30', '--first-task', 'first activity', '--task', 'second activity',
    ])

    assert.equal(res.data.first.task, 'first activity')
    assert.equal(res.data.second.task, 'second activity')
    assert.deepEqual(res.data.second.links, { ticket: 'ENG-1' })
    assert.deepEqual(res.data.second.tags, ['a', 'b'])
    assert.equal(res.data.second.weight, 0.5)
    assert.equal(res.data.second.project, 'p')
  })

  test('refuses a cut outside the entry, which would produce a zero-length half', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'thing', '--project', 'P', '--at', '09:00'])
    const stopped = run(dir, ['stop', '--at', '10:00']).data.stopped[0]

    assert.match(run(dir, ['split', stopped.id, '--at', '09:00'], { expectFail: true }).error, /at or before the start/)
    assert.match(run(dir, ['split', stopped.id, '--at', '10:00'], { expectFail: true }).error, /at or after the end/)
    assert.match(run(dir, ['split', stopped.id, '--at', '08:00'], { expectFail: true }).error, /at or before the start/)
  })
})

describe('export', () => {
  test('emits one flat row per entry with raw and attributed columns', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Task A', '--project', 'P', '--at', '09:00'])
    run(dir, ['start', 'Task B', '--project', 'P', '--at', '09:30'])
    run(dir, ['stop', '--all', '--at', '10:00'])
    const rows = run(dir, ['export', '--attribute']).data.rows
    assert.equal(rows.length, 2)
    assert.equal(rows[0].rawMinutes, 60)
    assert.equal(rows[0].attributedMinutes, 45) // 30 alone + half of the shared 30
    assert.equal(rows[1].attributedMinutes, 15)
  })

  test('csv escapes commas and quotes in task text', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Fix "retry", again', '--project', 'P', '--at', '09:00'])
    run(dir, ['stop', '--all', '--at', '10:00'])
    const csv = run(dir, ['export', '--format', 'csv']).message
    assert.match(csv, /"Fix ""retry"", again"/)
    assert.equal(csv.trim().split('\n').length, 2, 'the embedded comma must not create a new row')
  })
})

describe('projects', () => {
  test('punctuation and spacing variants resolve to one project', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'A', '--project', 'Client Co', '--at', '08:00'])
    const second = run(dir, ['start', 'B', '--project', 'clientco', '--at', '08:30'])
    assert.equal(second.data.entry.project, 'client-co')
    // An exact match modulo punctuation is not a guess, so it must not warn.
    assert.deepEqual(second.warnings, [])
    assert.equal(run(dir, ['projects', 'list']).data.projects.length, 1)
  })

  test('an alias resolves too', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'A', '--project', 'Client Co', '--at', '08:00'])
    run(dir, ['projects', 'alias', 'rd', 'client-co'])
    assert.equal(run(dir, ['start', 'C', '--project', 'rd', '--at', '09:00']).data.entry.project, 'client-co')
  })

  test('a fuzzy match is reused but always announced', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'A', '--project', 'Client Co', '--at', '08:00'])
    const typo = run(dir, ['start', 'D', '--project', 'clientc', '--at', '09:00'])
    assert.equal(typo.data.entry.project, 'client-co')
    assert.ok(
      typo.warnings.some((w) => /matched project "Client Co"/.test(w)),
      `a silent fuzzy merge is the failure mode; got ${JSON.stringify(typo.warnings)}`,
    )
  })

  test('a genuinely different name creates a new project', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'A', '--project', 'Client Co', '--at', '08:00'])
    run(dir, ['start', 'B', '--project', 'Platform Ops', '--at', '09:00'])
    assert.equal(run(dir, ['projects', 'list']).data.projects.length, 2)
  })

  test('merge rewrites entries and inherits the alias', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'A', '--project', 'Platform Ops', '--at', '08:00'])
    run(dir, ['stop', '--all', '--at', '09:00'])
    run(dir, ['start', 'B', '--project', 'Infra', '--at', '09:00'])
    run(dir, ['stop', '--all', '--at', '10:00'])

    const merged = run(dir, ['projects', 'merge', 'infra', 'platform-ops'])
    assert.equal(merged.data.entriesRewritten, 1)

    const projects = run(dir, ['projects', 'list']).data.projects
    assert.equal(projects.length, 1)
    assert.ok(projects[0].aliases.includes('Infra'))
    // Every entry now reports under the surviving project.
    assert.equal(run(dir, ['day']).data.projects.length, 1)
    assert.equal(run(dir, ['day']).data.projects[0].tasks.length, 2)
  })
})

describe('notes, links, edit, rm, resume', () => {
  test('note --last attaches to the only running entry', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'X', '--project', 'A', '--at', '09:00'])
    const noted = run(dir, ['note', '--last', 'root', 'cause:', 'idempotency', 'key'])
    assert.equal(noted.data.entry.notes.length, 1)
    assert.equal(noted.data.entry.notes[0].text, 'root cause: idempotency key')
  })

  test('note --last is ambiguous with several running', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'X', '--project', 'A', '--at', '09:00'])
    run(dir, ['start', 'Y', '--project', 'A', '--at', '09:30'])
    assert.match(run(dir, ['note', '--last', 'hi'], { expectFail: true }).error, /--last is ambiguous/)
  })

  test('link attaches a key=value pair', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    assert.equal(run(dir, ['link', id, 'linear=ENG-412']).data.entry.links.linear, 'ENG-412')
  })

  test('a malformed link is rejected', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    assert.match(run(dir, ['link', id, 'nonsense'], { expectFail: true }).error, /key=value/)
  })

  test('edit can set a future timestamp, unlike start', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    run(dir, ['stop', '--all', '--at', '10:00'])
    assert.ok(run(dir, ['edit', id, '--end', '+30m']).data.entry.end)
  })

  test('edit rejects an end before the start', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    run(dir, ['stop', '--all', '--at', '10:00'])
    assert.match(run(dir, ['edit', id, '--end', '08:00'], { expectFail: true }).error, /end cannot be before start/)
  })

  test('moving the start across a day boundary moves the entry between files', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    run(dir, ['stop', '--all', '--at', '10:00'])
    const edited = run(dir, ['edit', id, '--start', '2026-07-26T09:00'])
    assert.equal(edited.data.dateKey, '2026-07-26')
    assert.ok(edited.warnings.some((w) => /moved from 2026-07-27 to 2026-07-26/.test(w)))
    assert.equal(dayFile(dir, '2026-07-27').entries.length, 0)
    assert.equal(dayFile(dir, '2026-07-26').entries.length, 1)
  })

  test('rm echoes the deleted entry so it can be recreated', (t) => {
    const dir = tempDataDir(t)
    const id = run(dir, ['start', 'X', '--project', 'A', '--at', '09:00']).data.entry.id
    const removed = run(dir, ['rm', id])
    assert.equal(removed.data.deleted.id, id)
    assert.equal(removed.data.deleted.start, '2026-07-27T09:00:00-05:00')
    assert.equal(dayFile(dir, '2026-07-27').entries.length, 0)
  })

  test('resume copies task, project and links into a new entry', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'Webhook retry', '--project', 'Client', '--at', '09:00', '--link', 'linear=ENG-412'])
    run(dir, ['stop', '--all', '--at', '10:00'])
    const resumed = run(dir, ['resume', 'webhook'])
    assert.equal(resumed.data.entry.task, 'Webhook retry')
    assert.equal(resumed.data.entry.links.linear, 'ENG-412')
    assert.equal(resumed.data.entry.end, null)
  })
})

describe('the output contract', () => {
  test('every command emits a well-formed success envelope', (t) => {
    const dir = tempDataDir(t)
    run(dir, ['start', 'X', '--project', 'A', '--at', '09:00'])
    for (const args of [
      ['status'],
      ['today'],
      ['day'],
      ['report', '--week'],
      ['analyze'],
      ['export'],
      ['projects', 'list'],
    ]) {
      const result = run(dir, args)
      assert.equal(result.ok, true, `${args[0]} should succeed`)
      assert.equal(result.schemaVersion, 1, `${args[0]} must carry schemaVersion`)
      assert.equal(result.command, args[0])
      assert.ok(Array.isArray(result.warnings), `${args[0]} must have a warnings array`)
      assert.equal(result.status, 0)
    }
  })

  test('an unknown command is a failure envelope, exit 1, nothing else on stdout', (t) => {
    const dir = tempDataDir(t)
    const failed = run(dir, ['bogus'], { expectFail: true })
    assert.equal(failed.status, 1)
    assert.match(failed.error, /unknown command: bogus/)
    assert.match(failed.hint, /Known commands/)
  })

  test('an unknown flag is converted, not leaked as a stack trace', (t) => {
    const dir = tempDataDir(t)
    const failed = run(dir, ['start', 'X', '--nope'], { expectFail: true })
    assert.match(failed.error, /Unknown option/)
    assert.doesNotMatch(failed.error, /at \w+ \(/, 'a stack trace must never reach the caller')
    assert.match(failed.hint, /--help/)
  })

  test('bad --format and --strategy values are rejected with the valid options', (t) => {
    const dir = tempDataDir(t)
    assert.match(run(dir, ['day', '--format', 'xml'], { expectFail: true }).hint, /md, json or csv/)
    assert.match(run(dir, ['day', '--strategy', 'vibes'], { expectFail: true }).hint, /equal, weighted, exclusive/)
  })

  test('without --json, warnings go to stderr and content to stdout', (t) => {
    const dir = tempDataDir(t)
    runRaw(dir, ['start', 'A', '--project', 'Client Co', '--at', '08:00'])
    const result = runRaw(dir, ['start', 'D', '--project', 'clientc', '--at', '09:00'])
    assert.match(result.stdout, /^started /)
    assert.match(result.stderr, /warning: matched project/)
    assert.equal(result.status, 0)
  })

  test('errors go to stderr with a hint, and exit 1', (t) => {
    const dir = tempDataDir(t)
    const result = runRaw(dir, ['stop'])
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /error: nothing is running/)
    assert.match(result.stderr, /hint:/)
  })
})
