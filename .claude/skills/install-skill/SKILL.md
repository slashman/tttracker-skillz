---
name: install-skill
description: >
  Set up this tracker checkout on a new machine and find installed skills that compete with it for the same phrases. Use
  this skill when the user asks to install or set up the tracker, says the tracker is not working or cannot find its data
  directory, asks to check for skill conflicts or overlapping skills, or asks why the wrong skill keeps firing when they
  talk about their time. Runs the repo's install-check script and walks through each finding.
---

# Installing this checkout

```
node ./bin/install-check.mjs --json
```

Reports setup state and any installed skills that compete with this repo's skills. It
**reports; it does not repair** — every finding carries the exact fix, and you walk the
developer through choosing.

## Two rules you must not break

**1. Never edit this repo's shipped skill descriptions to resolve a conflict.** A collision
between this repo's skill and something on *this machine* is a local problem. Narrowing the
repo's description to dodge it buries a machine-specific workaround inside a shared artifact,
and the next person to clone the repo inherits a skill with unexplained holes in its triggers
and no way to know why. Fix it on the machine, not in the repo.

**2. Never edit the developer's own skills without showing the diff and getting approval.**
Those files are theirs. Propose the exact change, show it, and wait.

## Setup checks

Work through `data.checks` in order. Each has `id`, `status` (`ok` / `warn` / `fail` /
`skipped`), `detail` and `fix`. Fails block use; warns usually don't but are worth clearing.

- `node-version` — needs Node 20+
- `config-file` — no `tracker.config.json` yet. Offer to
  `cp tracker.config.example.json tracker.config.json` and ask where tracked time should live.
  It's gitignored on purpose: it holds a machine-specific path.
- `data-dir` / `data-dir-git` — the data directory is created on first write. `git init`-ing it
  is optional but gives the time data its own history; that's also what makes the `autoCommit`
  config option useful.
- `allowlist` — without `.claude/settings.json`, every tracker call prompts for permission.
- `tests` — `node --test`. A failure here means something is genuinely broken; don't paper over it.

## Skill conflicts

`data.skills.conflicts` holds anything that might compete for the same utterances. Each entry
has the competing skill's `name`, `scope` (user / project / plugin), `file`, `source`, the
**exact `sharedPhrases`**, and a `reason`.

**Your job is the judgment call the script deliberately doesn't make.** A shared-phrase list is
evidence, not a verdict. For each conflict, look at both descriptions and say which it is:

- **A real misfire risk** — both skills plausibly answer the same sentence. Example: a
  retrospective timesheet skill that claims *"time tracking"* and *"what did I work on"* versus
  this live clock. A user saying "log my time" could reasonably land on either.
- **Incidental** — shared vocabulary, different jobs. Two skills both mentioning "project" or
  "report" is not a conflict.

Say which, and why, in a sentence. Do not just dump the scores.

`kind: "hard"` means two skills share a name across scopes. The tool reports this as *rename
one* rather than "the project one wins", because which scope takes precedence is not something
it verifies — and relying on an unverified precedence order risks silently shadowing the
developer's own skill. Tell them that plainly.

Note `source`: a stock example skill the developer never wrote is a much softer conflict than
one they built and rely on.

## Resolutions to offer

All of these are local, and all preserve the repo as-is:

1. **Add a routing line to their own skill** — e.g. a line in their timesheet skill saying that
   live clock-in/out in this repo is handled by the tracker's skill. Show the exact diff first.
2. **Rename or relocate their skill** — required for a hard name collision.
3. **Accept the ambiguity and invoke explicitly** — `/time-tracking` always reaches this repo's
   skill regardless of what else is installed. Often the right answer for a rare overlap.
4. **Disable one of them** — if a stock example skill they never use is the one colliding.

Recommend one, briefly, and let them choose.

## Finishing

Once setup checks pass, confirm end to end with something real rather than declaring success:

```
node ./bin/tracker.mjs start "checking the tracker works" --project tracker --json
node ./bin/tracker.mjs status --json
node ./bin/tracker.mjs stop --all --json
```

Then hand over to the `time-tracking` skill for normal use.
