---
description: Plan a safe parallel fan-out over this repo — compute the shared surface, pick the worker count, and brief the workers
argument-hint: "[task description] [--workers N]"
allowed-tools: Bash, Read, Glob, Grep, Agent, Write, Edit
---

# Fan-out plan

The task to distribute: **$ARGUMENTS**

Repo analysis (worker count, hubs, and the files no worker may edit):

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" graph . --brief --out .argo/fanout.md && node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" graph . --top 10`

## What to do with this

The analysis above is authoritative about **structure**. You are responsible for
mapping the *task* onto it.

1. **Check the verdict line first.**
   - `clean` → fan out at the recommended width.
   - `ok` → fan out, and be strict about the frozen list.
   - `hub-bound` → say so. Splitting the top hub will buy more parallelism than
     more workers will. Offer that as the better move before fanning out anyway.
   - `serialise` → cycles cross partition boundaries. **Do not fan out.** Report
     which cycles and propose breaking them first.

2. **Check the coverage line.** Below ~90%, the graph is incomplete and the plan
   is optimistic. Say so explicitly rather than presenting the plan as settled.

3. **Scope to the task.** When the write-set is known, re-run with it:
   `argo graph . --touch <paths|dirs|globs> --brief`. The plan then partitions
   only those files, lists one-hop neighbours under each worker as read-only
   context, and takes its worker count from the write-set — a file that does
   not exist yet shares nothing. When the write-set is not known, intersect the
   whole-repo partitions with the files the task needs by hand, and drop any
   worker whose slice is empty — never spawn an agent with nothing to do.

4. **If the task needs a frozen file changed**, do that edit yourself, first, in
   a serial pre-step. Then fan out. Never hand a frozen file to a worker.

5. **Dispatch.** One `Agent` call per non-empty partition, all in a single
   message so they run concurrently. Each worker brief must contain:
   - its own file list, and the instruction that it owns exactly those files
   - its `Coupling:` line, verbatim — `coupled` tells the model-routing hook this
     is judgment work and no downgrade may apply; `isolated` says nothing, and
     your task text decides
   - the FROZEN list, marked read-only, with "stop and report if you need one changed"
   - "Report only to me. Do not read another worker's output."
   - "If your change would add an import from your partition into another, report it instead of writing it."

6. **You are the supervisor.** Every worker reports to you. You aggregate. That
   correction step is the thing that keeps one worker's mistake from becoming
   four workers' mistake — do not skip it, and do not let workers reconcile
   with each other.

7. **After aggregating**, re-run `argo graph .` and confirm the shared surface
   did not grow. If it did, the fan-out added coupling and that is worth
   reporting to the user.

If the recommended worker count is 2 and the repo is small, just do the work
yourself. A crew has to earn its calls.
