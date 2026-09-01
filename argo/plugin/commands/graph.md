---
description: Analyse this repo's reference graph — hubs, shared surface, and how wide a fan-out it actually supports
argument-hint: "[path] [--workers N] [--include-docs]"
allowed-tools: Bash, Read, Glob, Grep
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" graph $ARGUMENTS`

## Read this for the user

Lead with the answer, not the table.

- **The hubs are the story.** A short file named by many others constrains
  parallel work far more than a long file named by nobody. Point at the top
  hub by name and say what its blast radius means: that many files can break
  from one edit there.
- **Coverage below 90%** means the graph is incomplete — the resolver missed
  intra-repo references. Flag it. Do not present the plan as settled.
- **The sweep** shows effective speedup, bounded by the slowest worker, not the
  idealised 1/k. If effective and ideal diverge sharply, the cut is unbalanced
  and that is the finding.
- **`hub-bound` verdict** → recommend splitting the top hub into the halves its
  readers actually use. Half of them usually only ever needed one half. That
  buys more parallelism than any number of extra workers.

If the user asked this before fanning out, follow with `/argo:fanout`.
