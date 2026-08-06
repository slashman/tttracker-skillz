# Tracker discovery session — observations

Findings from **2026-07-28**, the first day the tracker was used for real work through its
conversational skill rather than by hand. Each entry: what happened, the repro, the file to change.
Doubles as the acceptance pass for `nextSteps.md` steps 7–10.

Fifteen findings, `A`–`O`. **J** and **E** are fixed; the rest are open. Severity is called out
inline where it matters — **E** and **A** have the strongest evidence behind them.

The day itself: 16 entries, 5 projects, 07:20–17:37, raw 11h21m over 8h52m of wall clock (overlap
factor 1.28, peak concurrency 3). That data is in `~/.tracker/data/days/2026/07/2026-07-28.json`
and is a usable test fixture for the attribution arithmetic.

---

## A. Fuzzy project match has no opt-out, so a genuinely new project can be unreachable
**Severity: high — silently merges two real projects.**

`start "writing the blog post" --project tttracker` would have resolved to the existing
`tracker` project. `src/projects.mjs:109-128`: levenshtein("tttracker","tracker") = 2, len 9 →
`allowed = 2`, ratio 0.22 ≤ 0.34, so it matches. The fuzzy branch runs **before** the create
branch (`:138`), and there is no flag to bypass it — so while a near-named project exists, the
new name can never be created, only absorbed.

The warning is emitted, which is good, but by then the entry is already attached to the wrong
project. Fix options: a `--new` / `--exact-project` flag; or, on a create-capable call, make the
fuzzy branch an *error* listing the candidate plus "pass --new to create it anyway" rather than
an auto-adoption.

Note: `nextSteps.md` lists fuzzy matching as "already verified by hand, not worth re-testing".
The hand test would confirm matching *works*; it would not reveal that you cannot opt out.

## B. No way to delete a project
`projects list | alias | rename | merge` — no `rm`. Compounds (A): a typo'd or throwaway project
is permanent **and** keeps shadowing every nearby name. Removing today's test project needed
`git clean -fd` in the data dir, i.e. reaching past the CLI, which the skill explicitly forbids.

Add `projects rm <id>`, refusing when entries reference it unless `--force` (or requiring
`merge` first). Also left behind today: an empty `admin` project, unremovable.

## C. The install skill's own smoke test pollutes the project namespace
`install-skill`'s "Finishing" section prescribes
`start "checking the tracker works" --project tracker`. That permanently creates a project named
`tracker` — which then shadowed `tttracker` about four minutes later (see A). The skill tells you
to `stop --all` but never to clean up, and `rm <id>` would not remove the project anyway (see B).

Fix: have `install-check` run its own end-to-end self-test against a temp `dataDir` and report
it, so the smoke test never touches real data. Failing that, the skill must name a reserved
project (e.g. `_selftest`) and tell the user it will persist.

## D. `install-check`'s conflict scan overstates its coverage
Output: `0 hard and 0 soft skill conflicts across 0 installed skills`, with roots
`~/.claude/skills` (absent) and `<repo>/.claude/skills`. But this session had ~15 skills
available (`dataviz`, `loop`, `schedule`, `artifact-design`, …) from bundled/plugin sources the
scan never looks at. `scanned: 0` is accurate *for those two roots*; "across 0 installed skills"
reads as "nothing is installed", which is false.

Fix: report the roots scanned and state plainly that plugin/bundled skills are out of scope.
`nextSteps.md` step 10 treats `scanned: 0` as the pass condition — it should also require that
the summary not overclaim.

## E. Bare `resume` re-opens the entry you just closed
`src/entries.mjs:358-377`: candidates are all entries sorted by start descending, and with no
query it takes `candidates[0]`. Immediately after a `stop`, that *is* the entry just stopped —
so "meeting done, resume work" handled as `stop` + bare `resume` restarts the meeting.

Hit twice today (after the daily report, and after the admin-tools meeting); both times an
explicit query was needed. The skill's phrase table maps "back on what I was doing before" to
`resume [query]` with the query optional, which invites the bug.

Fix: exclude the most-recently-ended entry (or any ending within a few seconds) from bare
`resume`; and until then, the skill should mandate a query.

**STATUS: FIXED 2026-08-06** — `resumeEntry` in `src/entries.mjs` now does two things. It ranks
candidates by **end** time rather than start, because "what I was doing before" is the work that
stopped most recently, and a long task started first can outlast a short one started later
(reported 2026-08-06: after stopping a review at 12:15 and a longer feedback task at 12:27, bare
`resume` picked the review). Then the guard this finding asked for: any entry ending within
`JUST_STOPPED_MS` (2 minutes) of the resume instant is skipped as the thing being left rather than
returned to, with a warning naming what was skipped. The window is measured against the resume
instant, not wall-clock now, so `stop --at 14:00` followed by `resume --at 14:00` is caught too.
When the just-stopped entry is the only finished one it is still resumed — there is nothing earlier
to return to — but the warning says so out loud. The result carries `resumedFrom` so the pick is
auditable. Four tests added; 166 pass. The skill does **not** need to mandate a query.

## F. No first-class way to log an already-finished activity
"just finished the Orion sync, it went from 8 to 8:40" — never clocked in. Recording it took
`start --at 8:00` then `stop --at 8:40`: two commands, with the entry transiently "running" in
between, and a window where a crash leaves it open.

Add `log <task…> --project P --from T --to T` writing a closed entry atomically. The skill's
phrase table has no row for "I did X from A to B", which is a very common utterance.

## G. Nothing surfaces untracked gaps
Day spanned 7:20→12:08 (4h39m) with 4h26m tracked; the ~13m of handoff gaps are invisible unless
computed by hand. Every start/stop handoff leaks a minute or three, including two caused by my
own clarifying questions.

Add `untrackedMinutes` within the day's span to `today`, or a `--gaps` flag listing them, so a
day can be reconciled against the wall clock.

## H. Skill phrase table gaps
- "stop work" / "done for the day" → `stop --all` is absent; the table only has bare `stop`.
- `--note` on `stop` is undocumented in the table, though "stop work, PR sent" is natural and
  worked well.
- Nothing covers "that time should be under project X" → `edit <id> --project P`, which came up.

## I. Same-feature, different-activity naming is ambiguous
"resuming work in the Import Records feature **integration**" after two segments of "code
review for the Import Records feature". Same feature, different activity. I opened a new task
line rather than resuming, to keep review time out of integration time. The skill offers no
guidance on when a rephrasing means a new task versus a resume — worth a sentence, since silently
picking either corrupts per-task totals.

## J. `&nbsp;` HTML entities leak into terminal output
**Severity: low impact, high visibility — wrong on every table the tool prints.**

`src/report.mjs:329` indents task rows with the literal string `&nbsp;&nbsp;`:

```js
const label = `&nbsp;&nbsp;${t.task}${t.open ? ' ⏱' : ''}`
```

The primary consumer is a **terminal**, whose markdown renderer does not decode HTML entities,
so every task row displays as `&nbsp;&nbsp;code review for the …`. Reported from the console on
2026-07-28 with a screenshot.

This is amplified by the skill, which says "the CLI's own `message` field already contains a
rendered markdown table you can use directly" — following that instruction faithfully reproduces
the artifact in the assistant's replies too.

**STATUS: FIXED 2026-07-28** — the only finding here already applied. `src/report.mjs:329` now
indents with two literal U+00A0 characters (verified as bytes `c2 a0 c2 a0`; ASCII spaces would be
trimmed by the table renderer and lose the indent entirely). 144 tests pass; nothing asserted on
the old string (`grep -rn nbsp test/` → nothing). **Uncommitted on `main`.**

Consider also whether `message` should be terminal-first at all: if a browser-targeted variant is
ever needed, that argues for the renderer taking a target rather than hardcoding entities.

## K. Skill hardcodes a vendor link key in its example; user wants generic
The skill's "Linking to trackers" section shows `--link linear=ENG-412` throughout, and the phrase
table maps "that's ticket ENG-412" → `link <query> linear=ENG-412`. On 2026-07-28 the user
confirmed `ACME-368` **is** a Linear ticket but said he prefers the key stay generic: `ticket=`.

The CLI is already service-agnostic by design (arbitrary `links` key/value); it's only the *skill*
that leans vendor-specific. Fix: make `ticket=` the documented default in both the example and the
phrase table, mentioning service-specific keys as an option rather than the norm. Cheap change,
and it stops the skill from steering every entry toward a vendor-encoded export.

Also worth deciding for the plan: if the key is generic, nothing in the data says which system a
key belongs to. Either that's fine (humans know), or `tracker.config.json` should carry a
`ticketBaseUrl` so exports can build links without encoding the vendor per entry.

## L. Ticket-title resolution: degradation path confirmed, live path still unverified
`ACME-368` was recorded with no title lookup. Only `mcp__claude_ai_Linear__authenticate` and
`complete_authentication` exist on this machine, so issue-reading tools require OAuth first. The
skill's "degrade rather than fail" instruction worked exactly as written — the clock started
immediately with the key alone.

So the *fallback* is now verified in practice. The *live* path (OAuth → resolve title → start with
link) is still untested, which keeps `nextSteps.md` known-unknown #1 open. Note the branch name
supplied a perfectly good human title, which raises a design question: when the user pastes a
branch like `ACME-368/high-level-assessment-of-the-reporting-project`, title resolution adds
almost nothing. Worth teaching the skill to parse `TICKET-N/slug-words` branch names directly —
that pattern covered this case with zero integration cost.

## M. The skill's Linear OAuth instructions lead to a dead end on this machine
**Resolves `nextSteps.md` known-unknown #1 — partially, and not the way the skill expects.**

The skill says: "If the only Linear tools present are `authenticate` and
`complete_authentication`, the server is installed but unauthorized … Call `authenticate`, give
the user the authorization URL, then pass the callback URL … to `complete_authentication`."

On this machine that is exactly the tool inventory, so the skill's branch fires — and
`mcp__claude_ai_Linear__authenticate` returns:

> This is a claude.ai MCP connector. Ask the user to run /mcp and select "claude.ai Linear" to
> authenticate.

No authorization URL, so `complete_authentication` is unreachable. The skill *does* mention the
`/mcp` variant, but gates it on "no auth tool at all" — whereas here both auth tools **exist and
are non-functional stubs**. The stated heuristic ("go by which tools are present") is therefore
insufficient: presence does not imply usability.

Fix: for `mcp__claude_ai_*` connector-style servers, route straight to "ask the user to run
`/mcp`". Better still, drop the inventory-sniffing heuristic and just try the call — the error
message is self-explanatory and tells you the next step. Verified 2026-07-28: one wasted tool call
before reaching the right instruction, which is cheap but avoidable.

Still unverified even now: whether an authorized server actually resolves a title usefully.

## N. Bare issue URLs carry no human words — this is where title resolution earns its keep
`https://linear.app/<org>/issue/ACME-411/` ends at the ID with no slug, so the entry started
life labelled just `ACME-411`. Contrast the earlier branch names
(`ACME-368/high-level-assessment-…`), which parsed into a perfectly good title for free.

Sharpens finding L: the trigger for spending an integration round-trip should be **"the reference
carries no human-readable words"**, not "a ticket was mentioned". Cheap heuristic, and it means
the common branch-name case never touches the network.

## O. Live Linear resolution works; two lessons for how to wire it in
Verified end to end on 2026-07-28 after `/mcp` auth: `get_issue("ACME-411")` → title →
`edit ketfb4 --task "…"`, start time preserved. Closes `nextSteps.md` known-unknown #1.

1. **`gitBranchName` validates the branch-name parse.** The response carries
   `acme-411-sso-recovery-for-a-stuck-account` — precisely the shape pasted
   for ACME-368 and ACME-63. So finding N's parse isn't a guess about human habit, it reconstructs
   what Linear itself generates. Safe to lean on.
2. **`get_issue` returns far more than needed.** Full description, acceptance criteria, state
   history, SLA fields, cycle/team/project ids — for a task label we want `title` alone. If this
   goes in the skill, say "read `title`, stop" explicitly, or context gets hauled in for nothing.

Bonus corroboration: Linear moved ACME-411 to In Progress at 21:59 UTC = 16:59 local, twelve
minutes before the clock started. Two independent systems agreeing on when work began is a decent
argument for eventually reading `startedAt` as a sanity check on a forgotten clock-in.

---

## Still unverified (from `nextSteps.md` known unknowns)
1. **Linear linking** — no ticket came up. Only `mcp__claude_ai_Linear__authenticate` /
   `complete_authentication` are present, so issue-reading tools would require OAuth first.
2. **Trigger reliability** — `time-tracking` was invoked explicitly as `/time-tracking`; every
   later turn rode the already-loaded skill. Whether the description auto-fires on a cold turn is
   still untested. This is the one nextSteps.md calls "the product".
3. **Project inference / warning relay** — no fuzzy warning was ever actually relayed, because I
   headed the only collision off before it fired. Untested in practice.

## What worked well (worth not regressing)
- `switch` reporting `data.closed` with durations, in one atomic call.
- `edit <id> --project` preserving the start time, so moving the daily report from `admin` to
  `acme` cost no time and double-counted nothing.
- `stop --note` attaching "PR sent" to the closed entry.
- Multi-segment tasks summing into one `today` line via `entryIds`.
- `install-check`'s `fix` field per check — made the clean bill of health easy to trust.
