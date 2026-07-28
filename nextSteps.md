# Next steps — what is still unverified

Trimmed 2026-07-28, after a full day of real use through the conversational skill. Most of the
original acceptance pass (steps 7–10) is done; what it produced is in
[`docs/discovery-2026-07-28.md`](docs/discovery-2026-07-28.md) — 15 findings, `A`–`O`.

Delete this file once the four items below are closed.

## State going in

On `main` at `f00ca2b` plus **one uncommitted change**: `src/report.mjs:329` no longer emits
`&nbsp;` into terminal output (finding J). 144 tests green on Node 25.2.1. All six
`install-check` checks pass.

`~/.tracker/data` now holds **real data** — 16 entries across 5 projects for 2026-07-28, raw
11h21m over 8h52m of wall clock, peak concurrency 3. It is no longer empty, so the original
advice about sandboxing to avoid polluting it is moot; the risk now runs the other way, and
anything destructive should be tried against a throwaway `dataDir` instead.

## Already settled — do not re-test

- **Install flow** (step 7). `install-skill` fires, runs `install-check`, reports a clean bill of
  health without inventing work. Caveat in finding **D**: its conflict-scan summary overstates
  coverage.
- **Linear linking** (old known-unknown #1). Verified end to end: `/mcp` auth → `get_issue` →
  title → `edit`, start time preserved. Findings **M**, **N**, **O** cover what it taught us. Note
  the documented `authenticate` → `complete_authentication` flow is a **dead end** on this machine.
- **Concurrency, parallel starts, `alsoOpen`, targeted stops, multi-segment tasks, `resume`,
  `note`, `link`, `edit --project`, `switch`, `today --attribute`.** All exercised on real work.
- **No permission prompts** (step 9). No tracker or `install-check` call prompted all day.
- **Project inference.** "Acme project" → `acme`, and inference from surrounding context worked.

## Still unverified

### 1. Trigger reliability — the one that matters
**The skill firing is the product**, and this is still untested. Both times the `time-tracking`
skill was reached on 2026-07-28, it was invoked explicitly as `/time-tracking`; every later turn
rode an already-loaded skill.

Needs a **fresh session** (skills load at session start), then a plain sentence with **no slash
command**:

> I started working on the checkout bug for Client Co

Expect the skill to fire on its own. If it misses, the fix is the `description` frontmatter in
`.claude/skills/time-tracking/SKILL.md`, not the body.

### 2. The ambiguous-stop refusal
This is the failure mode the design most cares about, and it never triggered — every stop was
given a query or `--all`. With **two or more entries open**, say just:

> I stopped

It must run `status`, show the candidates, and **ask which one**. Never guess: not the oldest, not
the newest, not the likeliest. Related: finding **E** notes `note --last` is ambiguous under
concurrency for the same reason.

### 3. Fuzzy project-match warning relay
Never exercised — the day's one near-collision (`tttracker` vs `tracker`) was headed off before
the warning could fire. Needs a deliberate test: with `acme` existing, start something as
`--project ibee`. The `matched project "…" by similarity` warning must reach the user **verbatim**,
not be swallowed.

Do this against a throwaway `dataDir` — per finding **A** there is no way to decline the match, and
per finding **B** no way to delete the project afterwards.

### 4. `analyze` and `export`
Never run all day, despite the data now being genuinely parallel (overlap factor 1.28, peak
concurrency 3) and therefore worth analyzing:

```
node ./bin/tracker.mjs analyze --json     # overlap factor, concurrencyHistogram, contextSwitches
node ./bin/tracker.mjs export --from 2026-07-28 --to 2026-07-28 --format csv
```

`export` is the documented downstream contract (`docs/SCHEMA.md`), so it should be exercised
against a real multi-project, multi-segment, overlapping day before anything depends on it.
