# Vendored skills

Twelve of the skills in this directory are **vendored**, not linked. Their files
live here in full; nothing resolves them from a remote marketplace, a git
submodule, or an `npx` install at run time. Update them by editing the files.

| origin | skills |
|---|---|
| Builder.io — MIT, see [`LICENSE-builderio-skills`](LICENSE-builderio-skills) | `agent-watchdog`, `efficient-fable`, `efficient-frontier`, `plan-arbiter`, `plow-ahead`, `quick-recap`, `read-the-damn-docs`, `rewind`, `stay-within-limits`, `visual-edit`, `visual-plan`, `visual-recap` |
| this project | `graph-engineering` |

The MIT licence permits vendoring and modification. It also requires the
copyright notice to travel with the code, which is why `LICENSE-builderio-skills`
sits beside them and this file names the origin. That is a licence condition
rather than a dependency — removing it would not decouple anything, it would
just make the copy unlicensed.

## Prerequisites some of them assume

Vendoring copies the instructions, not the tools they drive. These have real
external requirements and will not work without them:

- **`rewind`** — needs Clips Desktop installed and recording.
- **`visual-edit`** — needs the target app already running locally.
- **`visual-plan` / `visual-recap`** — render to local files; check each
  `SKILL.md` for what they write and where.

The rest are pure instruction skills and work as-is.

## Where they overlap with this project

Four of them sit squarely on the same ground as `graph-engineering`, and are
cross-referenced from it rather than duplicated:

- **`agent-watchdog`** — auditing another agent's work. This is the supervisor
  role from the other side: `graph-supervisor` aggregates workers it dispatched,
  `agent-watchdog` reviews a run nobody supervised at the time.
- **`efficient-frontier`** and **`efficient-fable`** — spending expensive models
  on judgement and cheap ones on volume. `docs/playbook.md` carries the measured
  numbers behind that trade (96% of performance at 46% of cost, and Anthropic's
  own later walk-back of it).
- **`stay-within-limits`** — usage ceilings before long-running work. Directly
  relevant to fan-out width, which is what `argo graph` computes.
