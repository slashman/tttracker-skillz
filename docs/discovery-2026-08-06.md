# Tracker discovery session — observations

Findings from **2026-08-06**, the seventh day of real use through the conversational skill.
Continues the letter scheme from [`discovery-2026-08-04.md`](discovery-2026-08-04.md); three new
findings, `AJ`–`AL`, two of them fixed in the session that produced them. Item **E**, open since
day one, was fixed and committed in this session (`dbe8794`).

The day closed at **11 entries, 3 projects, 6h08m raw over 4h43m** of union wall clock — overlap
factor **1.299**, peak concurrency **2**, 1h25m of overlap, 13 context switches. Data in
`~/.tracker/data/days/2026/08/2026-08-06.json`. **AJ** and **AK** were written against a
mid-afternoon snapshot of 7 entries in 1 project, which is why they count the day smaller than this.

**2026-08-05 has 8 entries (3h48m) and no discovery doc.** The tracking record is now ahead of the
observation record — worth knowing when reading this series as a history.

---

## AJ. "What I was doing before" is a question about end times, and only a parallel tracker has to ask it
**Severity: conceptual — the sharpest example so far of a rule that has no counterpart in a
sequential tracker.**

The day's clock, as it actually happened:

| | |
| :-- | :-- |
| 11:52 | start *Address code review feedback* (ACME-162) |
| 12:01 | start *Code review* (ACME-279) — parallel, nothing stopped |
| 12:15 | stop *Code review* |
| 12:27 | stop *Address code review feedback* |
| 13:30 | bare `resume` → **re-opened *Code review*, the wrong one** |

`resumeEntry` sorted candidates by **start** descending, so the entry that began most recently won.
With overlap, that is not the entry that ended most recently: the feedback task started first and
outlasted the review, so it was both *the last thing I was doing* and *not the last thing I
started*.

**In a sequential tracker this bug cannot be written.** One clock means start order and end order
are the same sequence, so "the last thing" needs no qualifier and any implementation of it is
correct by construction. Overlap splits one intuitive notion into two distinct orderings, and the
tool has to choose deliberately which one the phrase means. It is the same shape as the finding
behind attribution — raw minutes and wall-clock minutes are the same number until work overlaps,
and then they are two numbers that both need a name.

The fix needed **both halves**, which is the part worth keeping:

1. Rank by end time, not start time (this finding).
2. Skip anything ending within ~2 minutes of the resume instant, because "the meeting is done, back
   to work" arrives as stop-then-resume in one breath, which makes the thing being *left* the most
   recently finished entry (item **E**, 07-28).

Neither is sufficient alone. End-ranking without the guard resumes the meeting you just left;
the guard without end-ranking still picks by start order among everything else. **E** proposed only
the guard, because on 07-28 the failure was always same-breath; six days of use were needed to
produce the case that exposed the ranking axis itself.

**Method note, and the reason this one is worth writing up.** For five days the running read on
**E** was that bare `resume` was *"a documentation decision rather than a code fix"* — the argument
being that it had never been used in real work
([`discovery-2026-08-04.md`](discovery-2026-08-04.md), *E — bare `resume` avoided for a fifth day*).
The first time it was actually used, it was wrong within one turn. The abstinence was evidence about
the assistant's habits, not about the command. A feature nobody has exercised is not a feature that
works; the tracker's design questions have been settled by use every time, and reasoning about them
in advance has a losing record here.

**STATUS: FIXED 2026-08-06**, commit `dbe8794` — `JUST_STOPPED_MS`, end-time ranking, a warning
naming any skipped entry, and `resumedFrom` on the result so the pick is auditable. See **E** in
[`discovery-2026-07-28.md`](discovery-2026-07-28.md) for the implementation notes.

## AK. The next thing the tool needs is a view, not a command
**Direction set by the user, 2026-08-06:** this works best as *"not a completely headless app"* —
some views of tracked work rendered alongside the interactive chat, rather than every read passing
through prose in the transcript.

Today supports it from the failure side. The mis-resume in **AJ** went uncorrected for nearly an
hour. It was recorded at 13:30, and the only representation of it anywhere was one line of prose
(*"Resumed as `jt77ac` — Code review (ACME-279)"*) scrolled well up the transcript. What caught it
was the **user's own memory of their day**, not anything on screen — the same way the forgotten
clock on 08-04 was caught by the user rather than the tool. Two of the day's seven entries were
written after the fact rather than live (`jt77ac`'s task and ticket rewritten; `qht4e4`
reconstructed from *"stopped at 2:00PM … which just finished"*), and in the first case the wrong
data sat in the file for the better part of an hour with nothing on screen contradicting it.

A day view would have made the wrong pick obvious at a glance, because a wrong pick is visually
loud: a lane that should have continued stops, and a lane that was already closed starts again.
Prose confirmations cannot show that. They report each operation correctly, one at a time, and the
day's shape is what is wrong.

Sketch, unbuilt, deliberately modest:

- **A live day timeline.** Concurrent entries as parallel lanes on one time axis, open clocks marked
  and ticking. This is the view that makes overlap legible, and overlap is the thing this tracker
  exists to represent.
- ~~**Read-only. Chat stays the only write path.**~~ **Revised the same day — see below.**
- **Derived entirely from `--json`.** `today --attribute` and `analyze` already carry everything a
  timeline needs — lanes, overlap minutes, concurrency histogram, per-ticket rows. No new storage,
  no new arithmetic, no second source of truth for durations.
- **Raw and attributed side by side**, since a timeline invites reading area as effort and the two
  numbers differ exactly where the lanes stack.

Open question, worth deciding before building: whether this is a rendered artifact per request, a
local page the CLI serves, or a terminal drawing. The first is cheapest and fits how the tool is
used today; the third keeps everything in one window.

### AK′. Revised hours later the same day: the UI is editable, and the two halves specialise

**Direction, 2026-08-06, superseding the read-only bullet above:** *"we do need a visual UI after
all where the user can manually slot his time entries and change them as needed; this will work
alongside the interactive chat for inference and connection with other services."*

So not a dashboard bolted onto a chat tool. Two interfaces, each doing what it is actually good at:

| | The UI | The chat |
| :-- | :-- | :-- |
| Best at | direct manipulation of things that already exist — drag a boundary, slot a forgotten block, retype a task name, see the day's shape | **inference** (turning *"stopped at 2:00PM for the sync, which just finished"* into two commands with the right boundaries) and **connections** (Linear titles, tickets, whatever comes next) |
| Interaction | pointing at time | describing work in a sentence |
| Failure it fixes | the wrong pick that no prose could show | the entry never created because opening an app was too much friction |

The read-only rule written this morning was the wrong instinct, and today's own data is the
argument against it. Three of the day's nine entries were placed or repaired after the fact —
`qht4e4` reconstructed from a spoken time range, `jt77ac`'s task and ticket rewritten after the bad
resume, `rivl9s` logged as a flat 30m the user chose rather than a measured stretch. Every one of
those is *slotting*: putting a known block of work into a known place on the day. Doing that through
sentences is possible — all three were done that way — but it is the interaction pointing was
invented for, and the transcript above is the evidence of how many turns it costs.

What does **not** change: the CLI still owns every timestamp and every duration. The UI issues the
same commands the chat does and re-reads the same `--json`. The moment a view edits day files
directly there are two implementations of overlap arithmetic, and the day the two disagree is the
day the tool stops being trustworthy.

Consequence for **AJ**: an editable timeline would have made the bad `resume` a two-second drag to
fix rather than an hour of it being wrong. It would not have *prevented* it — the tool still has to
pick the right entry when the user speaks, which is why the fix in `dbe8794` matters either way.

## AL. Notes were an append-only log of the wrong thing
**Severity: medium — silent, and it took a schema change to fix properly.**

Asked at the close of the day what was overflowing to tomorrow, the assistant wrote the answers onto
the nearest entries as notes. One of them — *"editable day UI (AK') recorded as direction, deferred
— no date"* — went onto `rivl9s`, the 30-minute block of tracker work. Nothing about the UI happened
in those 30 minutes. It was **future work parked on an entry describing past work**, and read back
in a week it would look like half an hour spent on a UI that does not exist.

Two separate faults, and the first one hid the second.

**No way to take it off.** `note` only ever appended (`e.notes.push(...)`), and `edit` had no
`--note` flag. The only routes were hand-editing a day file — which the skill forbids, correctly,
because the CLI owns the arithmetic — or deleting the entry and re-logging it. A tool that can
record something it cannot un-record will accumulate wrong data forever, one small mistake at a
time. `note <query> --rm` was written to close that.

**The shape was wrong underneath.** Building removal exposed it: removal-by-position (`--rm 2`,
`--rm last`) needs positions, positions need a list, and a list needs the user to remember what is
in it. The user's call — *"notes should be just an attribute of the entry, not a structured list"* —
made removal trivial (clear the field) and made the timestamps go away, which were never used by
anything. `schemaVersion` went to **2**: `notes: [{at, text}]` → `note: string | null`. Version 1
files fold forward on read, texts joined with `"; "`, and are only rewritten when next written for
their own reasons; all 19 noted entries across seven days survived, verified by export.

Deliberate consequence: a second `note` **replaces** the first. Three entries on 08-04 had used
notes as progress logs (*"verify no regressions on mobile"* → *"smoke tests on mobile successful"*), so
that habit now overwrites rather than accumulates. The replaced text is echoed in the response
specifically so it never vanishes silently, and the skill is told to relay it.

**The finding under the finding, and the one worth the blog post.** The note was *parked* on an
entry because the tool had nowhere else to put it. Deferred work, a decision recorded, a thing to
pick up tomorrow — none of that is tracked time, but the entry was the only writable surface in
reach. Notes then quietly became a to-do list attached to durations. Same pressure as **AK′**, from
the other side: **AK′** is state that wants a *view*, this is state that wants a *home*. A time
tracker that only stores intervals will keep having non-interval state pushed into whatever field
is nearest.

**STATUS: FIXED 2026-08-06**, commit `0271fde`, on top of the `--rm` work in the same session. 172
tests pass, three of them covering the version-1 fold specifically. `docs/SCHEMA.md` documents
version 2; the skill gained a rule that a note is an attribute and that deferred work does not
belong on a past entry.

---

## Carried forward

1. **`--round`** — seven days untouched.
2. **`--normalize`** (**P**) — not requested since 07-30.
3. **`exclusive` attribution** — never used, on any day.
4. **Trigger from an utterance that does not name tracking** — this session opened with an explicit
   `/time-tracking` invocation again, so still untested.
5. **A home for non-interval state** (**AL**, **AK′**) — deferred work, decisions and
   pick-up-tomorrow items still have nowhere to live but an entry's note or a doc. Not designed.
6. **`log` and `split`** — `log` had its first live use today (`qht4e4`, reconstructing the project
   sync from *"stopped at 2:00PM … which just finished"*), reached for without prompting. `split`
   remains unused in real work.

## What worked well (worth not regressing)

- **`edit --task --link` repaired the mis-resume in one command**, timestamps untouched. Same
  surgical-edit property that made the 08-04 restructure possible.
- **`log` was chosen over `start --at` + `stop --at`** for already-finished work, which is exactly
  what finding **F** asked for when it was written on day one.
- **The `ticket=` join key held.** *Address code review feedback* and *PR prechecks* report as two
  activity rows under ACME-162, which is the arrangement settled on 08-04 (**AH**).
