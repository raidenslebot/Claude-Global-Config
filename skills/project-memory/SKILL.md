---
name: project-memory
description: "File-backed project state that survives compaction and time away — decisions with their reasoning, open questions, a task backlog, and durable project facts, stored as markdown under <project>/.claude/memory/. Use when the user says \"catch me up on this project\", \"pick up where we left off\", \"what did we decide about\", \"why did we build it this way\", \"we already tried that\", \"record this decision\", \"log why we rejected\", \"add this to the backlog\", \"what's still open on this\", \"remember this for next session\", or \"read the project memory\" — and when starting work on a repo that already has a .claude/memory/ directory. Also covers reconciling memory against code when they disagree. No external service, no account, git-friendly plain text."
---

# Project memory

A project's real state lives in three places: the code (what is true now), git history (how it
got here), and **the reasoning that produced both** — which is normally nowhere. That third
thing is what evaporates at compaction and what nobody reconstructs a week later. This is a
plain-text store for it.

Four concerns, no more:

| Concern | Answers | Lives in |
|---|---|---|
| **Decisions** | Why is it this way, and what did we reject? | `decisions/NNNN-slug.md`, one per decision |
| **Questions** | What don't we know yet, and who/what would answer it? | `questions.md` |
| **Backlog** | What is left, what is in flight, what is blocked? | `backlog.md` |
| **Facts** | Durable, non-obvious truths about this project. | `facts.md` |

Everything else — session diaries, progress logs, restatements of the README — is the failure
mode, not the feature. See [Slop](#slop-to-recoil-from).

## Layout

```
<project>/.claude/memory/
  INDEX.md            generated; the only file read at session start
  decisions/
    0001-postgres-advisory-locks-for-job-claiming.md
    0002-drop-the-redis-queue.md
  questions.md
  backlog.md
  facts.md
  build-index.mjs     copied once from references/; regenerates INDEX.md
```

**Why decisions get a file each and the other three don't.** A decision is cited by id, is
mostly append-only, and carries prose — separate files keep git diffs clean and let a decision
be read without loading everything else. Questions and backlog items churn constantly and are
one line each; forty files for forty checkboxes means forty writes per session and an index that
is longer than the data. Facts are read as a set. This split is a considered default, not a
convention to preserve if your project genuinely inverts it.

**Commit it.** `.claude/memory/` belongs in the repo, not in `.gitignore`. It is worth as much
to the next human as to the next session, and git gives you the audit trail for free.

## Reading — the part that makes it work

At session start, after a compaction, or when picking up a project after time away:

1. **Read `INDEX.md`. Only that.** It is the routing table: open questions, in-flight backlog,
   and one line per decision. If it does not fit in one comfortable read, it has failed and
   needs pruning — that is the real size constraint on this whole system.
2. **Read individual files on demand.** A decision file gets opened when its one-line summary in
   the index is relevant to what you are about to touch. Do not preload `decisions/`.
3. **Before changing anything a decision covers, read that decision.** The `verify:` field
   points at the code; check the two still agree ([reconciling](#when-memory-and-code-disagree)).

The discipline is: index is cheap and always read; everything else is expensive and read on
demand. Invert that and the store becomes a context tax instead of a context saver.

## Frontmatter schemas

### `decisions/NNNN-slug.md`

```yaml
---
id: D0007                      # D + zero-padded, matches the filename number
title: Postgres advisory locks for job claiming
date: 2026-08-14               # ISO, the date it was decided
status: accepted               # proposed | accepted | superseded | reversed
supersedes: D0003              # optional; the id this replaces
superseded_by: D0011           # optional; set when status becomes superseded
verify: src/jobs/claim.ts      # optional but do it — where this shows up in code
tags: [db, concurrency]        # optional; 1-3, used for grep
---
```

Body — four headings, short:

```markdown
## Context
What forced a choice. One or two sentences.

## Decision
What we do now. Imperative, present tense.

## Rejected
- **Redis SETNX** — adds a second datastore for one lock; ops burden outweighed the perf win.
- **SELECT ... FOR UPDATE SKIP LOCKED** — works, but holds a transaction open for the whole
  job, and jobs run minutes.

## Consequences
What this costs us, and what would make us revisit it.
```

**`## Rejected` is the payload.** A decision without rejected alternatives is not a decision, it
is a fact — put it in `facts.md` instead. The whole point of this file is that six weeks from
now someone proposes Redis again and the answer is one grep away.

### `questions.md`

```yaml
---
kind: questions
updated: 2026-08-30
---
```

```markdown
- [ ] `Q004` Does the billing webhook ever fire twice for one invoice? — blocks `B012`;
      answerable from the Stripe dashboard event log
- [ ] `Q005` Is the 30s worker timeout a real constraint or a copied default? — ask the user
- [x] `Q003` Can two workers claim the same job? — yes, under load; became `D0007`
```

A question carries **what would answer it**. "Not sure about caching" is not a question, it is
a mood. Answered questions get checked off with their resolution and, if the answer changed
behaviour, promoted to a decision or a fact.

### `backlog.md`

```yaml
---
kind: backlog
updated: 2026-08-30
---
```

```markdown
- [ ] `B012` Wire the retry budget into the worker — `src/worker/retry.ts` (blocked: `Q004`)
- [ ] `B013` Backfill `claimed_at` for rows written before `D0007` — `migrations/`
- [x] `B011` Move the claim query behind an advisory lock — `src/jobs/claim.ts` (`D0007`)
```

One line each: id, what, where, and any blocker or decision reference in parens. Checkbox is the
status. `(blocked: ...)` is the only extra state worth tracking — "in progress" is what the
current session is doing and belongs in TodoWrite, not here.

### `facts.md`

```yaml
---
kind: facts
updated: 2026-08-30
---
```

```markdown
## Deploy
- Staging redeploys on every push to `main`; production is a manual tag. `verify: .github/workflows/`
- The prod database has no read replica. Anything that scans a big table blocks writes.

## Gotchas
- `tests/e2e` needs Docker running; it fails with a misleading DNS error if it isn't.
- Timestamps in `events` are UTC but the legacy `audit_log` table is local time. `verify: db/schema.sql`
```

A fact earns its place by being **durable and non-obvious**. If a fresh reader would learn it in
thirty seconds from the code, it does not go here.

## When to write

Write when one of these just happened, and write it *immediately* — the reasoning is gone by
the end of the session:

- **A choice was made between real alternatives**, and the losing option is plausible enough
  that someone will propose it again → a decision.
- **Something was tried and failed for a non-obvious reason** → a decision with
  `status: rejected` in the Rejected section, or a fact. This is the highest-value entry in the
  whole store and the most commonly skipped.
- **A question came up that blocks work and cannot be answered right now** → a question.
- **Work was identified but deliberately not done** → a backlog item. "Deliberately" is
  load-bearing; it separates a backlog from a wishlist.
- **A trap was discovered** — the thing that cost an hour and leaves no trace in the code → a
  fact under Gotchas.

## When NOT to write

This is where memory systems die. Each of these is a real, common failure:

- **Anything git already records.** "Renamed `getUser` to `fetchUser`", "added the retry test",
  "bumped the dep". `git log` is the changelog and it cannot go stale. A memory file that
  duplicates it is a second source of truth that will eventually be the wrong one.
- **Anything the code states plainly.** The list of routes, a config value, a function
  signature, the directory layout. It will drift within a week and then it lies. Record *why*
  the value is 30 seconds, never *that* it is 30 seconds.
- **The current session's task list.** TodoWrite is for the next twenty minutes; this store is
  for the next twenty sessions. A step that will not outlive the session does not belong here.
- **A "decision" with no rejected alternative.** "We use TypeScript" was never a decision on
  this project. That is a fact, if it is anything.
- **Anything reversible in five minutes.** A variable name, a log level, a CSS value.
- **Code.** Never paste a snippet into memory — it desynchronises instantly. Point at it with a
  path and let the file be the truth.
- **A summary of what you did this session.** Nobody reads it, it grows without bound, and it
  buries the four things that matter. If the work mattered, it is a decision, a fact, or a
  commit.

The test: *would a competent reader, six weeks from now, waste real time without this line?*
No → don't write it. The store is only useful while it is small enough to read.

## When memory and code disagree

**The code wins. Always.** It is what runs. But *how* you correct the memory depends on which
of two very different things happened, and getting this wrong is worse than not checking.

1. **Find out whether the divergence was deliberate.** `git log -p --follow <the verify: path>`
   and read the commit that moved it. This takes one command and decides everything.
2. **Deliberate change → the memory is stale.** Amend it:
   - A decision that was genuinely undone: set `status: reversed`, add `reversed: <date>` and
     one line in Consequences saying what replaced it and why. **Do not delete it.** A deleted
     decision loses the record that the approach was tried — and re-litigating it is precisely
     what this store exists to prevent. If a new decision replaced it, write that decision, set
     `superseded_by`, and link both ways.
   - A stale fact: correct the text, update `verify:`, bump `updated:`.
3. **Accidental drift → the code is wrong, the memory is right.** A refactor quietly removed the
   advisory lock nobody remembered was load-bearing. Do **not** rewrite the decision to match.
   File a backlog item citing the decision id, tell the user, and leave the decision standing.
4. **Can't tell?** Say so, leave both, and add a question. A memory file with an honest
   "unverified since 2026-08-14" is more useful than a confidently wrong one.

Correct memory as a side effect of finding the divergence, in the same session. A noted-and-
deferred correction never happens.

## Regenerating `INDEX.md`

`INDEX.md` is generated and must never be hand-edited — a hand-edited index drifts from the
files and then silently misroutes every future session. Copy
[`references/build-index.mjs`](references/build-index.mjs) into `.claude/memory/` on first use
and run it after any write:

```
node .claude/memory/build-index.mjs
```

No dependencies, node ≥18. It reads the frontmatter of every `decisions/*.md` plus the unchecked
lines of `questions.md` and `backlog.md`, and writes the routing table. Full file templates and
a worked `INDEX.md` are in [`references/templates.md`](references/templates.md).

## Setting it up in a project

First time in a repo: create `.claude/memory/`, copy `build-index.mjs`, create `questions.md`,
`backlog.md`, `facts.md` with their frontmatter, and run the script. Do not seed it with
invented content — an empty store that grows from real work beats a pre-populated one that
nobody trusts.

Do not create the directory speculatively. It earns existence the first time there is a real
decision to record.

## Slop to recoil from

- **The session diary.** `2026-08-30-session-notes.md`, "Today I refactored the worker…".
  Write-only memory. Nobody has ever read one.
- **Restating the README** in `facts.md`, or the architecture doc, or the dependency list.
- **Decisions with no `## Rejected`.** Prose that describes what the code does, dressed as
  wisdom. If you cannot name a rejected option, you are writing a fact.
- **Forty open questions, none closed.** A question open three months is either answered by the
  code already, or dead. Close it or delete it; an unclosable question list trains everyone to
  skip the file.
- **The Jira instinct in markdown** — `priority: P2`, `effort: 3`, `assignee:`, `epic:`,
  `sprint:`. You removed the tracker. Do not rebuild its ceremony in YAML. Fields nobody reads
  cost a write every time and pay nothing.
- **Writing memory instead of doing the work.** Ten minutes of beautifully structured notes on a
  change that took two minutes. The store is a byproduct, never the deliverable.
- **A hand-edited `INDEX.md`** that no longer matches `decisions/`.
- **Pasting code, logs, or stack traces** into a fact. Path plus one line, or nothing.
- **Recording decisions nobody will contest.** "Chose `.md` for the memory files." Nobody was
  ever going to argue.
- **Letting it grow past one comfortable read of the index.** At that point the store costs more
  context than it saves and every session pays. Prune: close questions, delete done backlog
  items older than a release, merge facts that turned out to be the same fact.
