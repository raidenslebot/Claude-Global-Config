# Divergence report

Repo: `C:\Claude\AI Replication`
2 agents · 4 probes · 1 repeat(s) · model `(cli default)` · gate `0.35`

## Pairwise divergence

| pair | mean | max | scored probes | gate |
| --- | --- | --- | --- | --- |
| `agent-a` ↔ `agent-b` | 0.500 | 1.000 | 4 | **BREACH** |

## Probes

### 1. Which single file in this repository is imported or required by the most other files in the same repository? Answer with the repo-relative path only.

Worst pair divergence on this probe: **0.000**. Graph's own answer: `src/drift/snapshot.js`.

- `agent-a`: src/graph/build.js
- `agent-b`: src/graph/build.js

### 2. What is the entrypoint of this repository — the file that runs first when a user invokes it? Answer with the repo-relative path only.

Worst pair divergence on this probe: **0.000**. Graph's own answer: `test/baseline.test.js`.

- `agent-a`: src/cli.js
- `agent-b`: src/cli.js

### 3. How many source files does this repository contain, excluding dependencies, build output and dot-directories? Answer with a single number.

Worst pair divergence on this probe: **1.000**. Graph's own answer: `44`.

- `agent-a`: 65
- `agent-b`: 66

### 4. Which file in this repository imports or requires the most other files from this same repository? Answer with the repo-relative path only.

Worst pair divergence on this probe: **1.000**. Graph's own answer: `test/baseline.test.js`.

- `agent-a`: test/baseline.test.js is the winner with 5 distinct repo-file imports, more than any other file…
- `agent-b`: src/graph/index.js

## Verdict

**[breach]** 1 of 1 pair(s) exceed the 0.35 gate on worst-probe divergence. Worst: agent-a <-> agent-b at 1.000 (mean 0.500). They split hardest on: "How many source files does this repository contain, excluding dependencies, build outpu...". Two of your own agents answered the same question differently — averaging across probes is what would hide it.

Fleet mean is 0.500. It is reported for completeness only: averaging across pairs is exactly what conceals a single contradicting pair.
