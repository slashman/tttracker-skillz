# Tracker discovery session — observations

Findings from **2026-07-29**, the second day of real use through the conversational skill.
Continues the letter scheme from [`discovery-2026-07-28.md`](discovery-2026-07-28.md); five new
findings, `P`–`T`, plus corroborations that change the weight of `F`, `G` and `H`.

The day itself: 22 entries, 5 projects, 07:30–22:03, raw 8h58m over **8h58m** of wall clock —
overlap factor **1.0**, peak concurrency **1**, 21 context switches. Data in
`~/.tracker/data/days/2026/07/2026-07-29.json`.

That shape matters for reading everything below. Yesterday was factor 1.28 with concurrency 3;
today was perfectly sequential. Today exercised the start/stop/switch path hard and the
attribution path not at all, which is why nothing new came out of attribution and why `T` exists.

---

## P. Report post-processing has no CLI support, so the arithmetic happened in the reply
**Severity: medium-high — produces timesheet-shaped numbers with no provenance.**

Asked for the 2026-07-28 Acme report with the two Import-Records task lines merged into one and
attributed time normalized to 8h. The CLI offers neither, so both were computed by hand in the
assistant's reply: the merged subtotal (146.07 + 67.48 = 213.55 attributed minutes) and a rescale
factor of 480 / 422.9 = 1.135 applied to every leaf.

The output was correct — rounded minutes summed to exactly 480 with no residual — but it was
produced outside the tool, in markdown, from numbers copied out of a JSON envelope. The skill's
rule that the CLI owns duration arithmetic covers *writes*; it says nothing about derived
reporting, which is where a wrong number is hardest to notice. Every figure in a normalized column
looks like a duration and none of them is one.

**The machinery already exists.** `--round` (`src/report.mjs:124-153`) is the same shape of
operation — put a set of numbers on a coarser basis, distribute by largest remainder, then account
for the discrepancy loudly via `rounding.residual` and `rounding.vanished`, with warnings at
`:142-153`. Normalization is its sibling and should reuse both halves.

**Change.**
- `report --normalize 8h` scaling the same `basis` array computed at `src/report.mjs:126`
  (attributed when attribution is on, `windowMinutes` otherwise), emitting
  `normalization: { targetMinutes, basisMinutes, factor, explanation }` — `explanation` mirroring
  `attribution.explanation`, which is the field that already keeps attributed numbers honest.
- Display-only task grouping, so merging two lines for a report never tempts an `edit` that would
  change the record. The user was explicit that tracked data must not move.
- `.claude/skills/time-tracking/SKILL.md` — extend the arithmetic rule to output: if the CLI can't
  compute a requested view, say so rather than computing it in the reply.

## Q. A near-duplicate project is created with no warning — the mirror of finding A
**Severity: medium — silently splits one real project into two, permanently.**

`start … --project clientco-admin` while `admin` already existed returned `projectCreated: true`
and **zero warnings**. Both projects now exist: yesterday's *sign bonus pool plan* under `admin`,
today's 1:1 under `clientco-admin`.

The matcher behaved correctly. `src/projects.mjs:109-128`:
levenshtein(`clientco-admin`, `admin`) = 9, len 14 → `allowed = 2`, so no match, falling through to
the silent create at `:138`.

The asymmetry is the finding. **A** warns when a new name is *absorbed* into an existing project;
nothing warns when a new name *diverges* from one. Per **B** there is no `projects rm`, so the
split is permanent, and it is the more likely error of the two — edit distance is the wrong metric
in this direction, since `admin` is a **substring** of `clientco-admin`, not a typo of it.

**Change.** On the create path only, run a containment/token check and warn without blocking:
`created project "clientco-admin"; note existing project "admin" — `tracker projects merge` if
these are the same thing`. Pairs naturally with the `--new` flag already proposed for **A**: one
flag to decline a match, one warning when no match was found but probably should have been.

Also visible at `:138`: `meta: {}` is written empty on every project and read nowhere in the
codebase. See **S** for what it's for.

## R. Same activity, different words — the inverse of finding I
**Severity: medium — splits one task line in two, or merges two that should be separate.**

"switch back to **influencer** outreach", against `Streamer outreach` (`l6lz1f`, 14m) tracked
ninety minutes earlier. Same work, different word. Resolved by asking; the user confirmed one task
and the name stayed `Streamer outreach`.

`startEntry` (`src/entries.mjs:98-121`) stores `String(opts.task).trim()` verbatim, and report
grouping keys on the exact string, so any wording variance opens a new line. Projects have
aliases; tasks have no equivalent, and nothing surfaces "you have a task today whose name is one
word away from this".

Finding **I** is one feature with two activities — *should* split. This is one activity with two
names — *should* merge. The skill has guidance for neither, and picking silently corrupts per-task
totals in opposite directions.

**Change.** On `start` / `switch`, return `data.similarTasks` — open or closed entries on the same
project within the day whose task name is a near match. **Do not auto-adopt**: that is exactly
finding **A**'s mistake relocated to task names. The skill confirms in one line, which is what
happened manually today and cost one round trip.

## S. The ticket resolves the project, not just the title — extends N + O
"starting work in acme-438" named no project. `get_issue("ACME-438")` returned both the title
*and* `team: "Acme Corp"`, which is what allowed the entry to start on `acme`
without a clarifying question.

Finding **O** concluded "read `title`, stop, because `get_issue` hauls in description, acceptance
criteria and state history nobody needs". Correct about the noise, one field too narrow: `team`
answers the question the skill would otherwise have to ask the user. (`project`, here
`[I-1] Course Acquisition & App Gating`, is a Linear project and does **not** map to a tracker
project — don't read that one.)

Better still, skip the network. `ACME-` → `acme` has now held across ACME-63, ACME-368, ACME-411 and
ACME-438. Store it as `meta.ticketPrefix` on the tracker project — the field exists and is unused
(**Q**) — and the common case resolves locally, with `get_issue` reserved for the title when the
reference carries no human-readable words (**N**). This also gives open decision #1
(`ticketBaseUrl`) somewhere natural to live: per project, next to the prefix.

Caveat on today's inference: "Acme Corp" → `acme` was read from the initials. It
happened to be right. A stored prefix map is the version that doesn't rely on that.

## T. On a sequential day the attributed column is pure noise
**Severity: low — cosmetic, but it undercuts the one number that needs to be trusted.**

`overlapMinutes: 0`, so raw and attributed were identical on all 22 entries. Every report today
carried both anyway, and each one needed a sentence explaining that they agree — the opposite of
the problem the Raw/Attributed pair exists to solve.

`report --attribute` could omit the second column (and its explanation) when
`attribution.overlapMinutes` is 0, stating once that the day was sequential. The skill's rendering
rule — "always show raw beside attributed" — is right for a parallel day and should be conditioned
on there being overlap to explain.

Bonus: `2026-07-29.json` is a **zero-overlap fixture** to sit beside yesterday's 1.28 factor,
peak-concurrency-3 file. Between them the attribution arithmetic has both extremes covered.

---

## Corroborations that change the weight of existing findings

### F (`log`) — promote. Two occurrences, and a new failure mode.
Both backfills today needed the two-command dance: the retina fix (`ww31px`, 13:45→14:09) via
`start --at` then `switch`, and the devlog post (`oo1d5r`, 16:30–17:00) via `start --at` then
`stop --at`.

The second one exposed more than the crash window **F** already describes. The Acme entry `93f515`
was open at the time, so the transiently-open devlog entry made `stop --at 17:00` fail with
*"2 entries are running; say which one"* — correct behavior, but **the two entries never overlapped
in wall-clock time** (16:30–17:00 against 17:08 onward). The backfill idiom manufactures phantom
concurrency, which then blocks the very command trying to end it. It also half-completed a `&&`
chain, leaving the devlog entry open until a second, id-qualified `stop`.

So `log` is not only atomicity and ergonomics: the current workaround is *unsafe in the presence of
any open clock*, which on this tool is the normal state.

### G (untracked gaps) — promote. The skill's own rule makes this structural.
Span 07:30–22:03 (14h33m) against 8h58m tracked: 5h35m untracked, concentrated in 08:40–08:58,
14:15–16:30 and 18:30–20:20. Every one of those figures was computed by hand, in most replies of
the day.

The skill says the CLI owns duration arithmetic. As long as gaps are unimplemented, *every* mention
of one violates that rule — not occasionally, but by construction. Same root cause as **P**: the
reporting surface is missing the views the conversation actually asks for, so the arithmetic
migrates into prose. That is the argument for doing **G** and **P** together.

### H (phrase table) — "stop work" was the most-used phrase of the day
Still absent from the table. Ten-plus occurrences, every one of them handled by inferring bare
`stop`. `stop --all` remains undocumented too.

### A + B — see **Q**. Second day running, second project-identity incident, different direction.

### K, N, O — all held up
`ticket=` used throughout with no friction. Live `get_issue` resolved ACME-438 in one call with no
auth detour, in clear contrast to yesterday's finding **M** dead end — that path is now genuinely
verified end to end on this machine.

---

## Still unverified

1. **Bare `resume`** (finding **E**) — deliberately avoided all day. The workaround used instead —
   re-`start` with the byte-identical task string — worked cleanly every time and rolled up via
   `entryIds` on five separate tasks. Worth considering whether that should simply *be* the
   documented idiom, which would demote **E** from a bug to a footnote.
2. **The parallel path** — no overlap at all today, so attribution, `--strategy`, `--weight` and
   the `alsoOpen` reporting went untested. Open decision #5 (`weighted` defaults) gained no
   evidence.
3. **Trigger reliability** — two days open now. The session opened with an explicit
   `/time-tracking` invocation and every later turn rode the already-loaded skill. Still the one
   thing `nextSteps.md` calls "the product".

## What worked well (worth not regressing)

- **`stop`'s refusal under concurrency fired for real**, listed both candidates with ids, and was
  right to refuse — the guard the skill leans on is not theoretical.
- **`start --at T` immediately followed by `switch`** is a clean zero-gap backfill-and-handover in
  two commands. It is also roughly what `log` should feel like.
- **Multi-stint rollup by exact task string** — five tasks today spanned two entries each and
  summed into one line via `entryIds` without any prompting.
- **`edit <id> --task` on a closed entry** preserved start and end exactly (the planning session
  renamed from "admin tools" to "notifications and community" after the fact).
- **`link ticket=ACME-63` reused across days** — the week report will join today's 2h08m to
  yesterday's 2h40m with no extra work.
