# Data and output contract

`schemaVersion` is currently **1**. It appears on every day file and every JSON payload.

This data is meant to outlive the code that wrote it — that's the point of the tool — so a
reader is never left guessing what shape it has. `store.mjs` **refuses** a day file whose
`schemaVersion` is newer than the build reading it, rather than misparsing it, and migrates
older files forward when it next writes them.

## Day files

`<dataDir>/days/YYYY/MM/YYYY-MM-DD.json`

```json
{
  "schemaVersion": 1,
  "date": "2026-07-27",
  "tz": "America/Bogota",
  "entries": [
    {
      "id": "k3f9x2",
      "project": "client-co",
      "task": "Fix checkout webhook retry",
      "start": "2026-07-27T09:12:04-05:00",
      "end": "2026-07-27T10:40:00-05:00",
      "durationMinutes": 88,
      "weight": 1,
      "tags": ["bug"],
      "notes": [{ "at": "2026-07-27T10:05:00-05:00", "text": "root cause: idempotency key" }],
      "links": { "linear": "ENG-412" }
    }
  ]
}
```

| Field | Notes |
| :-- | :-- |
| `id` | 6-char base36, unique within the day file. |
| `project` | A project **id** (slug), not a display name. Names live in `projects.json`. |
| `start` / `end` | Local ISO **with offset**, not UTC `Z`, so the file reads naturally in its own git history. `end: null` means still running. |
| `durationMinutes` | A convenience for humans reading the JSON. **Never a source of truth** — always recomputed from the two instants on read. |
| `weight` | Positive number, default 1. Only meaningful to the `weighted` attribution strategy. |
| `links` | Free-form `{key: value}`. The CLI is deliberately service-agnostic; `linear`, `jira`, `github` are just keys. |

Two rules worth knowing before reading day files directly:

- **An entry lives in the file of its `start` date.** Work that begins at 23:00 and ends at
  02:00 stays in the earlier day's file, with an `end` on the following date.
- **Durations come from the instants.** Because both carry an offset, a DST transition or a
  timezone change cannot corrupt past totals.

`<dataDir>/projects.json` is a flat array of `{id, name, aliases[], createdAt, meta{}}`.

## Command envelope

Every command with `--json` writes exactly one line to stdout and nothing else:

```json
{ "ok": true,  "schemaVersion": 1, "command": "start", "data": {}, "message": "", "warnings": [] }
{ "ok": false, "schemaVersion": 1, "command": "start", "error": "…", "hint": "…" }
```

Failure exits 1. Unknown commands and unknown flags produce the failure envelope too — a
caller that asked for JSON never gets prose or a stack trace.

## Attribution

On a parallel day raw durations sum to more hours than the day contains. Attribution splits
each moment among the tasks active at that moment. The invariant, enforced by a property test
over randomly generated interval sets:

```
sum(attributed) === unionMinutes        for every strategy
```

| Strategy | Meaning |
| :-- | :-- |
| `equal` | Each moment split evenly among the tasks running then. |
| `weighted` | Split in proportion to per-entry `weight`. Models one foreground task among background ones. |
| `exclusive` | Each moment goes entirely to the most recently started open task. Models "only one thing really had my attention". |

What this does **not** claim: how long a task would have taken without multitasking overhead.
That is a counterfactual about focus, and timestamps cannot support it. The honest derived
number is `analyze.overlapMinutes` (`raw − union`): how much apparent effort was overlap.

**Windowing.** Attribution runs over a window and clips every interval to it; open entries clip
at *now*. A 23:00–02:00 entry contributes 60 minutes to the first day and 120 to the second.
Reports over a range attribute in a single sweep over the whole range, not per-day-then-summed,
which is what keeps cross-midnight work from being double-counted.

## Rounding

Rounding attributed values naively **breaks the invariant**, because the exact values are
fractional. Measured on exact `[27.5, 17.5, 5.0]` against a 50-minute union:

| | Task A | Task B | Task C | Total |
| :-- | --: | --: | --: | --: |
| exact | 27.5 | 17.5 | 5.0 | 50 |
| `--round 6` naive | 30 | 18 | 6 | **54** ✗ |
| `--round 6` balanced | 24 | 18 | 6 | **48** ✓ |
| `--round 15` naive | 30 | 15 | 0 | 45 |
| `--round 15` balanced | 30 | 15 | 0 | 45 |

So rounding attributed values uses **largest-remainder (Hamilton) apportionment** by default:
floor everything onto the grid, then hand the leftover units to the largest fractional
remainders. `--no-balance` opts back into naive rounding. The visible trade-off is that
balancing can nudge a value off its own nearest step — exact 135 becomes 138 at 6-minute
granularity — in order to make the column sum right.

`rounding.residual` reports rounded-total minus exact-total. It is non-zero whenever the day
simply doesn't fit the grid (50 minutes on a 6-minute grid is 48), and that is reported rather
than hidden.

**A short task can round away to nothing.** At 15-minute granularity a real 5-minute task
becomes 0; `[52.5, 5, 2.5]` loses two of three entries. That is inherent to a coarse grid, so
it is never silent: `rounding.vanished` names every affected entry and a `warnings` string
spells it out. Suppressing this is how a timesheet ends up quietly wrong.

## The timesheet seam

Summarizing tracked time into timesheets is a downstream job this repo does not do. The
contract for it is:

```
node ./bin/tracker.mjs report --week --attribute --strategy equal --round 15 --format json
```

`data` contains `schemaVersion`, `range`, `attribution` (strategy, explanation, raw / attributed /
union minutes, overlap factor), `rounding` (step, balanced, residual, vanished), `projects[]`
grouped project → task with raw / window / attributed / rounded minutes, and `totals`.
`warnings[]` carries anything a generator must not silently drop.

Rounded parent rows are always the sum of their rounded children, so columns add up as
displayed.

## Flat export

For analysis rather than presentation:

```
node ./bin/tracker.mjs export --from 2026-07-01 --to 2026-07-31 --attribute --format csv
```

One row per entry: `id, dateKey, project, task, start, end, open, weight, rawMinutes,
windowMinutes, attributedMinutes, tags, links, noteCount`.

`rawMinutes` is the entry's full duration; `windowMinutes` is the part inside the requested
range; `attributedMinutes` is the share of that charged to this entry after overlap is resolved.
