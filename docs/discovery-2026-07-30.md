# Tracker discovery session — observations

Findings from **2026-07-30**, the third day of real use through the conversational skill.
Continues the letter scheme from [`discovery-2026-07-29.md`](discovery-2026-07-29.md); five new
findings, `U`–`Y`, plus corroborations that change the weight of `F`, `G`, `P` and `T`, and the
first real-world firing of the fuzzy-match warning behind `A`.

The day itself: 8 entries, 4 projects, 07:00–18:31, raw 7h36m over **7h35m** of union wall clock —
overlap factor **1.002**, peak concurrency **2**, 8 context switches. Data in
`~/.tracker/data/days/2026/07/2026-07-30.json`.

That shape matters for reading everything below. Three days in, the overlap factors read 1.28 /
1.00 / 1.002 — and today's 0.8 minutes of overlap were **manufactured by the assistant**, not by
the user working in parallel (see **W**). Functionally this is a third sequential day, which is why
the parallel path remains the longest-standing untested surface in the tool.

Volume was also lower and lumpier than either previous day: one 4h01m entry (`svbad7`, ACME-411)
accounts for 53% of tracked time, and the seven others average 30m.

---

## U. Ticket keys can't be used as queries — `matchOne` never looks at `links`
**Severity: medium-high — the documented way to label work is not a way to find it.**

"resume work in acme-411" failed with `no entry matches "acme-411"`. The entry existed — `ketfb4`,
*SSO recovery for a stuck account* — **and it already carried
`ticket=ACME-411`**. The lookup failed anyway.

`matchOne` (`src/entries.mjs:51-64`) resolves a query in three passes: exact id (`:55`), id prefix
(`:58`), then substring against **`entry.task` and `entry.project` only** (`:61-63`). `entry.links`
is never consulted. Confirmed by `grep -n "links" src/entries.mjs`: links are parsed (`:24-30`),
written (`:127`, `:265-278`, `:301`) and echoed on resume (`:375`), and read by no matcher.

Every query-taking command shares this matcher — `stop`, `note`, `link`, `edit`, `rm`, `resume` —
so a ticket key works as a *label* and fails as a *handle* everywhere, uniformly.

This directly undercuts **K**, which made `ticket=<KEY>` the documented default precisely because
that is how the user refers to work. Three days of transcripts show the reference going in by key
("starting work in acme-438", "resume work in acme-411"); the tool can store the key and cannot find
it. Finding **N**/**O** built ticket→title resolution over MCP so a key could *start* an entry;
nothing closes the loop so a key can *reach* one.

**Change.** Add a links pass to `matchOne`, between id-prefix and substring — links are
deliberately-assigned identifiers, so they should rank above free-text task matching:

```js
const byLink = candidates.filter(({ entry }) =>
  Object.values(entry.links ?? {}).some((v) => String(v).toLowerCase() === q))
if (byLink.length === 1) return byLink[0]
```

Exact value match, not substring — `ACME-41` must not silently reach `ACME-411`. Fold `byLink` into
the `bySubstring.length === 0 && byIdPrefix.length === 0` guard at `:66` and into the `ambiguous`
selection at `:74`, or a link matching several entries will report "no match" rather than listing
them. Tests: key resolves across days; key matching two entries lists both; `ACME-41` does not
reach `ACME-411`; case-insensitive (`acme-411` → `ACME-411`, which is the actual utterance).

Worth doing before **item 1** in the plan touches `resumeEntry`, since both edit the same call path.

## V. The candidate list is unreadable, and omits the field that would answer the question
**Severity: medium — an error hint that actively misled the diagnosis.**

The failure in **U** printed **45 candidates** on one line, `id project: task`, separated by ` | `.
Beyond being unusable as an error message, it caused a wrong diagnosis: `describe`
(`src/entries.mjs:42-43`) is exactly

```js
return `${entry.id} ${entry.project}: ${entry.task}`
```

so `ketfb4` appeared in the list **with no indication it held `ticket=ACME-411`**. Reading that
hint, the conclusion drawn was "that entry carries no ticket link" — stated to the user, and wrong.
The correct diagnosis only emerged after `resume` succeeded and echoed `links` back. An error hint
that omits the queried field turns a matcher bug into an apparent data problem.

Two compounding causes:

1. **`describe` shows too little.** No links, no date, no duration, no open/closed state. Three
   candidates here shared the byte-identical task string *view the account settings page* across
   two days and were indistinguishable in the output.
2. **The pool is far larger than the config suggests.** `resumeEntry`
   (`src/entries.mjs:359`) reads `listAllDayKeys(cfg).reverse().slice(0, 60)` — **60 day-files**.
   `tracker.config.json` sets `lookbackDays: 3`, which this path ignores entirely. Two different
   lookback horizons exist in the tool and only one is configurable.

**Change.**
- Cap the hint (10–15, most recent first) and state the truncation: `… and 30 more`. Silent
  truncation is worse than a long list.
- Extend `describe` with the date, duration, and `links` when present — the queried field must
  appear in the list of things that failed to match.
- Reconcile the horizons: either `resumeEntry` honors `lookbackDays`, or `lookbackDays` is
  documented as not applying to it. As it stands the config states a horizon the command overrides.

## W. The zero-gap backfill idiom manufactured the day's only overlap
**Severity: medium — the assistant polluted the attributed column while trying to keep the record clean.**

Asked to "stop work, start work in internal tooling", the handover was recorded as `stop` (landing at
`11:06:48`) then `start --at 11:06`, chosen to butt the new entry against the old one so no gap
appeared. The user was told this left "no gap." It instead created **48 seconds of overlap**:

| | raw | attributed |
| :-- | --: | --: |
| `o62mo2` orion · Fix render loop | 34.75m | 34.35m |
| `l05yzu` clientco-admin · internal tooling | 42.51m | 42.10m |

That 0.8m is the entire overlap of the day — `overlapFactor: 1.002`, `maxConcurrency: 2`,
`concurrencyHistogram: [{1, 453.92}, {2, 0.8}]`. Two projects' attributed totals now disagree with
their raw totals for no reason a reader could ever reconstruct, and a day that was sequential in
fact reports as parallel.

The root cause is a precision mismatch, and it is structural: **stored timestamps carry seconds,
spoken time carries minutes.** `stop` with no `--at` stamps `now` to the second; any `--at HH:MM`
meant to abut it is therefore wrong by up to 59 seconds, in whichever direction. Rounding the
`--at` up a minute trades the overlap for a gap; there is no minute-precision value that abuts a
second-precision boundary.

This sharpens **F** rather than duplicating it. **F** found the two-command backfill manufactures
*phantom* concurrency between entries that never overlapped in wall-clock time. Today it
manufactured *real* concurrency between entries that genuinely touched. Same idiom, and the
sub-minute case cannot be fixed by being more careful — only by not doing arithmetic on boundaries
in prose.

**Change.**
- `switch` already does this correctly and atomically; it was the right command for this utterance
  and was not used. Add the phrase-table row: *"stop X, start Y"* → `switch`, not `stop` + `start
  --at`. The skill documents `switch` only for "I'm now working on Y instead."
- Give `log`/`start` an explicit abutment idiom — `--at last-end` or `--after <id>` — resolving to
  the stored instant rather than a re-typed clock time. This is the general fix: the boundary should
  be *referenced*, never *retyped*.
- Consider having `analyze` label overlap under some threshold (say < 1m) as likely-artifactual
  rather than reporting `maxConcurrency: 2` on a sequential day.

## X. Reading the current clock happened outside the tool
**Severity: low-medium — the same "arithmetic migrates into prose" theme, one layer down.**

"I got sidetracked and only now will start with the presentation": `vaelna` had been started at
09:09 for work that began at 09:35. Correcting it required knowing what "now" was, and that came
from a shell call to `date "+%H:%M:%S"`, then `edit vaelna --start 9:35`.

`parseAt` (`src/time.mjs:168-196`) accepts relative (`-20m`, `+90m`, `-2h`), time-of-day (`9:15`,
`14:30`) and absolute ISO. There is **no `now` keyword**. `--start +0m` would have worked and is
documented nowhere; `-0m` likewise. So the tool's own clock was unreachable by name from the
command that needed it, and a second process supplied it instead — with the truncation to whole
minutes silently discarding 31 seconds.

**Change.** Accept `now` in `parseAt` as a synonym for the relative-zero case, and document it on
`--at` and `edit --start` / `--end`. One line in the regex branch, and it removes the only place all
day where the assistant had to consult a clock the CLI already holds (`nowDate` is threaded through
every one of these calls already).

**The correction itself worked well and is worth keeping.** `edit <id> --start` on an open entry
retimed it in place, preserved the id, and left the 26 untracked minutes untracked — the right
outcome, and better than `rm` + re-`start`, which would have broken the id and the entry's history.

## Y. An exact prior task string resolved the project with no question asked — refines S
**Severity: none — a working path worth protecting.**

Two utterances named no project. They resolved very differently:

- *"start work in view the account settings page"* — resolved to
  `acme` with **no question and no network call**, because that byte-identical task string had been
  tracked under `acme` the day before (`93f515`, `ntx24v`, 2h08m).
- *"start work in internal tooling"* — no prior task, no ticket key, no `defaultProject` (confirmed `null`
  in `tracker.config.json`), so it cost a clarifying round trip. The user chose `clientco-admin`
  over `admin` / `tttracker`, which were genuinely plausible.

**S** proposed `meta.ticketPrefix` to resolve the project locally instead of via `get_issue`. Today
shows a second local resolver that needs no config at all and is already implicit in the data: an
exact prior task string is a strong project signal. It also composes with **R** (one activity, two
names) from the opposite side — **R** wants near-matches surfaced for *confirmation*; this wants
exact matches used for *inference*. The distinction must stay sharp, since **A**'s mistake is
exactly inference-on-a-near-match.

**Change.** On `start` with no `--project`, if the exact task string appears in the lookback under
exactly one project, adopt it and say so in `warnings`. If it appears under several, ask. Never
infer from a near match — that is **A**, relocated to task names.

---

## Corroborations that change the weight of existing findings

### P (report shaping) — promote, and **open decision #6 is now answered by the user**
Normalization was requested for the second day running: *"don't make any changes on the original
time entries, just give me a report of work done in the acme project yesterday, normalized to 8
hours instead of 3:40."*

The decision the plan left open — *does normalization belong in the tool at all?* — was answered
directly and unprompted, and the answer is the plan's leaning: **display-only, record untouched.**
The user volunteered the constraint before being asked. Day two inferred it; day three heard it.

The arithmetic again happened in prose, and again at a worse ratio: factor **2.1784**
(480 / 220.35), against day two's 1.135. Every leaf was rescaled by hand in a subprocess
(`4h39m`, `2h10m`, `40m`, `31m`), the rounded column was verified to sum to exactly 480, and a
paragraph was then needed to say the distribution is *assumed, not measured* — proportional
scaling asserts the 4h20m of untracked Acme time was spread across four tasks in the tracked ratio,
which no timestamp supports.

That paragraph is the finding. A 2.18× rescale is not a rounding artifact, it is a fabricated
distribution, and the only thing keeping it honest today was prose the tool did not generate. This
is the strongest argument yet for `normalization.explanation` being **mandatory** rather than
advisory: the number is more misleading the further the factor is from 1.

### F (`log`) — third day, fifth occurrence, and **W** shows the workaround has a second failure mode
The 07:00–07:15 Alejandro meeting was backfilled with `start --at 7:00` then `stop tfi2ds --at
7:15`. Nothing was open, so **F**'s phantom-concurrency case didn't fire — but **W** is the same
idiom failing in the *other* direction, at sub-minute precision, on a live handover. `log` would
have avoided both.

### G (untracked gaps) — third day, and the figure is the largest yet as a share of the day
Span 07:00–18:31 (11h32m) against 454.72m union: **3h57m untracked**, computed by hand in the
reply, again. The intervals: 07:15→07:18 (3m), 08:00→08:33 (33m), 08:48→09:00 (12m), 09:09→09:35
(26m, the sidetrack from **X**), 10:32 (8s), 11:48→14:30 (**2h42m**).

Three days, three hand-computed gap figures. `unionMinutes` is already in the payload; this stays
an **S**-sized change that would delete a recurring class of prose arithmetic.

### T (redundant attributed column) — held, with a wrinkle from **W**
Raw and attributed agreed on 6 of 8 entries. The two that disagreed did so because of the 48s
artifact, not because of real parallel work — so **T**'s proposed rule (omit the column when
`overlapMinutes` is 0) would **not** have fired today, on a day that was sequential in every
meaningful sense. A `< 1m` threshold, or **W**'s abutment fix, is needed for the rule to do its job.

### A / Q (project identity) — the fuzzy-match warning **fired for real**, and was correct
`start … --project tracker` resolved to the existing `tttracker` (`projectCreated: false`) and
emitted the warning verbatim. Arithmetic at `src/projects.mjs:109-128`:
levenshtein(`tracker`, `tttracker`) = 2, len 9 → `allowed = 2`, ratio 0.222 ≤ 0.34 → match.

This is the day-one collision from **A**, arriving for real rather than as a near-miss, and the
outcome was **right**: one project, no split, user informed. It also closes `nextSteps.md` item 3 —
the fuzzy-warning path is now exercised in production, not just in tests.

It does not weaken **A** or plan item 2. The match was correct *here* and the escape hatch is still
missing if it is ever wrong. The offered remedy — `projects alias "tracker" tttracker` — was
declined-by-omission, so the warning will recur on every future utterance of the shorter name.

### H (phrase table) — `stop work` again the most-used phrase, plus two new gaps
Six occurrences today ("stop work", "stop work, done", "stop work, it's done", "stop work at
8:00"), all handled by inferring bare `stop`, still absent from the table. Two new rows earned:
*"stop X, start Y"* → `switch` (**W**), and *"I'm only starting now"* → `edit <id> --start now`
(**X**).

### K, N, O — held, and `resume` propagates links correctly
`resume ketfb4` carried `ticket=ACME-411` onto the new entry `svbad7` unprompted
(`src/entries.mjs:375`), so the week report will join today's 4h01m to the earlier stint with no
extra work. `get_issue("ACME-411")` resolved in one call, no auth detour — third day running,
consistent with **M**'s dead end being about the `authenticate` stubs specifically.

One note against **O**: `get_issue` returned a ~2.5KB payload (full description, seven acceptance
criteria, three-entry state history) to answer one question. **O**'s "read `title` and stop" is
right about the noise; the payload cost is unavoidable at the API level, which is a further argument
for **S**'s local prefix map.

---

## Still unverified

1. **The parallel path** — third day with no genuine overlap. `--strategy`, `--weight`, `exclusive`,
   `weighted` and the `alsoOpen` reporting have now gone unexercised for three consecutive days,
   and today's single overlap was an artifact (**W**). Open decision #5 still has no evidence. This
   is now the tool's most-documented, least-tested surface — the skill leads with "concurrency is
   normal" and three days of real use have produced almost none.
2. **Bare `resume`** (finding **E**) — still avoided. Today's `resume` calls both carried a query
   (`acme-411`, which failed per **U**, then `ketfb4`). The re-`start`-with-identical-string idiom was
   used again and worked (finding **Y** is the same observation from the project-resolution side).
3. **Trigger reliability** — three days open. This session again opened with an explicit
   `/time-tracking` invocation. Still the one thing `nextSteps.md` calls "the product".
4. **`--round`** — not exercised on any of the three days. Every report was requested unrounded, and
   plan item 5 proposes building normalization on top of its largest-remainder path.

## What worked well (worth not regressing)

- **`edit <id> --start` on an open entry** retimed a premature start in place, keeping the id and
  discarding only the sidetracked minutes (**X**). The cleanest correction of the three days.
- **`resume` propagating `links`, `tags` and `weight`** from the source entry — the resumed ACME-411
  entry needed no re-linking.
- **The fuzzy-project warning firing and being relayed verbatim** — the mechanism the skill leans on
  is now proven in the field (**A**).
- **`start --at` backdating to close a handover gap** was the right instinct and is worth keeping —
  it needs the boundary *referenced* rather than retyped to be safe (**W**).
- **Exact prior task string resolving the project silently** (**Y**) — the cheapest project
  resolution available, and it fired correctly with no config and no network.
- **The 45-candidate error refused to guess.** Unreadable (**V**), and still the correct behavior:
  `matchOne`'s contract held under a query it could not resolve.
