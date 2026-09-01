---
description: Report what changed in the sources that affect your fleet — agent tooling releases first, research second
argument-hint: "[--init] [--all] [--keywords A,B] [--limit N] [--min-score N]"
allowed-tools: Bash, Read, Write
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" watch $ARGUMENTS`

## Read this for the user

Lead with anything sourced `npm:` or `github:`. **That means the user's own
tooling moved**, and it is the one item here with a deadline attached: the
before-snapshot has to be taken while the old version is still installed.

- **Tooling moved → say this before anything else:** run `argo drift snapshot`
  *now*, install, then `argo drift diff`. Once the upgrade lands, the before is
  gone and a behaviour change has nothing to be measured against. The tool
  prints this itself when it fires — do not bury it under the papers.
- **Papers are the slow lane.** Summarise them in one line each and only flag
  one as worth reading if it would change a decision the user has already made
  (worker count, supervisor placement, whether to run a crew at all).
- **Nothing new is a real answer.** Say so and stop; do not pad. `--all`
  ignores stored state if they want to see the whole fetch.
- **Fetch failures are not empty results.** If a source errored, the radar is
  partially blind and "nothing new" is not trustworthy for that source. Name it.

Score is keyword relevance, not importance. A high-scoring paper about a fleet
shape the user does not run matters less than a one-line release note for the
CLI they are about to upgrade.
