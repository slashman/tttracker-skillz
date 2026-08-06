---
name: time-tracking
description: >
  Live time tracking for working several projects in parallel, backed by this repo's tracker CLI. Use this skill when the
  user says they started or stopped working on something, wants to clock in or clock out, asks what they are working on
  right now, asks to log time or track time against a project, asks how long they spent on a task, or wants today's or
  this week's hours. Also use it for the analysis side: how much did today actually cost per task, what would today look
  like if the work had been done sequentially, how parallel was my week, how much of my time was overlap, where did my
  time really go, how many times did I switch context. Handles concurrent overlapping entries as the normal case.
---

# Time tracking

A live clock for parallel work. Every operation goes through the repo's CLI, which owns the
files and the arithmetic:

```
node ./bin/tracker.mjs <command> --json
```

**Never read or write files under the data directory directly.** Duration maths, overlap
attribution, rounding and the day-file format are the CLI's job. Hand-editing JSON is how
totals go quietly wrong.

## Scope

This skill drives a **live clock**: it starts and stops entries as work happens, and reports
on entries that have already been tracked. It does not reconstruct a past week from calendars,
chat history or meeting notes — it only knows what was tracked here.

## Phrase → command

| The user says | Run |
| :-- | :-- |
| "I started working on X" / "clock me in on X" | `start <task words> --project <P>` |
| "I started X at 9" / "…20 minutes ago" | `start … --at 9:00` / `--at -20m` |
| "also starting Y" / "I'm working on Y too" | `start` again — do **not** stop anything |
| "I stopped working on X" / "clock out of X" | `stop <query>` |
| "I'm done for now" (one thing running) | `stop` |
| "I did X from 9 to 10" / "I had a meeting 11 to 12" | `log <task words> --project <P> --from 9:00 --to 10:00` |
| "I finished X, now doing Y" (same clock, new activity) | `split <id> --at <when> --first-task X --task Y` |
| "I'm now working on Y instead" | `switch <task words> --project <P>` |
| "what am I working on" / "what's running" | `status` |
| "today's hours" / "today's work sheet" | `today` |
| "this week's hours" | `report --week` |
| "how long did I spend on X" | `report --week --project <P>` |
| "how much did today actually cost per task" | `today --attribute` |
| "what would today look like sequentially" | `today --attribute` |
| "how parallel was today" / "how much was overlap" | `analyze` |
| "give me the data" / "export it" | `export --from D --to D --format csv` |
| "note that …" | `note --last <text>` |
| "that's ticket ENG-412" | `link <query> ticket=ENG-412` |
| "actually that started at 8" | `edit <id> --start 8:00` |
| "delete that entry" | `rm <id>` |
| "back on what I was doing before" | `resume [query]` |

Parse the `--json` envelope, not the prose:

```
success → exit 0, {"ok": true,  "schemaVersion": 1, "command": …, "data": {…}, "message": …, "warnings": […]}
failure → exit 1, {"ok": false, "schemaVersion": 1, "command": …, "error": …, "hint": …}
```

On `ok: false`, tell the user the `error` and act on the `hint` — don't retry blindly.

## Rules that matter

**Concurrency is normal.** Several entries open at once is the expected state, not a mistake.
`start` never stops anything. When `start` reports `data.alsoOpen`, mention what else is
running as information — it is not a warning.

**Never guess which entry to stop.** If "I stopped" arrives with more than one entry open, the
CLI returns an error listing the candidates. Run `status`, show them, and **ask which one**.
Do not pick the oldest, the newest, or the one that seems most likely.

**`switch` is destructive.** It closes *everything* currently open before starting the new
entry. Report every entry it closed, with durations, from `data.closed`.

**Never hand-build a finished entry or a boundary.** For work that is already over, `log` writes a
closed entry in one command — `start --at` followed by `stop --at` leaves the entry genuinely open
in between, and if anything else is running that `stop` goes ambiguous and refuses. For an activity
that changed mid-clock, `split` cuts one entry in two at a single instant. Retyping a boundary as
`HH:MM` against a stored second-precision timestamp silently manufactures a gap or an overlap; both
commands take the boundary once and apply it to both sides.

**One task per activity.** Task names describe the activity, not the ticket — `Account refresh —
manual verification`, not the ticket title with the activity in a note. Reports group on the exact
task string, so an activity buried in a note can never be broken out afterwards. The `ticket=` link
is what ties a ticket's several task lines together.

**A project is required.** If the user didn't name one, check `status` and `today` for context
and the config's `defaultProject`. Ask only when it is genuinely unclear.

**Relay warnings verbatim.** In particular:
- `matched project "…" by similarity` — a fuzzy project match that may have merged two real
  projects. The user needs to see this to catch it.
- `… rounded away to zero at 15m granularity` — a short task vanished from a rounded report.
  Never suppress this; it is exactly how a timesheet ends up wrong.

## Explaining attribution

On a parallel day the raw durations add up to more hours than the day contains. Attribution
splits each *moment* among the tasks running at that moment, so per-task totals add up to the
wall clock the work actually occupied.

When you show attributed numbers, **always show raw beside attributed and say which strategy
was used in plain language** — the `data.attribution.explanation` field carries the wording. A
single unexplained number that disagrees with the user's own sense of their day reads as a bug.

Strategies (`--strategy`):
- `equal` (default) — time split evenly among tasks running at the same moment
- `weighted` — split in proportion to per-entry `--weight`, for one foreground task among
  background ones
- `exclusive` — each moment goes entirely to the most recently started open task, modelling
  "only one thing really had my attention"

Be careful about what this claims. It apportions elapsed time, which is arithmetic. It does
**not** say how long a task would have taken without multitasking overhead — timestamps cannot
answer that. If the user asks the counterfactual, say so, and offer `analyze`: the gap between
raw and attributed (`overlapMinutes`) is how much apparent effort was overlap.

## Rendering

`today --json` / `report --json` → a markdown table grouped project → task → ticket, with
per-project subtotals and a day total. Flag still-running entries and show their elapsed time. When
`--attribute` is on, show Raw and Attributed columns side by side. The CLI's own `message`
field already contains a rendered markdown table you can use directly.

**Rows are split by ticket, and the same activity on two tickets is two rows.** Each task carries a
`ticket` (the entry's `links.ticket`, or `null`), and the markdown gains a `Ticket` column whenever
anything in range has one. Don't merge those rows back together when you render — separate totals
per ticket is the point. If the user asks for one number per activity, sum them and say you did.

`analyze --json` → a compact summary: overlap factor, minutes at each concurrency level from
`concurrencyHistogram`, and `contextSwitches`.

For rounded reports (`--round 15`), note the `rounding.residual` if it is non-zero: putting a
day on a coarse grid changes the total, and that is worth one sentence rather than silence.

## Linking to trackers

Entries carry arbitrary `links`, so the CLI stays service-agnostic. For a Linear issue, resolve
the title first, then start the entry with a link:

```
mcp__claude_ai_Linear__*             # issue-reading tools; see the auth note below
node ./bin/tracker.mjs start "Fix checkout webhook retry" --project client-co --link ticket=ENG-412 --json
```

**The key is always `ticket`, whatever the tracker is.** Not `linear=`, not `jira=`, not
`github=` — one key, so a report can filter on it and a ticket's history stays in one place.
The key space is free-form and nothing validates it, so a second spelling silently forks that
history into two, and there is no repair command: fixing it means `edit --link` on every
affected entry, found by hand. Reserve other keys for genuinely different things (`pr=`,
`doc=`) on an entry that may also carry a `ticket=`.

**Don't assume a server name — look at the tools actually available.** Linear MCP servers are
installed per machine and namespaced differently depending on how they were added
(`mcp__claude_ai_Linear__*` and `mcp__linear-server__*` are both real in the wild). Search for
the Linear tools rather than calling a hardcoded name.

**Auth may be a prerequisite.** If the only Linear tools present are `authenticate` and
`complete_authentication`, the server is installed but unauthorized: the real issue-reading
tools do not exist yet and appear only after OAuth. Call `authenticate`, give the user the
authorization URL, then pass the callback URL from their browser to
`complete_authentication`. Some setups instead use a one-time `/mcp` OAuth with no auth tool at
all — again, go by which tools are present.

If no Linear server is available, or the user would rather not authorize right now, **degrade
rather than fail**: record `--link ticket=ENG-412` with the key alone and say the title couldn't
be resolved. Never block starting an entry on an integration — the clock matters more than the
title.

Reports go the other way: `report --week --attribute --round 15 --format json` is the
documented contract for anything downstream, including timesheet generation. See
`docs/SCHEMA.md`.

## Setup problems

If the CLI fails with a config or data-directory error, that's the `install-skill` skill's job —
hand off to it rather than guessing at paths.
