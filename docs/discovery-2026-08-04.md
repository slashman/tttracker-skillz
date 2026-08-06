# Tracker discovery session — observations

Findings from **2026-08-04**, the fifth day of real use through the conversational skill. Continues
the letter scheme from [`discovery-2026-07-31.md`](discovery-2026-07-31.md); five new findings,
`AE`–`AI`, plus the first day on which findings were **fixed in the same session that produced
them** — `log`, `split`, **AB** and **AD** all shipped (see [`tooling-plan.md`](tooling-plan.md),
Tier 0).

The day itself: 11 entries, 2 projects, 07:12–16:30, raw 7h57m over **5h07m** of union wall clock —
overlap factor **1.556**, peak concurrency **2**, 2h51m of overlap, 10 context switches. Data in
`~/.tracker/data/days/2026/08/2026-08-04.json`.

Two things frame everything below.

**This is the second-most parallel day on record** (1.556, against day one's 1.28 and 07-31's 1.22),
and the first where the parallelism was sustained rather than a slice: 2h51m of the 5h07m had two
clocks running. Every overlapping minute was hands-on — no agent-in-the-background pairs like 07-31.

**The dataset was restructured mid-day.** The user settled the task-naming question that findings
**I** and **R** have left open since day one — *"I definitively want tasks split, the ticket code
ties them together, but I need individual time entries to satisfy my curiosity"* — and nine entries
were renamed from ticket titles to activities. That rebuild is where **AF** came from, and it is the
reason this day reads differently from the four before it.

Three preceding days (08-01 to 08-03) have **zero entries**. See the note under **G** below.

---

## AE. A weight set on an entry is silently ignored by the default strategy
**Severity: high — two truthful reports of the same day disagree, and neither says why.**

Following **Z**, `qzk7r6` (tttracker, agent-driven) was set to `--weight 0.25` against a hands-on
ACME-411 entry at `1`. Both reports are correct and they do not agree:

| | raw | `equal` (default) | `weighted` |
| :-- | --: | --: | --: |
| `qzk7r6` improvements | 8.43m | **4.45m** | **2.06m** |
| `dsc7na` mobile smoke testing | 7.97m | 3.98m | 6.37m |

`attributionStrategy` in `tracker.config.json:12` is `equal`, and `equal` discards weights entirely.
So `edit --weight` reports success, the value is stored on the entry (`src/entries.mjs:297-299`),
and every subsequent report ignores it unless `--strategy weighted` is passed by hand. The
`attribution.explanation` field — the mechanism that exists precisely to keep attributed numbers
honest — says *"time is split evenly among the tasks running at the same moment"* and does not
mention that weights were recorded and dropped.

**This corrects finding Z.** **Z** concluded *"the mechanism is complete; only the conversational
trigger is missing."* That was wrong in a way worth naming: the write path and the read path are
complete and **unconnected**. Setting a weight changes nothing a reader will ever see, and the user
who set it has no way to notice, because the number that comes back is plausible.

**Change.** When any entry in range carries `weight !== 1` and the active strategy is not
`weighted`, emit a warning: `3 entries carry weights that the "equal" strategy ignores — pass
--strategy weighted to use them`. The entries are already gathered at `src/report.mjs:48-53`, so
this is a filter and a string.

Do **not** switch strategy automatically when weights are present. Inferring the strategy from the
data changes numbers silently, which is the same class of error one level up.

## AF. Notes are write-only — nothing will give them back
**Severity: high — it blocked the exact workflow notes exist for.**

`note` writes them. `start`, `stop`, `edit` and `status` echo them for the entry they happen to
touch. `export` emits `noteCount` and not the text (`src/report.mjs:292`). `report` and `today`
carry them not at all. `grep -n "notes" bin/tracker.mjs` returns **nothing** — there is no command
whose job is to show you a note.

This surfaced while rebuilding the day's task names, where each entry's activity lived in its notes.
Eight entries were renamed successfully — from notes visible in the *conversation*, not from the
tool. Two could not be:

- `ketfb4` (07-28, 18m) — the first ACME-411 entry, one note, contents unknown
- `svbad7` (07-30, **4h01m**) — the single largest entry in the dataset, zero notes

Both keep their old ticket-title name, so the activity breakdown has a 4h19m hole in it. Reading the
day file directly would have answered it in seconds and is the one thing the skill categorically
forbids.

**This is AA in a second field.** **AA** was links: stored faithfully, not retrievable, worked
around with `export | grep`. This is notes: stored faithfully, not retrievable, and not workable
around at all. Two of the three free-form fields on an entry are write-only. The pattern is that
`report`/`export` were designed as *aggregation* surfaces and the tool has no *inspection* surface —
which is also what **U**, **V** and **AA** have each been asking for from a different direction.

**Change.**
- Add `notes` to export rows: the array under `--format json`, joined under `--format csv`,
  consistent with the **AB** fix.
- Note text belongs in `show <query>` (item 10). That command is now carrying links, notes, stints
  and totals — it is the missing inspection surface, not a convenience.
- Optional `--notes` on `today` / `report` for the end-of-day read.

## AG. A clock ran 6h21m past the end of work and nothing anywhere noticed
**Severity: medium-high — this is the failure mode the tool's own premise depends on.**

`yuxn12` was started at 15:58 by splitting a running entry. Work stopped at 16:30. The entry was
still open at **22:19**, when the user asked *"what are we on now? I think I forgot to stop the
clock."* `status` reported `elapsedMinutes: 381` in exactly the shape it uses for 20 minutes. Closed
with `stop yuxn12 --at 16:30` → 31m, and the 5h50m phantom never reached a report.

Had the question not been asked, the day would have reported 13h16m raw with a 6h21m entry as its
largest line, and nothing in the data would have marked it as suspect.

The project's argument against commit-mining is that inferred time is inaccurate and explicit
signals are better. **The honest counter-argument is this finding**: explicit signals fail by
omission, silently, and the person best placed to notice is the one who already walked away. A tool
built on explicit signals needs a story for the signal that never arrives, and currently has none.

It cannot be a hard rule — `svbad7` is a genuine 4h01m entry. It can be a warning.

**Change.**
- `status` and `today` flag any open entry past a threshold (`staleAfterHours`, default 4), with the
  comparison that makes it concrete: `open 6h21m — longer than any completed entry in the last 30
  days; if you forgot, stop <id> --at <when>`.
- Flag entries open across a local-day boundary. `findOpenEntries` **already computes
  `carriedOver`** and every command reports it as a flat field; nothing treats it as noteworthy.
- Consider a warning on `start` when something has been open a long time, since that is the moment
  the user is present and typing.

## AH. Task names are activities, the ticket is the join key — I and R resolved together
**Severity: resolves two day-one/day-two findings, and the change is already applied.**

The user's decision, unprompted and explicit:

> I definitively want tasks split, the ticket code ties them together, but I need individual time
> entries to satisfy my curiosity.

So: one task line per **activity**, `ticket=KEY` as the join. `Account refresh — manual
verification` and `Account refresh — manual code vetting`, not one line named for the ticket with
the activity in a note. Applied to nine existing entries via `edit --task` (timestamps untouched);
recorded in `SKILL.md` and in the assistant's memory.

**This settles I and R from one principle.** **I** was one feature with two activities (should
split); **R** was one activity with two names (should merge). Both are the same question —
*what is the unit being measured?* — and the answer is the activity. The task string is the
measurement key, so it must name the thing being measured.

Three consequences discovered while applying it, each worth carrying forward:

1. **The rebuild depended on notes**, and two entries were unrecoverable. That is **AF**, and it is
   an argument for doing **AF** before this convention is applied to any more history.
2. **The `<feature> — <activity>` compound is a workaround, not a preference.** A bare
   `manual verification` would collide across tickets, because reports group on the exact task
   string and there is still no way to filter by link. The feature prefix exists to compensate for a
   missing report dimension. **If item 10 (`--link` filtering) lands, the prefix becomes redundant**
   — worth deciding then whether to drop it rather than carrying it forever.
3. **Activity-level naming makes R more likely, not less.** More task strings, each shorter and more
   generic, is more surface for one activity to acquire two names. The same day produced a third
   shape for one recurring activity — `grooming and planning meeting`, alongside `Planning session
   for notifications and community` and `meeting: admin tools design and planning`. Three lines, one
   thing. **R**'s `data.similarTasks` proposal is now higher value than when it was written.

## AI. The plan has drifted from its sources — twice, both times inflating
**Severity: medium — it is the document being published from.**

Two counts in `tooling-plan.md` did not match the discovery docs they were derived from:

| Claim in the plan | What the source says |
| :-- | :-- |
| bare `resume` "hit three times on day one" | `discovery-2026-07-28.md:66-68` — **twice**, and names both |
| `log`: "two backfills day one" | `discovery-2026-07-28.md:74-77` — **one**, the Orion sync |

Both were introduced by writing the plan *from* the discovery docs by summary rather than by
re-reading them, and both inflate the evidence in the direction of the argument being made. Both are
now corrected.

This is not only bookkeeping. The user drafted a public post from these documents, and its first
draft asserted *"47m of yours went unaccounted before lunch"* — a figure matching nothing in the
record (the source says ~13m). Three inflated numbers, three different documents, one root cause:
**a derived document that restates counts will drift from the document that holds them.**

**Change.** Counts belong in the discovery docs, which are dated, append-only and evidentiary. The
plan should cite — *"see finding F"* — rather than restate. Where a count genuinely helps prioritise,
give it with its source line, so drift is checkable rather than invisible.

---

## Corroborations that change the weight of existing findings

### F + AC + W — **fixed.** `log` and `split` shipped
`log <task…> --project P --from T --to T` writes one closed entry in a single write; `split <id>
--at T [--task] [--first-task]` cuts an entry in two at one instant, and an open entry stays open so
the second half inherits the clock. Eight tests. Details in Tier 0 of the plan.

Today's grooming meeting was recorded with the old `start --at` + `stop --at` dance, **hours before
`log` existed** — the eighth occurrence of **F**, and the last. Note also that the mid-day activity
split (`5nhfzu` → `yuxn12`) was performed by hand with `edit --end` plus `start --at`, passing the
full stored instant `2026-08-04T15:58:38-05:00` on both sides to avoid **W**. That worked, and it is
exactly the four-step sequence `split` now does in one — but **neither new command has yet been used
in anger**: their only exercise so far is the test suite and one temp-directory smoke run.

### AA / U — fifth day, and the workaround is now conversational memory
*"resume work in ACME-162"* was resolved to entry `zphih7` from **this conversation**, not from the
tool — no `export | grep` was needed only because the fact was already in context. That is the
failure mode at its most deceptive: it works perfectly until the session ends, and then silently
does not. Items 1 and 10 both still open.

### G — 4h11m untracked, and **a zero-entry day is indistinguishable from a day off**
Span 07:12–16:30 (9h18m) against 5h07m of union: **4h11m untracked**, in gaps of 26m, 1h26m, 13m,
1h16m and 50m. Computed by hand again, on the fifth day.

New this round: **2026-08-01, 08-02 and 08-03 all have zero entries.** Two are a weekend; 08-03 is a
Monday. Nothing in the data says whether that was a day off, a holiday, or a full working day nobody
tracked — and a tool whose purpose is *"knowing what you did with your time"* should not be silent
about a missing weekday. Same root as **G**: the tool reports what it holds and never what it lacks.

### T — held again, from the other side
`overlapMinutes` was 171, and raw diverged from attributed on exactly the entries that overlapped;
the meeting and the final vetting stint — the only unaccompanied stretches — matched. Second
consecutive day the Raw/Attributed pair earned its place.

### Z — see **AE**, which corrects it.

### E — bare `resume` avoided for a fifth day
*"resume both now"* became two `resume <id>` calls. Bare `resume` has still never been used in five
days of real work, which continues to argue that this is a documentation decision rather than a code
fix.

---

## Still unverified

1. **Bare `resume`** (**E**) — five days.
2. **`--round`** — five days untouched. Item 6 still proposes building normalization on its
   largest-remainder path with no field evidence.
3. **`--normalize`** (**P**) — not requested since 07-30; two requests in five days.
4. **`exclusive` attribution** — never used, on any day.
5. **Trigger from an utterance that does not name tracking.** 07-31 settled the leading-verb case
   (*"track for today…"*). Every session on 08-04 either used `/time-tracking` explicitly or opened
   with `start` / `stop` / `resume` as the first word. *"I'm picking up ACME-162"* remains untested.
6. **`log` and `split` in real use** — shipped and tested, not yet reached for by the skill in a live
   turn.

## What worked well (worth not regressing)

- **`edit --task` across nine closed entries** rebuilt the whole day's naming with no timestamp
  touched and no ids broken. The restructure was possible only because `edit` is surgical.
- **`stop --at 16:30` on a 6h21m phantom** corrected it to 31m in one command, with nothing else
  disturbed — the repair path for **AG** is good even though the detection is missing.
- **`resume <id>` propagating `ticket=` links** onto both resumed entries, again unprompted.
- **`--json` + `python3` for every read in this session.** Not one command needed its prose output
  parsed, which is the contract holding up best across five days.
- **The user caught the forgotten clock, not the tool** — worth recording plainly, because it is the
  only reason today's numbers are right.
