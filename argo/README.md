# Argonaut

**Graph Engineering for Claude Code.** Decide which agents may talk to which,
measure the shared surface before you fan out, and catch it when the agent
changes under you.

```
prompt engineering   what one agent is told
context engineering  what one agent can see
graph engineering    which agents may talk to which   <- this toolkit
```

Every edge you draw between two agents is a channel a mistake can travel down.
Most fleets have never written their graph down, so nobody can say which edges
exist — and the edges that cause damage are the accidental ones.

Zero runtime dependencies. Node 20+. Works offline except where it deliberately
calls your Claude CLI.

---

## The one-minute version

```bash
node src/cli.js graph .          # how wide can this repo actually fan out?
```

You get: the hub files everything names, the **shared surface** (what no worker
may edit), a worker-count recommendation based on *effective* speedup, and a
verdict. Then:

```bash
node src/cli.js graph . --brief --out .argo/fanout.md
```

That brief is the artifact you hand a fleet. It assigns files to workers, lists
the frozen set, and states the containment rules.

---

## Commands

| command | what it answers |
|---|---|
| `argo graph` | How wide can this repo fan out, and which files must be frozen? |
| `argo baseline` | Is the crew beating a single agent, or subtracting? |
| `argo diverge` | Do two of my agents answer the same question the same way? |
| `argo drift` | Did the vendor change my agent between versions — including the parts that never touch disk? |
| `argo topology` | Which agents may talk to which — declared, linted, rendered. |
| `argo watch` | What changed in the sources that shape your fleet — and, with `--caveats`, whether a document's version rows have rotted against npm. |

Run `argo <command> --help` for options.

### `argo graph` — the flagship

Counts how many other files **name** each path. Not what a compiler resolves —
a name is coupling whether or not the type-checker agrees, and one pass over
the tree produces it for any language without a toolchain per language.

Then it partitions (Louvain communities → balanced k-way bins), and finds the
**shared surface**: files named from more than one partition. That set is what
every worker has to read and therefore what no worker may freely edit. Its size,
not the repo's size, is what caps useful fan-out width.

Two things it does that naive versions don't:

- **Effective speedup, not idealised.** A fan-out finishes when the *slowest*
  worker finishes, so the parallel phase costs the largest partition's share of
  the work — not 1/k of it. Idealised Amdahl silently rewards a cut that parks
  one worker on four files. This doesn't.
- **Coverage reporting.** If the resolver misses intra-repo references, the
  graph is incomplete and the plan is optimistic. It says so. On a real 242-file
  repo, fixing resolution took coverage from 13.5% → 98.8% and flipped the
  verdict from "fans out cleanly" to "hub-bound" — the first answer was wrong
  and looked fine.
- **Task scope.** `--touch <paths|dirs|globs>` plans a task's write-set instead
  of the repo: workers own only those files, one-hop neighbours are listed as
  read-only context under each worker, a hop named from two workers' files is
  frozen, and a file that does not exist yet contributes nothing to the shared
  surface. Each
  worker section carries a `Coupling:` line the model-routing hook reads —
  `coupled` blocks a downgrade, `isolated` leaves the model to the task text.

---

## Claude Code plugin

`plugin/` installs as a Claude Code plugin: a skill that fires when you're about
to parallelise, one slash command per tool, two subagent definitions, and two
conditional hooks. `.claude-plugin/marketplace.json` at the repo root makes it
installable as a marketplace rather than by hand-made symlink.

| | |
|---|---|
| **skill** `graph-engineering` | Loads when a prompt is about fan-out, subagents, worker counts, or a fleet misbehaving. Carries the laws and their citations. |
| **12 vendored skills** | `agent-watchdog`, `efficient-frontier`, `efficient-fable`, `stay-within-limits`, `plan-arbiter`, `plow-ahead`, `quick-recap`, `read-the-damn-docs`, `rewind`, `visual-plan`, `visual-recap`, `visual-edit`. Copied in full, not linked — see [`plugin/skills/NOTICE.md`](plugin/skills/NOTICE.md). The first four are cross-referenced from `graph-engineering`, which hands off to them. |
| **`/argo:fanout`** | Runs the analysis and briefs the workers. The flagship. |
| **`/argo:graph`**, `/argo:diverge`, `/argo:drift`, `/argo:topology` | One per tool, with guidance on how to read the output. |
| **`/argo:baseline`** | The control. Leads with the verdict and the error amplification — how many tasks solo already had right the crew broke — not the pass rate. |
| **`/argo:watch`** | The radar. Leads with anything that means your own tooling moved, because that is the cue to `argo drift snapshot` *before* installing. |
| **agent** `graph-worker` | A partition worker, pre-briefed with the containment rules. |
| **agent** `hub-splitter` | Splits a hub into the halves its readers actually use. |
| **`/argo:selfprobe`** | Asks the running agent to report what is gating its own delegation, and stores it dated and diffable. |
| **hook** `user-prompt-graph.js` | `UserPromptSubmit`. Fires *only* on fan-out or fleet-trouble intent. A hook that fires on every prompt is noise, and noise gets ignored. |
| **hook** `session-start-graph.js` | `SessionStart`. Silent unless this repo has state worth stating: a stale fan-out plan and its frozen count, a topology that no longer lints, or delegation gates that moved since the stored self-report. |

### `argo drift` — three doors, one open

An instruction can govern your agents while being invisible to every tool you
own. The delegation gate in current Claude Code is exactly that shape. Finding
it took closing two approaches before one worked:

1. **Scan the bundle** — read 241 MB, harvested 10,299 prose strings on this
   machine. The gate was in none of them: the service attaches it at request
   time. *Closed.*
2. **Capture it off the wire** — `ANTHROPIC_BASE_URL` to a loopback proxy. The
   proxy works, but a custom base URL invalidates Max OAuth (`Not logged in`).
   *Closed for subscriptions, fine for API keys —* `argo drift probe` *ships it.*
3. **Ask the agent** — the system prompt is in the context of every running
   session. *Open, and needs nothing.* `/argo:selfprobe`.

Run against a live session, door 3 returns the gate verbatim, scored, with the
caveat that a first-person report is evidence rather than a byte capture.

Install with `/plugin marketplace add <path to this directory>` then
`/plugin install argonaut@argonaut-local`. The commands shell out to
`${CLAUDE_PLUGIN_ROOT}/../src/cli.js`, so the plugin has to stay next to this
checkout. (`tools/install.mjs` in the parent repo does both steps.)

---

## Documentation

- **[`docs/claim-ledger.md`](docs/claim-ledger.md)** — every load-bearing claim
  in the source material checked against primary sources. Read this before
  quoting any number from anyone, including this repo.
- **[`docs/playbook.md`](docs/playbook.md)** — how to actually run fleets in
  Claude Code, including the `heron_brook` delegation suppression.

---

## The honest caveat

The strongest study in this area (Kim, Gu, Park et al., *Capable language
models can outgrow the benefits of collaboration*, Nature Machine Intelligence
8:1157–1172, 2026) concludes that **as models improve, coordination design
matters less**. Single-agent baseline performance is the most robust predictor
of whether coordination helps at all; past roughly 45% solo accuracy, extra
agents tend to produce negative returns.

So the first thing this toolkit tells you to do is check whether you need it:

```bash
argo baseline --tasks tasks.json
```

If a single agent already clears your task list, that is the answer. A crew is
a bet on your own diagram, and the control that settles the bet is one agent
doing the same work. Keep it alive.
