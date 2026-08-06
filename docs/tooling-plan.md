# Tooling improvement plan

Derived from [`docs/discovery-2026-07-28.md`](discovery-2026-07-28.md) (`A`–`O`, first day, overlap
factor 1.28, peak concurrency 3), [`docs/discovery-2026-07-29.md`](discovery-2026-07-29.md)
(`P`–`T`, second day, perfectly sequential),
[`docs/discovery-2026-07-30.md`](discovery-2026-07-30.md) (`U`–`Y`, third day, sequential in fact —
its only overlap was an artifact),
[`docs/discovery-2026-07-31.md`](discovery-2026-07-31.md) (`Z`–`AD`, fourth day, **the first
genuinely parallel one** — factor 1.22, 1h11m of real overlap) and
[`docs/discovery-2026-08-04.md`](discovery-2026-08-04.md) (`AE`–`AI`, fifth day, factor 1.556, and
the first day findings were fixed in the session that produced them) — **35 findings from five full
days** of using the tracker for real work through its conversational skill.

**Prioritized by evidence, not by how interesting the fix is.** A finding that bit three times in
one day of ordinary use outranks a theoretical hole. Effort is S (< 1h), M (a few hours), L (a day).
**Item numbers are stable ids, not priority** — new items are appended to their tier and keep their
number; the running order is the *Suggested order* section at the bottom.

Day two added the theme that the reporting surface is missing the views the conversation keeps
asking for, so the arithmetic migrates out of the CLI and into the assistant's prose (**P** + **G**).

**Day three sharpens that theme and adds a second one.** The arithmetic leak is now three-for-three
(**G**), and it extends past reporting into *time itself*: the current clock was read by shelling out
to `date` (**X**), and a handover boundary was retyped as `11:06` against a stored `11:06:48`,
manufacturing the day's only overlap (**W**). The new theme: **identifiers that the tool accepts are
not identifiers the tool can resolve** — a `ticket=` key can be stored on an entry and cannot find
it (**U**), and the error that says so hides the very field that would explain why (**V**).

**Day four resolved two of the four standing verification items and inverted one theme.** The
parallel path fired for the first time in four days (**Z**) and the attribution machinery worked —
but the overlap was one *hands-on* task beside one *agent-driven* one, and `equal` split it 50/50,
so the column that finally mattered answered a question nobody asked. **Open decision 5 now has its
first evidence, and it points away from the current default.** The skill also triggered from a plain
utterance for the first time, with no `/time-tracking`.

The identifier theme got worse before it got better: unable to resolve a ticket key, the assistant
resolved it in `grep` instead (**AA**) — and the shape it grepped for was wrong, because the flat
export was the one JSON surface that stringified `links` (**AB**, now fixed). Meanwhile the
arithmetic leak (**G**) did *not* recur, for the first time in four days, purely because `analyze`
happened to expose every number the parallel day needed. That is the cleanest statement of the
pattern yet: **prose arithmetic appears exactly where a CLI field is missing, and nowhere else.**

---

## Tier 0 — already done

| | Finding | Change | State |
| :-- | :-- | :-- | :-- |
| ✅ | **J** | `src/report.mjs` indents with U+00A0, not `&nbsp;` | Applied, **uncommitted** |
| ✅ | **AB** | `buildExport` emits `tags` / `links` structured; flattening moved to the new `exportRowsToCsv` formatter | Applied + 2 tests, **uncommitted** |
| ✅ | **AD** | `SKILL.md` teaches `ticket=` in all three places, with a paragraph on why one key | Applied, **uncommitted** |
| ✅ | **F / AC** | `log <task…> --project P --from T --to T` writes one closed entry atomically | Applied + 4 tests, **uncommitted** |
| ✅ | **I / R / W** | `split <id> --at T [--task] [--first-task]` cuts an entry in two at one instant | Applied + 4 tests, **uncommitted** |

**AB, applied day four.** `src/report.mjs:288-291` had `tags: entry.tags.join('|')` and a
`|`-joined `links`, so `export --format json` emitted `"links": "ticket=ACME-411"` where the day
files, `today --json`, `start --json` and every other JSON surface emit `{"ticket": "ACME-411"}`.
One tool, one `schemaVersion`, two shapes for the same field depending on the formatter — and it
cost a failed lookup on day four (see item 10). The rows now carry the structured value; the new
`exportRowsToCsv` flattens at the CSV boundary, where a cell genuinely can't hold an object.
`EXPORT_COLUMNS` moved next to it, out of `bin/tracker.mjs`. `schemaVersion` stays 1 — nothing
downstream consumed the old shape — and `docs/SCHEMA.md` records the change.

**AD, applied day four.** `SKILL.md` still prescribed `linear=ENG-412` in the phrase table, the
worked example and the degradation path, against four days of data that use `ticket=` throughout.
A fresh session reading only the skill would have written `linear=`, forking a ticket's history
across two keys — invisible in reports, unqueryable per item 10, and unrepairable per **B** except
by hand. This was Tier 3's **K**, and it is now done; the paragraph added beside the example says
*why* one key rather than just prescribing it.

Also uncommitted: four of the five discovery docs (07-28 is committed) and this plan. Five days of
findings now exist only as working-tree files in a repo created specifically to give them history —
see decision 4.

**Day five added five findings (`AE`–`AI`) that are not yet tiered below.** In short: weights set on
an entry are silently discarded by the default strategy, so two truthful reports of the same day
disagree (**AE**, corrects **Z**); notes are write-only, which blocked two of nine renames during
the task-naming rebuild (**AF**, the same shape as **AA** in a second field); a clock ran 6h21m past
the end of work with no signal from anything (**AG**); the activity-vs-ticket naming question is
**resolved** and applied (**AH**, closes **I** and **R**); and this plan had drifted from its sources
twice, both times inflating (**AI**, now corrected).

---

## Tier 1 — the conversational layer is wrong, fix first

These three produced actual wrong behavior during normal use. Nothing else on this list did.

### 1. Ticket keys can't be used as queries, and the error hides why — findings U + V · **S**–**M**

**New in day three, and it fails the feature K exists to serve.** "resume work in acme-411" returned
`no entry matches "acme-411"` while the entry existed *and already carried* `ticket=ACME-411`.

`matchOne` (`src/entries.mjs:51-64`) resolves in three passes — exact id (`:55`), id prefix (`:58`),
substring against **`entry.task` and `entry.project` only** (`:61-63`). `entry.links` is never
consulted by any matcher; links are parsed (`:24-30`), written (`:127`, `:265-278`, `:301`) and
echoed on resume (`:375`), and read by none. Every query-taking command shares the matcher — `stop`,
`note`, `link`, `edit`, `rm`, `resume` — so the failure is uniform.

This is **K** half-built. **K** made `ticket=<KEY>` the documented default precisely because that is
how the user refers to work; **N**/**O** built key→title resolution so a key could *start* an entry.
Nothing closes the loop so a key can *reach* one. Three days of transcripts have the reference going
in by key ("starting work in acme-438", "resume work in acme-411").

**Change — the matcher.** Add a links pass between id-prefix and substring; links are
deliberately-assigned identifiers and should outrank free-text task matching:

```js
const byLink = candidates.filter(({ entry }) =>
  Object.values(entry.links ?? {}).some((v) => String(v).toLowerCase() === q))
if (byLink.length === 1) return byLink[0]
```

Exact value match, not substring — `ACME-41` must not silently reach `ACME-411`. Fold `byLink` into the
`bySubstring.length === 0 && byIdPrefix.length === 0` guard at `:66` **and** into the `ambiguous`
selection at `:74`, or a key matching several entries reports "no match" instead of listing them.

**Change — the error (V).** The failure printed **45 candidates** on one line and caused a wrong
diagnosis: `describe` (`src/entries.mjs:42-43`) is `${entry.id} ${entry.project}: ${entry.task}`, so
the entry holding `ticket=ACME-411` appeared with no sign of it, and "that entry carries no ticket
link" was stated to the user and was wrong. An error hint that omits the queried field turns a
matcher bug into an apparent data problem.

- Cap the hint at 10–15, most recent first, and **state the truncation** (`… and 30 more`). Silent
  truncation is worse than a long list.
- Extend `describe` with date, duration, open/closed and `links` when present. Three candidates today
  shared a byte-identical task string across two days and were indistinguishable.
- **Reconcile the two lookback horizons.** `resumeEntry` (`src/entries.mjs:359`) reads
  `listAllDayKeys(cfg).reverse().slice(0, 60)` — 60 day-files — and ignores `lookbackDays: 3` in
  `tracker.config.json`. Either honor it or document that it does not apply here.

- `src/entries.mjs` — `matchOne`, `describe`, `resumeEntry`
- `test/` — key resolves across days; key matching two entries lists both; `ACME-41` does not reach
  `ACME-411`; lowercase `acme-411` resolves `ACME-411` (the actual utterance); hint truncation is stated

**Do this before item 2.** Both edit the same call path, and item 2's fix is easier to reason about
once the matcher is complete.

### 2. `resume` and `--last` pick the wrong entry — finding E · **S**

**Evidence: three occurrences on day one**, always the same shape — pause something, come back, and
the obvious command reopens the thing you just closed.

`src/entries.mjs:358-377` sorts all candidates by start descending and, with no query, takes
`candidates[0]`. Immediately after a `stop`, that *is* the entry just stopped.

**Change.** Define bare `resume` as *"the thing I was doing before the last thing I stopped"*: among
closed entries, take the latest start **excluding the most recently ended entry**. Under concurrency,
multiple entries may share that latest end — exclude all of them.

Define `--last` for `note` explicitly as *most recently touched* (started or stopped, whichever is
later) and say so in `--help`, because with parallel clocks "last" currently has three defensible
readings.

- `src/entries.mjs` — `resumeEntry`, and wherever `--last` resolves
- `test/` — cases: stop→resume returns the *prior* entry; stop-two-then-resume; single-entry day
- `.claude/skills/time-tracking/SKILL.md` — the phrase table marks the query optional, which invites
  the bug. Note that a query is strongly preferred under concurrency.

**Still unverified after three days.** Bare `resume` has been deliberately avoided every day; the
workaround (re-`start` with the byte-identical task string) worked cleanly again on day three, and
finding **Y** is that same observation from the project-resolution side. Decide first whether the
workaround simply *becomes* the documented idiom, which would demote this to a doc change.

### 3. Project identity: no way to decline a fuzzy match, no warning when you should have, no way to delete — findings A + B + Q · **M**

Ship together; each is a third of a fix. Day one, `tttracker` would have been absorbed into
`tracker`, and the only reason it wasn't is that the collision was spotted first. Day two,
`clientco-admin` was created alongside `admin` with `projectCreated: true` and **zero warnings** —
the same failure in the opposite direction, and now a real split in the data.

**Day three: the fuzzy match fired for real, and was correct.** `start … --project tracker` resolved
to the existing `tttracker` with `projectCreated: false` and the warning relayed verbatim.
`src/projects.mjs:109-128`: levenshtein(`tracker`, `tttracker`) = 2, len 9 → `allowed = 2`, ratio
0.222 ≤ 0.34 → match. **This closes `nextSteps.md` item 3** — the warning path is now exercised in
production, not just in tests.

It does not weaken the item. The match was correct *there*, and the escape hatch is still missing if
it is ever wrong. The offered remedy (`projects alias "tracker" tttracker`) was declined by
omission, so the warning recurs on every future utterance of the shorter name — which is the
argument for aliases being *offered* by the warning rather than left to the user to remember.

`src/projects.mjs:109-128` runs the edit-distance branch **before** create (`:138`) with no bypass,
so while a near-named project exists a genuinely new similar name can only be absorbed. And
`projects` has `list | alias | rename | merge` but no `rm`, so a typo is permanent *and* keeps
shadowing every nearby name.

**Change.**
- Add `--new` to `start` / `switch` / `edit`: skip the fuzzy branch entirely and create the exact
  slug. Backwards compatible — default behavior unchanged, warning still relayed.
- Extend the existing warning to name the escape hatch: `… pass --new to create "<raw>" instead`.
- **Warn on the create path too** (Q). Edit distance is the wrong metric in this direction —
  `admin` is a *substring* of `clientco-admin`, distance 9. Run a containment/token check at
  `src/projects.mjs:138` and warn without blocking: `created project "<raw>"; note existing project
  "<id>" — \`tracker projects merge\` if these are the same thing`.
- Add `projects rm <id>`: refuse when any day file references it, listing the count, unless
  `--force`. Point at `projects merge` as the usual answer.

- `src/projects.mjs`, `bin/tracker.mjs` (arg parsing, `--help`)
- `test/` — fuzzy match declined via `--new`; near-name create emits a warning; `rm` refused with
  references; `rm --force`

### 9. `equal` is the wrong default for foreground/background parallelism — finding Z · **S**

**New in day four, on the first day the parallel path ran at all.** The overlap was not two hands-on
tasks. `25sode` (ACME-411) was the user in an device emulator; `x5ujy0` (ACME-162) was Claude writing
an implementation, closed with *"initial claude impl finished; next up is manual tests"*. `equal`
split every shared moment 50/50, so ACME-162 reports **1h11m raw / 35.67m attributed** and ACME-411
surrenders 35.68m of its 2h39m.

Neither number is bad arithmetic. Neither answers *"how much of my attention did ACME-162 take"* —
which, for work an agent did while the user drove an emulator, is nearer zero than half. **This is
the parallelism this user actually has**: not two tasks contending for one person, but one
foreground human task beside one background agent task. The skill already names the right tool for
it — `weighted`, *"for one foreground task among background ones"* — and it went unused.

**The mechanism is complete; only the conversational trigger is missing.** `--weight` is accepted on
`start` (`src/cli.mjs:122`) and on `edit` (`:294` → `src/entries.mjs:297-299`, no open/closed
guard), and `--strategy` is a **report-time** choice, so weights can be assigned after the fact and
the day re-read. Nothing needed deciding in advance. It went unused because the fact only became
sayable at the end: at `start` the utterance was *"start work in parallel for ACME-162"*, and the
foreground/background split arrived with the stop note.

**Change — skill (docs, S).**
- On `start` while something is open, if one side is agent-driven and the other hands-on, set
  `--weight`. A background agent task at `0.25` against a foreground `1` takes 20% of the shared
  moment rather than 50%.
- When a stop note reveals the split retroactively, `edit <id> --weight` and re-report — and **say
  the weight was assigned after the fact**, the same honesty the `attribution.explanation` field
  already enforces.

**Change — CLI (code, S).**
- `--background` as sugar for a documented low weight, so the conversation never invents a number.
- Have `analyze` flag when the strategy is load-bearing: overlap present *and* all weights equal is
  exactly the case where the default may be quietly wrong. One warning, not a refusal.

Placed in Tier 1 because it produced a misleading number in ordinary use, which is this tier's bar.
It is also the cheapest item here — two skill paragraphs would cover the common case today.

---

## Tier 2 — the record is incomplete, and the reports can't be shaped

Not wrong, but the day can't be reconciled against the clock — and every view the conversation asks
for that the CLI can't produce gets computed in prose instead.

**Day two promoted items 4 and 5. Day three promoted item 4 again and answered item 6's open
decision.**

### 4. `log`, and a safe way to abut a boundary — findings F + W + AC · **S**–**M** · **mostly done 08-04**

> **Status.** `log` and `split` shipped on 08-04 (Tier 0) and close the atomicity half of this item:
> a finished activity is one write, and a mid-clock activity change is one write with one shared
> boundary value, so neither can manufacture a gap, an overlap, or a dangling clock. **Still open:**
> the `--at last-end` / `--after <id>` idiom for abutting a *different* entry's boundary (the day-three
> **W** case, where `stop` then `start --at 11:06` overlapped a stored `11:06:48`), the phrase-table
> rows, and the `analyze` sub-minute-overlap hint. The history below is kept as the evidence trail.

**Evidence: eight occurrences across five days — one day one (the Orion sync, 8:00–8:40), two day
two, one day three, three in a single utterance day four, one on 08-04 — plus three distinct failure
modes.**

"just finished the Orion sync, it went from 8 to 8:40" needed `start --at` then `stop --at`: two
commands, entry transiently open, and a crash in between leaves it running.

**Day two — phantom concurrency.** Backfilling the devlog post (16:30–17:00) while an Acme entry was
open made bare `stop --at 17:00` fail with *"2 entries are running; say which one"* — **although the
two entries never overlapped in wall-clock time** (the Acme entry started at 17:08). The idiom
manufactures concurrency that then blocks the command trying to end it, and it left the entry open
when the `&&` chain half-completed.

**Day three — real concurrency, from a precision mismatch (W).** "stop work, start work in internal tooling"
was recorded as `stop` (landing at `11:06:48`) then `start --at 11:06`, chosen to leave no gap. It
left **48 seconds of overlap**, which was the entire overlap of the day: `overlapFactor: 1.002`,
`maxConcurrency: 2`, and two projects whose attributed totals now disagree with raw for a reason no
reader could reconstruct (orion 34.35m attributed vs 34.75m raw).

That case cannot be fixed by being more careful. **Stored timestamps carry seconds; spoken time
carries minutes.** No `--at HH:MM` can abut a second-precision boundary — rounding up trades the
overlap for a gap. The boundary must be *referenced*, never *retyped*.

**Day four — bulk, and a silent ordering hazard (AC).** *"track for today, project acme, 10am to 11am
client meeting, 9am to 10am prepara demo for client meeting, 11:45am to 12:30PM retrospective
meeting"* — one sentence, three completed intervals, **given out of chronological order** (2nd, 1st,
3rd), in three time formats. It cost six commands for three facts.

The ordering was load-bearing. Each pair had to be **closed before the next opened**: entered in the
order spoken, the 10:00 start would have landed while the 09:00 entry was open and `stop` would have
gone ambiguous — day two's failure again, but now *mid-backfill*, halfway through writing three
entries. So the idiom imposes a sequencing constraint on the caller that nothing documents, and
breaking it produces a correct error at the least recoverable moment. `parseAt` took `9:00`, `11:45`
and `12:30` without complaint; the gap is the command, not the parser.

**Change.**
- Add `log <task…> --project P --from T --to T [--tags] [--link] [--note]` writing one closed entry
  in a single write. Reuse the existing timestamp validation (future stamps are already rejected).
  This alone removes **AC**'s ordering hazard: nothing is transiently open, so nothing can go
  ambiguous, whatever order the intervals arrive in.
- Add an abutment idiom — `--at last-end` or `--after <id>` — resolving to the *stored instant*.
- Add the phrase-table rows: *"I did X from A to B"* → `log`, and ***"stop X, start Y"* → `switch`**.
  `switch` already does this atomically and correctly; it was the right command on day three and was
  not used, because the skill documents it only for "I'm now working on Y instead."
- Consider having `analyze` mark sub-minute overlap as likely-artifactual rather than reporting
  `maxConcurrency: 2` on a sequential day.

**08-04 — the eighth occurrence, and the first where the user asked for the command by name.**
*"I had a meeting 11 to 12PM, grooming and planning for acme"* → `start --at 11:00` + `stop --at
12:00`. Safe only because nothing was open at the time; with a clock running it would have hit day
two's ambiguity. The user then asked whether a "backlog an entry" command was already on the list —
so the gap is now being noticed from the outside, not just inferred from transcripts. Five days,
five days of the same two-command dance.

### 5. Surface untracked gaps — finding G · **S**

Day one: 07:20→17:37 elapsed, 8h52m tracked. Day two: 07:30→22:03 (14h33m) against 8h58m tracked —
5h35m untracked. Day three: 07:00→18:31 (11h32m) against 454.72m union — **3h57m untracked**, the
largest share of any day, in intervals 07:15→07:18, 08:00→08:33, 08:48→09:00, 09:09→09:35 (the
sidetrack from **X**), 10:32 (8s) and 11:48→14:30 (**2h42m**).

**Every one of those figures was computed by hand, on all three days.** That is the argument. The
skill states the CLI owns duration arithmetic; while gaps are unimplemented, every mention of one
breaks that rule by construction, not by accident.

**Day four is the control case.** No gap figure was computed in prose — the first such day — because
nobody asked for one (09:00→19:14 spans 10h14m against 5h24m of union; the 12:30→16:35 hole went
unremarked) *and* because `analyze` already carried every number the parallel-day summary needed:
`overlapMinutes`, the concurrency histogram, `unionMinutes`. So the leak is not a habit of the
assistant's, it is a function of which fields exist. Gaps are the last common view that has none.

`unionMinutes` is already computed, so gaps are just its complement within `[min(start), max(end)]`.
Add `untrackedMinutes` to the `today` / `report` payload, and a `--gaps` flag listing the intervals.

### 6. Shape reports without touching the record — findings P + T · **M**

**Asked on two consecutive days, and day three answered the open question about it.**

Day two: the Acme day with two task lines merged and attributed time normalized to 8h, computed in
the reply at factor 480 / 422.9 = 1.135. Day three: *"don't make any changes on the original time
entries, just give me a report of work done in the acme project yesterday, normalized to 8 hours
instead of 3:40"* — computed in the reply at factor **2.1784** (480 / 220.35).

**Decision 6 is now answered by the user, unprompted, in this plan's leaning direction: display-only,
record untouched.** Day two inferred that constraint; day three heard it stated before being asked.

The day-three factor is the stronger argument. A 2.18× rescale is not a rounding artifact, it is a
**fabricated distribution** — proportional scaling asserts that 4h20m of untracked Acme time was
spread across four tasks in the tracked ratio, which no timestamp supports. The only thing keeping
the output honest was a paragraph of prose the tool did not generate. So `explanation` is
**mandatory, not advisory**, and the number is more misleading the further the factor sits from 1.

**The machinery already exists.** `--round` (`src/report.mjs:124-153`) is the same operation: move a
set of numbers onto a different basis, distribute by largest remainder, then account for the
discrepancy loudly (`rounding.residual`, `rounding.vanished`, warnings at `:142-153`).

- `report --normalize 8h` scaling the `basis` array built at `src/report.mjs:126`, emitting
  `normalization: { targetMinutes, basisMinutes, factor, explanation }`. `explanation` must mirror
  `attribution.explanation` — that field is the reason attributed numbers stay honest, and a rescale
  needs it more.
- Display-only task grouping, so "merge these two lines for the report" never tempts an `edit`. The
  record must not move; the user has now said so explicitly.
- **T, revised.** The proposed rule — omit the attributed column when `attribution.overlapMinutes`
  is 0 — **would not have fired on day three**, on a day that was sequential in every meaningful
  sense, because of **W**'s 48s artifact. Use a threshold (`< 1m`), or fix **W** first, or both.
  **Day four confirms the other half of the rule:** with `overlapMinutes` at 71.35 the two columns
  differed on exactly the two entries that overlapped, and the pair did the job it exists for. Keep
  **T** as written, threshold included — hide the column when there is nothing to explain, never
  when there is.
- `.claude/skills/time-tracking/SKILL.md` — extend the arithmetic rule to cover output: if the CLI
  cannot compute a requested view, say so rather than computing it in the reply. Condition the
  "always show raw beside attributed" rule on there being overlap to explain.

### 10. Filter and look up by link — finding AA · **S**

**Day four is U's second occurrence, and the workaround got worse.** Knowing from day three that
`matchOne` ignores `links`, the assistant did not ask the CLI at all. *"resuming work on ACME-411"*
was resolved with:

```
tracker export --week --format json | grep -B12 'ACME-411'
```

— to learn what ACME-411 was called, then re-`start` by byte-identical task string (**Y**'s idiom)
with `--link ticket=ACME-411` retyped by hand. The first attempt grepped for `"links":{…}` and found
nothing, because of **AB**.

Two things are worse than in **U**:

1. **Identity resolution left the tool.** It stayed inside the CLI's *output*, so the skill's
   "never read the data files directly" rule held in the letter — but the matching ran in `grep -B12`
   against an unguaranteed JSON shape. That rule exists because resolution and arithmetic belong in
   the CLI; half of it is currently unenforceable.
2. **Item 1 would not have helped.** The question was *"what is ACME-411 called"*, asked against
   **history**. `stop`, `note`, `edit`, `rm` and `resume` all resolve against open-or-lookback
   entries, and ACME-411's prior stints were 07-28 and 07-30. A links pass in `matchOne` remains
   right and necessary — and is **not sufficient** for the utterance that keeps recurring.

**Change.** `gather()` already filters by project in one line (`src/report.mjs:53`):

```js
const filtered = project ? found.filter(({ entry }) => entry.project === project) : found
```

A `--link key=value` filter is the same shape, threaded from the three call sites at `:90`, `:229`
and `:266` into `report`, `export` and `analyze`. Exact value match, per item 1's reasoning.

Add `tracker show <query>`: resolve a key (or id, or task substring) across the **full** history and
print task, project, links, each stint and the total. That is the command both **U** and **AA** are
reaching for, and it is where a `--link`-filtered report and a readable `describe` (item 1) meet.

**This is what the phrase table's *"how long did I spend on X"* row actually needs.** It currently
maps to `report --week --project <P>` — which cannot express the question, because the user asks by
ticket, not by project.

- `src/report.mjs` (`gather` + the three builders), `bin/tracker.mjs` (`show`, `--link`, `--help`)
- `test/` — `--link` filters across days; a key with no entries reports empty rather than
  everything; `show` sums multiple stints; `ticket=ACME-41` does not match `ACME-411`

**Do this with or after item 1** — same conceptual fix (links are identifiers), opposite side of the
tool: item 1 is the write/mutate path, this is the read path.

---

## Tier 3 — the skill misleads

Documentation-only, zero code risk, so it can land at any point — worth doing early since it shapes
every interaction. One commit.

All in `.claude/skills/time-tracking/SKILL.md` unless noted. **S** total.

- ~~**K**~~ — **done on day four as AD** (Tier 0). All three `linear=ENG-412` sites now say
  `ticket=`, with a paragraph on why one key: the key space is unvalidated, a second spelling forks a
  ticket's history invisibly, and there is no repair command. The caveat it shipped with still
  stands — **until items 1 and 10 land, this documents a label that cannot be looked up**, which is
  precisely how day four ended up resolving one in `grep`.
- **M** — the `authenticate` → `complete_authentication` flow is a **dead end** here: both tools
  exist but are stubs that redirect to `/mcp`. The stated heuristic ("go by which tools are
  present") is unsound because **presence doesn't imply usability**. Route `mcp__claude_ai_*`
  connectors straight to "ask the user to run `/mcp`", or drop the sniffing and just make the call —
  the error states the next step.
- **N + O** — trigger a title lookup only when **the reference carries no human-readable words**.
  `ACME-368/high-level-assessment-…` needs no network; a bare `…/issue/ACME-411/` does. Teach the
  `TICKET-N/slug-words` parse — Linear's own `gitBranchName` field confirms that's exactly the shape
  it generates. When resolving, read `title` and stop; `get_issue` returns description, acceptance
  criteria and state history that nobody needs for a label. Day three measured the cost: ~2.5KB
  (seven acceptance criteria, three-entry state history) to answer one question — a further argument
  for **S**'s local prefix map.
- **H** — missing rows: `stop --all`, `--note` on `stop`, `edit <id> --project P`. Day three earns two
  more: ***"stop X, start Y"* → `switch`** (see item 4, **W**) and ***"I'm only starting now"* →
  `edit <id> --start now`** (see **X**). Day four earns two more again: ***"start work in parallel
  for X"* → `start`, explicitly not `switch`**, with item 9's weighting question attached; and
  ***"stop \<TICKET\>"***, which needs the links pass from item 1 and was handled on day four by
  querying a partial task string instead. And `stop work` remains the single most-used phrase across
  all four days — six occurrences on day three alone, every one handled by inferring bare `stop`,
  still absent from the table.
- **I + R** — task naming needs *both* halves, and currently has neither. **I** is one feature with
  two activities ("the *integration*" after "*code review* for" the same feature) and should stay
  split. **R** is one activity with two names ("**influencer** outreach" for the tracked
  `Streamer outreach`) and should merge. Picking silently corrupts per-task totals in opposite
  directions. Day two cost one clarifying round trip to resolve **R** by hand.
  Optional CLI assist (**S**-sized, code not docs): have `start` / `switch` return
  `data.similarTasks` — same project, same day, near-matching task name. **Never auto-adopt**; that
  is finding **A**'s mistake relocated to task names. `startEntry` (`src/entries.mjs:98-121`)
  currently stores the string verbatim and report grouping keys on it exactly, so any wording
  variance opens a new line.
- **S + Y** — project resolution has two local answers, and day three found the cheaper one.
  **S**: when a ticket resolves the title, read `team` as well — `get_issue("ACME-438")` →
  `team: "Acme Corp"` answered the project question the skill would otherwise have
  had to ask. Do **not** read Linear's `project` field; it is a Linear project
  (`[I-1] Course Acquisition & App Gating`) and does not map to a tracker project. Supersedes
  **O**'s "read `title`, stop" by exactly one field.
  **Y**: an **exact** prior task string is a strong project signal needing no config and no network —
  "start work in view the account settings page" resolved to `acme`
  with no question, while "internal tooling" (no prior task, no key, `defaultProject: null`) cost a round
  trip. Adopt on an exact single-project match and say so in `warnings`; ask on several. **Never
  infer from a near match** — that is **A** again. Note this is the mirror of **R**: near matches get
  *confirmed*, exact matches get *inferred*, and the line between them must stay sharp.
- **X** — `parseAt` (`src/time.mjs:168-196`) accepts relative, time-of-day and absolute, but has **no
  `now` keyword**, so correcting a premature start meant shelling out to `date` and truncating 31
  seconds. `--start +0m` works and is documented nowhere. One regex branch (**code**, S) plus the
  `--at` / `edit --start` docs; `nowDate` is already threaded through every one of these calls.

---

## Tier 4 — setup hygiene

### 7. `install-check` shouldn't teach you to pollute your data — finding C · **S**

The install skill's "Finishing" section prescribes
`start "checking the tracker works" --project tracker`, which permanently creates a `tracker`
project — the exact project that nearly swallowed `tttracker` four minutes later, and whose name
resolved *into* `tttracker` by fuzzy match on day three. `rm <id>` would not have removed it (see
finding B).

Move the end-to-end check **into** `install-check` against a `mkdtemp` `dataDir`, reported as a
`self-test` check. Then drop the prescribed writes from `.claude/skills/install-skill/SKILL.md`.

### 8. Say what the conflict scan actually covered — finding D · **S**

It reports `0 hard and 0 soft skill conflicts across 0 installed skills` while ~15 skills were
active from sources it never looks at. Accurate for its two roots; reads as "nothing is installed".

Name the roots in the summary and state that plugin/bundled skills are out of scope. Optionally also
scan `~/.claude/plugins/**/skills`. Update `nextSteps.md`-era expectations so `scanned: 0` is only a
pass when the summary doesn't overclaim.

---

## Suggested order

*Revised after day four. Item 9 enters near the top on one day's evidence, which is unusual — it is
there because it is two paragraphs of skill text and because the day that produced it was the first
of four to exercise the feature at all. Item 10 rides with item 1.*

1. **Commit what exists** — the J, AB and AD fixes, all four discovery docs, this plan, the trimmed
   `nextSteps.md`. Four days of data are working-tree-only (decision 4).
2. **Item 9's skill half** (weight the background task) — the cheapest item on this list and the only
   one that changes a number the user already saw. The CLI half (`--background`, the `analyze`
   warning) can follow.
3. **Items 1 + 10** (`matchOne` links + readable candidates; `--link` filtering and `show`) — the
   same fix on the write and read paths. Item 1 completes the matcher **before** item 2 edits the
   same call path; item 10 is what day four actually needed and resolved in `grep` instead. **AD**
   has now documented `ticket=` as the default, so until these land the skill prescribes a label the
   tool cannot look up.
4. **Tier 3** (skill docs) — zero risk, immediate daily benefit, no tests to write. Now carries
   **R**, **S**, **Y**, **X** and four **H** rows. **K** is already done (Tier 0).
5. **Items 4 + 5** (`log` + abutment, gaps) — both small. Day two showed the `log` workaround is
   unsafe whenever a clock is open; day three showed it corrupts attribution even when nothing else
   is running; day four showed it imposes an undocumented ordering constraint on bulk backfill.
6. **Item 3** (project identity) — highest severity, two incidents in two days pointing in opposite
   directions. Day three's correct fuzzy match closes the *verification* half (`nextSteps.md` item 3)
   without closing the fix. Day four added nothing: one project all day, no resolution question asked.
7. **Item 2** (`resume`/`--last`) — demoted again. The re-`start`-with-identical-string workaround has
   now worked on four days and is the basis of **Y**. Day four moved *further* from `resume`, reaching
   it via `export | grep` plus a re-`start`. Decide whether the workaround simply becomes the
   documented idiom, which would make this a doc change rather than a code fix.
8. **Item 6** (report shaping) — the largest of the new work; do it once `--round`'s largest-remainder
   path can be reused rather than reimplemented. Decision 6 is now settled, so this is unblocked.
9. **Tier 4** — hygiene, and it stops the install flow from creating the problem in item 3.

Run the verification items in `nextSteps.md` alongside. **Trigger reliability is now half-answered:**
day four opened with *"track for today, project acme, …"* and the skill fired with no
`/time-tracking`. The remaining half is the harder one — utterances that describe work without
naming tracking (*"I'm picking up ACME-162"*), where the description has no keyword to match.

---

## Decisions needed before building

1. **Ticket links and vendors.** Keys stay generic (`ticket=`) per preference. Does
   `tracker.config.json` grow a `ticketBaseUrl` so exports can build clickable links, or do links
   stay opaque and humans supply the context? *Leaning: config option — keeps entries clean, keeps
   exports useful.* **Day two sharpens this (S):** the natural home may be per project rather than
   global. `ACME-` → `acme` has held across ACME-63, ACME-368, ACME-411 and ACME-438, and
   `src/projects.mjs:138` already writes a `meta: {}` that nothing reads. Storing `meta.ticketPrefix`
   (plus a base URL beside it) would resolve the project locally and reserve `get_issue` for titles
   only. **Day three adds (U):** whatever the storage, the key must also be *queryable* — that half
   is item 1 and does not depend on this decision. **Day four adds (AD):** the key itself is now
   settled and documented as `ticket`, so `ticketBaseUrl` has one key to build a URL from rather than
   a vendor-shaped guess. `ACME-` → `acme` has now held across five keys and four days.
2. **Bare `resume` when genuinely ambiguous.** Resolve to the prior entry as proposed, or refuse and
   list candidates the way `stop` does? *Leaning: resolve, since `stop`'s refusal exists to avoid
   destroying data and `resume` only adds.* **Day three note:** the refusal path produced a
   45-candidate wall of text (**V**), so "refuse and list" is only viable once the hint is capped.
3. **`projects rm` with references.** Refuse and require `merge` first, or allow `--force` and orphan
   the entries? *Leaning: refuse, `--force` available but loud.*
4. **`autoCommit`.** Currently `false`, so three days of data exist only as working-tree files in a
   repo created specifically to give them history. Turn it on?
5. ~~**Attribution defaults.**~~ **Answered on day four — see item 9.** Days two and three produced
   no usable evidence (zero overlap, then 0.8m of **W** artifact). Day four produced 1h11m of real
   overlap and settled it: the concurrency this tool sees is **one foreground human task beside one
   background agent task**, and `equal` charged the agent task 35.67 of its 71.35 minutes. So
   `weighted` is worth surfacing, and the open question narrows to *how the weight gets set*. Leaning:
   keep `equal` as the global default — it is right when two tasks genuinely contend — and have the
   skill set `--weight` (or a `--background` alias) at `start`, correcting via `edit --weight` when
   the split only becomes clear at `stop`, as it did on day four. A per-config default weight for
   agent-driven work is the alternative and is probably premature on one day's data.
6. ~~**Does normalization belong in the tool at all?**~~ **Resolved on day three by the user**, who
   asked for a normalized report and volunteered the constraint before being asked: *"don't make any
   changes on the original time entries, just give me a report."* Ship it display-only, with a
   **mandatory** `explanation` — see item 6. What remains open is narrower: does `--normalize` refuse
   above some factor, or warn? Day three's 2.18× produced a fabricated distribution that only prose
   flagged.
7. **Two lookback horizons.** (New, from **V**.) `resumeEntry` reads 60 day-files
   (`src/entries.mjs:359`) and ignores `lookbackDays: 3`. Make the config authoritative, or scope it
   to the commands it already governs and document the difference? *Leaning: make it authoritative —
   a config value the tool silently overrides is worse than no config value.*

## Explicit non-goals

- Reconstructing past days from calendars or chat — the skill is a live clock and should stay one.
- Syncing state back to Linear. Day two's 18m of planning sat under a ticket Linear already marked In
  Progress, day three logged 4h01m against ACME-411 the same way, and day four read ACME-162's title
  from Linear and wrote nothing back — including a stop note (*"blocked by ACME-411 tests"*) that a
  Linear comment would plausibly have wanted. Nothing synced in either direction, and nothing should
  without an explicit ask.
- Claiming attribution says anything counterfactual. It apportions elapsed minutes. It does **not**
  say a task would have taken less time without multitasking, and no timestamp can.
