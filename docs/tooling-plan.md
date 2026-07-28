# Tooling improvement plan

Derived from [`docs/discovery-2026-07-28.md`](discovery-2026-07-28.md) — 15 findings (`A`–`O`) from
the first full day of using the tracker for real work through its conversational skill.

**Prioritized by evidence, not by how interesting the fix is.** A finding that bit three times in
one day of ordinary use outranks a theoretical hole. Effort is S (< 1h), M (a few hours), L (a day).

---

## Tier 0 — already done

| | Finding | Change | State |
| :-- | :-- | :-- | :-- |
| ✅ | **J** | `src/report.mjs:329` indents with U+00A0, not `&nbsp;` | Applied, 144 tests green, **uncommitted** |

---

## Tier 1 — the conversational layer is wrong, fix first

These two produced actual wrong behavior during normal use. Nothing else on this list did.

### 1. `resume` and `--last` pick the wrong entry — finding E · **S**

**Evidence: three occurrences in one day**, always the same shape — pause something, come back,
and the obvious command reopens the thing you just closed.

`src/entries.mjs:358-377` sorts all candidates by start descending and, with no query, takes
`candidates[0]`. Immediately after a `stop`, that *is* the entry just stopped.

**Change.** Define bare `resume` as *"the thing I was doing before the last thing I stopped"*:
among closed entries, take the latest start **excluding the most recently ended entry**. Under
concurrency, multiple entries may share that latest end — exclude all of them.

Define `--last` for `note` explicitly as *most recently touched* (started or stopped, whichever is
later) and say so in `--help`, because with parallel clocks "last" currently has three defensible
readings.

- `src/entries.mjs` — `resumeEntry`, and wherever `--last` resolves
- `test/` — cases: stop→resume returns the *prior* entry; stop-two-then-resume; single-entry day
- `.claude/skills/time-tracking/SKILL.md` — the phrase table marks the query optional, which
  invites the bug. Note that a query is strongly preferred under concurrency.

### 2. Project identity: no way to decline a fuzzy match, no way to delete — findings A + B · **M**

Ship together; each is half a fix. Today `tttracker` would have been absorbed into `tracker`, and
the only reason it wasn't is that the collision was spotted first.

`src/projects.mjs:109-128` runs the edit-distance branch **before** create (`:138`) with no bypass,
so while a near-named project exists a genuinely new similar name can only be absorbed. And
`projects` has `list | alias | rename | merge` but no `rm`, so a typo is permanent *and* keeps
shadowing every nearby name.

**Change.**
- Add `--new` to `start` / `switch` / `edit`: skip the fuzzy branch entirely and create the exact
  slug. Backwards compatible — default behavior unchanged, warning still relayed.
- Extend the existing warning to name the escape hatch: `… pass --new to create "<raw>" instead`.
- Add `projects rm <id>`: refuse when any day file references it, listing the count, unless
  `--force`. Point at `projects merge` as the usual answer.

- `src/projects.mjs`, `bin/tracker.mjs` (arg parsing, `--help`)
- `test/` — fuzzy match declined via `--new`; `rm` refused with references; `rm --force`
- Verifies `nextSteps.md` item 3 as a side effect: the warning path finally gets exercised

---

## Tier 2 — the record is incomplete

Not wrong, but the day can't be reconciled against the clock.

### 3. `log` — record an already-finished activity atomically — finding F · **S**

"just finished the Orion sync, it went from 8 to 8:40" needed `start --at` then `stop --at`: two
commands, entry transiently open, and a crash in between leaves it running.

Add `log <task…> --project P --from T --to T [--tags] [--link] [--note]` writing one closed entry
in a single write. Reuse the existing timestamp validation (future stamps are already rejected).
Add the phrase-table row — "I did X from A to B" is a very common utterance with no mapping today.

### 4. Surface untracked gaps — finding G · **S**

Today: 07:20→17:37 elapsed, 8h52m tracked. The difference is invisible unless computed by hand, and
today it was ~47m in one stretch alone.

`unionMinutes` is already computed, so gaps are just its complement within
`[min(start), max(end)]`. Add `untrackedMinutes` to the `today` / `report` payload, and a `--gaps`
flag listing the intervals.

---

## Tier 3 — the skill misleads

Documentation-only, zero code risk, so it can land at any point — worth doing early since it shapes
every interaction. One commit.

All in `.claude/skills/time-tracking/SKILL.md` unless noted. **S** total.

- **K** — the example and phrase table prescribe `linear=ENG-412`. Make `ticket=<KEY>` the
  documented default, service-specific keys the exception. Matches how the data is actually wanted;
  the CLI is already service-agnostic.
- **M** — the `authenticate` → `complete_authentication` flow is a **dead end** here: both tools
  exist but are stubs that redirect to `/mcp`. The stated heuristic ("go by which tools are
  present") is unsound because **presence doesn't imply usability**. Route `mcp__claude_ai_*`
  connectors straight to "ask the user to run `/mcp`", or drop the sniffing and just make the call —
  the error states the next step.
- **N + O** — trigger a title lookup only when **the reference carries no human-readable words**.
  `ACME-368/high-level-assessment-…` needs no network; a bare `…/issue/ACME-411/` does. Teach the
  `TICKET-N/slug-words` parse — Linear's own `gitBranchName` field confirms that's exactly the shape
  it generates. When resolving, read `title` and stop; `get_issue` returns description, acceptance
  criteria and state history that nobody needs for a label.
- **H** — missing rows: `stop --all`, `--note` on `stop`, `edit <id> --project P`.
- **I** — no guidance on when a rephrasing ("the *integration*" after "*code review* for" the same
  feature) means a new task versus a resume. Silently picking either corrupts per-task totals; one
  sentence saying to keep them distinct, or ask.

---

## Tier 4 — setup hygiene

### 5. `install-check` shouldn't teach you to pollute your data — finding C · **S**

The install skill's "Finishing" section prescribes
`start "checking the tracker works" --project tracker`, which permanently creates a `tracker`
project — the exact project that nearly swallowed `tttracker` four minutes later. `rm <id>` would
not have removed it (see finding B).

Move the end-to-end check **into** `install-check` against a `mkdtemp` `dataDir`, reported as a
`self-test` check. Then drop the prescribed writes from `.claude/skills/install-skill/SKILL.md`.

### 6. Say what the conflict scan actually covered — finding D · **S**

It reports `0 hard and 0 soft skill conflicts across 0 installed skills` while ~15 skills were
active from sources it never looks at. Accurate for its two roots; reads as "nothing is installed".

Name the roots in the summary and state that plugin/bundled skills are out of scope. Optionally also
scan `~/.claude/plugins/**/skills`. Update `nextSteps.md`-era expectations so `scanned: 0` is only a
pass when the summary doesn't overclaim.

---

## Suggested order

1. **Commit what exists** — the J fix, the discovery doc, this plan, the trimmed `nextSteps.md`.
2. **Tier 3** (skill docs) — zero risk, immediate daily benefit, no tests to write.
3. **Item 1** (`resume`/`--last`) — smallest Tier 1 fix, three real occurrences.
4. **Item 2** (project identity) — highest severity; also unblocks the fuzzy-warning verification.
5. **Items 3 + 4** (`log`, gaps) — both small, both make the day reconcilable.
6. **Tier 4** — hygiene, and it stops the install flow from creating the problem in item 2.

Run the four verification items in `nextSteps.md` alongside — **trigger reliability first**, since it
needs a fresh session and everything else assumes the skill fires at all.

---

## Decisions needed before building

1. **Ticket links and vendors.** Keys stay generic (`ticket=`) per preference. Does
   `tracker.config.json` grow a `ticketBaseUrl` so exports can build clickable links, or do links
   stay opaque and humans supply the context? *Leaning: config option — keeps entries clean, keeps
   exports useful.*
2. **Bare `resume` when genuinely ambiguous.** Resolve to the prior entry as proposed, or refuse and
   list candidates the way `stop` does? *Leaning: resolve, since `stop`'s refusal exists to avoid
   destroying data and `resume` only adds.*
3. **`projects rm` with references.** Refuse and require `merge` first, or allow `--force` and orphan
   the entries? *Leaning: refuse, `--force` available but loud.*
4. **`autoCommit`.** Currently `false`, so today's data exists only as working-tree files in a repo
   created specifically to give it history. Turn it on?
5. **Attribution defaults.** `equal` was right for today. Is `weighted` worth surfacing for the
   background-task case, given the day had a 16m admin task running under two Acme clocks?

## Explicit non-goals

- Reconstructing past days from calendars or chat — the skill is a live clock and should stay one.
- Syncing state back to Linear. Today's 18m of planning sits under a ticket Linear already marked In
  Progress; nothing synced in either direction, and nothing should without an explicit ask.
- Claiming attribution says anything counterfactual. It apportions elapsed minutes. It does **not**
  say a task would have taken less time without multitasking, and no timestamp can.
