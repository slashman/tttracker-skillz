# Tracker discovery session — observations

Findings from **2026-07-31**, the fourth day of real use through the conversational skill.
Continues the letter scheme from [`discovery-2026-07-30.md`](discovery-2026-07-30.md); five new
findings, `Z`–`AD`, plus the resolution of **two of the four items that have sat under "still
unverified" since day one**.

The day itself: 5 entries, **1 project**, 09:00–19:14, raw 6h36m over **5h24m** of union wall clock
— overlap factor **1.22**, peak concurrency **2**, 5 context switches, **1h11m of genuine overlap**.
Data in `~/.tracker/data/days/2026/07/2026-07-31.json`.

Two things about that shape matter for everything below.

**First: the parallel path finally fired.** Three days of "still unverified #1" — `--strategy`,
`--weight`, `exclusive`, `weighted`, the `alsoOpen` reporting — had produced overlap factors of
1.28 (day one, before the skill settled), 1.00, and 1.002-by-artifact. Today produced 71.35 minutes
of real, deliberate, user-initiated concurrency: *"start work in parallel for ACME-162"* while
ACME-411 was running. The mechanism worked. What it revealed is finding **Z**.

**Second: the skill triggered from a natural utterance.** Every prior session opened with an
explicit `/time-tracking`. This one opened with *"track for today, project acme, 10am to 11am client
meeting…"* and the skill was selected from the description alone; the four later turns rode the
loaded skill. That is "still unverified #3" — the thing `nextSteps.md` calls "the product" —
resolved, with the caveat that this is one data point and the utterance led with the literal word
*track*. Utterances that don't contain it are still untested.

The day was also unusually narrow: one project, five entries, no project-resolution question asked
all day. So nothing new came out of the **A**/**Q** project-identity line.

---

## Z. The first real parallel day shows `equal` is the wrong default for this user's parallelism
**Severity: high — the attributed column, on the one day it finally mattered, answered a question nobody asked.**

The overlap was not two hands-on tasks. It was:

- `25sode` · ACME-411 · SSO recovery — **hands-on**, note *"testing in device emulator"*
- `x5ujy0` · ACME-162 · account refresh — **agent-driven**, closed with *"initial claude impl
  finished; next up is manual tests"*

`equal` split every shared moment 50/50, so ACME-162 reports **1h11m raw / 35.67m attributed** and
ACME-411 gives up 35.68m of its 2h39m. Neither figure is wrong arithmetic and neither is the answer
to *"how much of my attention did ACME-162 take"* — which, for work Claude was doing while the user
drove an emulator, is closer to zero than to half.

This is the mode of parallelism this user actually has. Not two tasks fought over by one person —
**one foreground human task and one background agent task.** The skill already names the right tool
for it: `weighted`, *"for one foreground task among background ones"*. It went unused.

**The mechanism is complete; the conversational trigger is missing.** `--weight` is accepted on
`start` (`src/cli.mjs:122`) and on `edit` (`:294` → `src/entries.mjs:297-299`, which has no
open/closed guard), and `--strategy` is a **report-time** choice, so weights can be applied after
the fact and the day re-read. Nothing had to be decided in advance. The reason it wasn't used is
that the fact only became sayable at the end — *"initial claude impl finished"* arrived at `stop`,
not at `start`. At `start` the utterance was just *"start work in parallel for ACME-162"*.

**Change — skill, S.** Two rules, neither needing code:

1. On `start` while something else is open, if the new work is agent-driven and the running work is
   hands-on (or vice versa), set `--weight`. A background agent task at `--weight 0.25` against a
   foreground `1` charges it 20% of the shared moment rather than 50%.
2. When a stop note reveals the split retroactively, `edit <id> --weight` and re-report. Say that
   the weight was assigned after the fact — same honesty rule the `attribution.explanation` field
   already enforces.

**Change — CLI, S.** `--background` as sugar for a documented low weight, so the conversation never
has to invent a number. And `analyze` should surface which strategy would change the answer: a day
with overlap and all-equal weights is a day where the default may be silently wrong.

**Open decision #5 (`weighted` defaults) now has its first evidence**, and it points at a default
other than 1-for-everything.

## AA. A ticket key still can't reach an entry, and this time the workaround was `export | grep`
**Severity: high — second day running for U, and the escape hatch got worse, not better.**

*"resuming work on ACME-411"*. The CLI was never asked. Knowing from day three that `matchOne`
ignores `links`, the lookup ran as:

```
tracker export --week --format json | grep -B12 'ACME-411'
```

…to learn that ACME-411 was *SSO recovery for a stuck account*,
which was then re-`start`ed by byte-identical task string (finding **Y**'s idiom) with
`--link ticket=ACME-411` retyped by hand. Same again for ACME-162, which had no prior entry and fell
through to `get_issue`.

Two things are worse here than in **U**.

1. **The lookup left the CLI.** It stayed inside the CLI's *output* — the skill's "never read the
   data files directly" rule held in the letter — but the matching happened in `grep -B12`, with a
   hard-coded line offset, against a JSON shape that is not guaranteed (see **AB**, which broke the
   first attempt at exactly this). The rule exists because arithmetic and identity resolution
   belong in the tool. Half of that is currently unenforceable.
2. **The matcher fix in plan item 1 would not have helped.** The question was *"what is ACME-411
   called"*, asked against **history**, not against open or recent entries. `stop`, `note`, `edit`,
   `rm`, `resume` all resolve against a candidate pool of open-or-lookback entries; ACME-411's prior
   stints were on 07-28 and 07-30. A links pass in `matchOne` is still right and still necessary —
   and it is **not sufficient** for the utterance that actually keeps occurring.

**Change — read-side link filtering, S.** `gather()` already filters by project in one line
(`src/report.mjs:53`):

```js
const filtered = project ? found.filter(({ entry }) => entry.project === project) : found
```

A `--link key=value` filter is the same shape, threaded through `report`, `export` and `analyze`
from the three call sites at `:90`, `:229`, `:266`. That directly serves *"how long did I spend on
ACME-411"* — a phrase-table row (`report --week --project <P>`) that currently **cannot express the
question the user actually asks**, because the user asks by ticket, not by project.

Worth pairing with a `tracker show <query>` that resolves a key to its entries across the full
history and prints task, links, stints and total. That is the command both **U** and **AA** are
reaching for.

## AB. `export --format json` flattens `links` and `tags` to strings — the JSON export is CSV-shaped
**Severity: medium — it is the documented downstream contract, and it disagrees with every other JSON surface.**

`src/report.mjs:288-291`:

```js
tags: entry.tags.join('|'),
links: Object.entries(entry.links).map(([k, v]) => `${k}=${v}`).join('|'),
```

So `export --format json` emits `"links": "ticket=ACME-411"` and `"tags": ""`, while `today --json`,
`start --json`, `resume --json` and the day-files on disk all emit `{"ticket": "ACME-411"}` and `[]`.
Same tool, same schemaVersion, two shapes for the same field depending on which command produced it.

This is not theoretical: the first lookup in **AA** was `grep -o '"links":{[^}]*}'`, which returned
nothing and cost a round trip, because the object it was looking for does not exist on that surface.
A downstream consumer must `split('|')` then `split('=')` a field that is structured everywhere else,
and must know which command it came from to know whether to do so.

`docs/SCHEMA.md` names `report --week --attribute --round 15 --format json` as the contract for
anything downstream, timesheet generation included. A contract with a shape that depends on the
formatter is the wrong contract.

**Change, S.** Keep the `|`-joined strings for `--format csv`, where flattening is forced. Emit the
object and array for `--format json`. Note it in `SCHEMA.md`, and bump `schemaVersion` if anything
already consumes the current shape.

## AC. Three closed intervals arrived in one utterance — six commands, and the ordering was load-bearing
**Severity: medium-high — fourth day for `log`, and the first time it was asked for in bulk.**

> *"track for today, project acme, 10am to 11am client meeting, 9am to 10am prepara demo for client
> meeting, 11:45am to 12:30PM retrospective meeting"*

One sentence. Three completed intervals, **given out of chronological order** (2nd, 1st, 3rd), in
three different time formats (`10am`, `11:45am`, `12:30PM`). Recorded as three `start --at` /
`stop --at` pairs — six commands for three facts.

The ordering was not incidental. Each pair had to be **closed before the next opened**: had the
intervals been entered in the order spoken, the 10:00 start would have landed while the 09:00 entry
was still open, and `stop` would have gone ambiguous mid-backfill — exactly day two's failure under
**F**. So the two-command idiom silently imposes a sequencing constraint on the assistant that
nothing documents, and violating it produces a *correct* error at the least recoverable moment,
halfway through writing three entries.

`log "Client meeting" --from 10:00 --to 11:00 --project acme` is three commands, no ordering hazard,
no transiently-open entries, and no window in which a crash leaves a dangling clock. **F** has now
fired on all four days: two backfills day two, one day three, three in a single utterance today.

**What worked:** `parseAt` (`src/time.mjs:168-196`) took `9:00`, `11:45` and `12:30` without
complaint, and the mixed `am`/`PM` casing in the prose never reached it. The gap is the command,
not the parser.

## AD. `SKILL.md` still teaches `linear=`, against four days of data that all use `ticket=`
**Severity: medium — a documentation bug that silently forks a ticket's history in two, unrepairably.**

Three places still show the old key:

- `.claude/skills/time-tracking/SKILL.md:50` — the phrase table: `link <query> linear=ENG-412`
- `:128` — the worked example: `--link linear=ENG-412`
- `:144` — the degradation path: *"record `--link linear=ENG-412` with the key alone"*

Finding **K** made `ticket=<KEY>` the convention specifically so the tool stays service-agnostic,
and every entry across four days uses it. Today's three linked entries used `ticket=` from
convention carried in memory, **not** because the skill says so — a fresh session with only
`SKILL.md` to go on would write `linear=`.

The consequence compounds with the other two findings in this doc. A history split across
`ticket=ACME-411` and `linear=ACME-411` cannot be queried as one thing (**AA**), the split is invisible
in the report (which groups by task string, not by link), and per **B** there is no repair command —
fixing it means `edit --link` on every affected entry, found by hand.

**Change, S.** Three string edits, and one line in the Linking section stating that the key is
`ticket` regardless of which tracker the key belongs to. Cheapest fix in this document.

---

## Corroborations that change the weight of existing findings

### T (redundant attributed column) — inverted, and today it earned its place
Three days of raw-equals-attributed made **T** propose hiding the column when `overlapMinutes` is 0.
Today `overlapMinutes` is **71.35** and the two columns differ on exactly the two entries that
overlapped. **T**'s rule would correctly not have fired, and the Raw/Attributed pair did the job it
exists for — the day's 6h36m of raw effort occupied 5h24m of clock, and the difference is one clean
number the user can check against their own memory of the afternoon. Keep **T** as written.

### G (untracked gaps) — **the first day the arithmetic did not leak into prose**
Three days running, gap figures were computed by hand in the reply. Today none were, because
`analyze` had already produced every number the summary needed: `overlapMinutes`, the concurrency
histogram, `unionMinutes`. The parallel day is, ironically, the one day shape the CLI reports
completely.

This does not weaken **G** — nobody asked for a gap today (09:00–19:14 spans 10h14m against 5h24m of
union, and the 12:30→16:35 hole went unremarked because the user didn't ask). It does sharpen the
argument: prose arithmetic appears exactly where a CLI field is missing, and vanishes where one
exists. `unionMinutes` is already in the payload; gaps are the last common view that isn't.

### S / N / O (ticket → title and project) — held, fourth confirmation, same payload cost
`get_issue("ACME-162")` resolved *Account refresh after returning from
checkout* and `team: "Acme Corp"` in one call, no auth detour. `ACME-` → `acme` has now
held across ACME-63, ACME-368, ACME-411, ACME-438 and ACME-162 — five keys, four days, zero
counterexamples. The payload was again ~2.5KB (full description, five scope bullets, three-entry
state history) to read two fields. **S**'s `meta.ticketPrefix` would have skipped the call entirely
for ACME-411, whose title was already in the local data; it was needed for ACME-162, which was new.

### Y (exact prior task string resolves the project) — fired again, and carried the rollup
Re-`start`ing ACME-411 with the byte-identical task string put the new 2h39m stint on the same report
line as the 07-28 and 07-30 stints with no prompting. The idiom keeps working. It is also, per
**AA**, only reachable by first grepping the history for the string — the two findings are the same
gap seen from opposite ends.

### U / V — see **AA**. Second day, worse workaround, and plan item 1 is necessary-but-insufficient.

### F (`log`) — see **AC**. Fourth day, sixth through eighth occurrences, first bulk request.

### H (phrase table) — `stop work` again, plus two rows earned today
*"stop work"* (bare, one entry open) and *"stop acme-162 (…)"* — a stop **by ticket key**, which per
**AA** the CLI cannot resolve and which was handled by querying a partial task string instead. Two
new rows: *"stop \<TICKET\>"* → needs the links pass from plan item 1, and *"start work in parallel
for X"* → `start`, explicitly **not** `switch`, with the **Z** weighting question attached.

---

## Still unverified

1. ~~**The parallel path**~~ — **resolved.** See **Z**. `--strategy` and `--weight` remain
   unexercised *as flags*; the code path underneath them ran for the first time.
2. **Bare `resume`** (finding **E**) — fourth day avoided. Today's resumption used `export | grep`
   plus a re-`start`, which is further from `resume` than day three's failed `resume acme-411`.
3. ~~**Trigger reliability**~~ — **resolved for the leading-verb case.** The skill fired from
   *"track for today…"* with no slash command. Utterances that describe work without naming
   tracking (*"I'm picking up ACME-162"*) are still untested, and that is the harder half.
4. **`--round`** — fourth day untouched. Every report requested unrounded. Plan item 5 still
   proposes building normalization on its largest-remainder path, still on no field evidence.
5. **`--normalize`** (proposed in **P**, requested by the user on days two and three) — not
   requested today, so still two-for-four.

## What worked well (worth not regressing)

- **`start` never stopping anything.** *"start work in parallel for ACME-162"* did exactly what the
  skill promises, reported `alsoOpen` with the running entry and its 38m elapsed, and required no
  disambiguation. The central design claim of the tool, exercised deliberately for the first time,
  held.
- **`--note` at `start` time**, and again at `stop`. The ACME-162 stop note — *"initial claude impl
  finished; next up is manual tests, blocked by ACME-411 tests"* — is the most valuable thing written
  all day, and it is stored on the entry rather than lost in the conversation. It is also what
  revealed **Z**.
- **Bare `stop` with exactly one entry open** — unambiguous, no query needed, no guessing.
- **`stop` by partial task string** (*"Account refresh"*) resolved cleanly against two
  open entries.
- **`analyze` needing no post-processing.** Its `message` field answered "how parallel was today" in
  three lines with a concurrency histogram. On the first genuinely parallel day, the analysis command
  was the one surface that needed nothing added to it.
