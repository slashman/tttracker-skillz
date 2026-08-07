# tracker

Time tracking for working several projects in parallel, with no UI of its own — you talk to
Claude inside this repo and it drives the CLI.

```
you: I started working on the webhook retry bug for Client Co
you: also starting a code review for Tracker
you: what am I working on
you: I stopped working on the code review
you: how much did today actually cost per task
```

## Why

Developers now work several projects at once. This captures that as **structured data for
later analysis** — the JSON is the product, not the reports — and it resolves the awkward part
of parallel work: on an overlapping day, raw durations add up to more hours than the day
contains. So the tool answers the question directly.

Given `A 09:00–12:00`, `B 10:00–11:00`, `C 11:30–13:00`, `D 14:00–14:30`:

| | A | B | C | D | total |
| :-- | --: | --: | --: | --: | --: |
| raw | 180 | 60 | 90 | 30 | **360** |
| attributed | 135 | 30 | 75 | 30 | **270** |

270 minutes is the wall clock the work actually occupied. See
[docs/SCHEMA.md](docs/SCHEMA.md) for what attribution does and does not claim.

## Install

```
cp tracker.config.example.json tracker.config.json   # set "dataDir"
node ./bin/install-check.mjs                          # setup checks + skill conflicts
node --test                                           # should be green
```

Or just tell Claude "set up the tracker" and let the `install-skill` skill walk you through it.

Requires **Node 20+** and has **no dependencies**.

Tracked time lives outside this repo, in `dataDir` (default `~/.tracker/data`), so your hours
are never committed to the tool's own history. `git init` that directory if you want your time
data versioned; set `autoCommit: true` to commit after every change.

## Commands

```
start <task…>   --project P [--at T] [--tags a,b] [--weight N] [--link k=v] [--note N]
stop [query]    [--all] [--at T] [--note N]
switch <task…>  --project P
status
today | day [date]  [--attribute] [--strategy S] [--round N]
report          [--from D --to D | --week | --month] [--project P] [--attribute] [--round N]
                [--no-balance] [--format md|json|csv]
analyze         [--from D --to D | --week | --month]
export          [--from D --to D | --week | --month] [--attribute] [--format json|csv]
note <query|--last> <text…> | <query|--last> --rm
link <query> <key=value…>
edit <id> [--task|--project|--start|--end|--tags|--weight|--link]
rm <id>         resume [query]
projects list | alias <alias> <id> | rename <id> <name> | merge <from> <into>
```

`--json` on any command prints a single envelope and nothing else, which is how the skill talks
to it. `--at` takes `9:15`, `9:15am`, `14:30`, `-20m`, `-2h`, or a full ISO instant.

`--attribute` turns on overlap resolution; `--strategy` picks `equal` (default), `weighted` or
`exclusive`.

## Design notes

**Concurrency is the normal case.** `start` never stops anything, and having several entries
open is expected rather than a mistake. The flip side: `stop` with several entries running and
no query is a hard error listing the candidates, because guessing would stop the wrong task.

**The CLI owns all file I/O and arithmetic.** The skill never reads or writes day files. That
is what keeps duration maths, attribution and rounding correct regardless of how the
conversation goes.

**Rounding is balanced by default.** Naive per-entry rounding makes timesheet columns stop
adding up; largest-remainder apportionment fixes it. A task short enough to round away to zero
is always reported, never silently dropped.

**Project names are normalized.** `Client Co`, `clientco` and `client-co` all resolve to one
project. Genuinely fuzzy matches are reused *and* announced in `warnings`, because a wrong
guess quietly merges two real projects. `projects merge` fixes it after the fact.

## Skill conflicts

The two skills in `.claude/skills/` describe honestly what they do, which means they may compete
for phrases with skills already installed on your machine. That is a **local** concern, so it is
resolved locally at install time rather than by narrowing what this repo claims:

```
node ./bin/install-check.mjs --json
```

reports name collisions and trigger-phrase overlap, with the exact shared phrases quoted. The
`install-skill` skill then helps you resolve them in *your own* configuration. It will not edit
this repo's skills to accommodate one machine, and it will not touch your own skills without
showing you the diff first.

## Layout

```
bin/tracker.mjs        CLI: parse, dispatch, envelope
bin/install-check.mjs  setup checks + skill conflict report
src/attribute.mjs      sweep-line overlap attribution (pure; the only tricky maths)
src/report.mjs         rollups, analyze, export, formatters
src/entries.mjs        start/stop/switch/note/link/edit/rm/resume
src/store.mjs          atomic day files, schemaVersion, open-entry lookup
src/projects.mjs       project registry, aliases, merge
src/time.mjs           local-day maths, --at parsing, window clipping
src/skills.mjs         skill discovery, frontmatter, overlap scoring
docs/SCHEMA.md         data + output contract, attribution and rounding semantics
```
