---
description: Run the whole chain over this repo and return one prioritised verdict — graph, topology, drift, baseline, divergence
argument-hint: "[path] [--fix] [--json]"
allowed-tools: Bash, Read, Glob, Grep
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" doctor $ARGUMENTS`

## Read this for the user

Six tools that each measure one thing are six tools nobody runs. This is the one
that runs the chain and gives a single answer.

- **Never measured is the headline finding, not a footnote.** Every check
  reports either a measurement with the date it was taken, or nothing at all.
  Say which checks have never been run before you discuss the ones that failed —
  a repo with five unmeasured checks is not a healthy repo, it is an unexamined
  one, and the exit code says so.
- **A dry-run artifact is not a measurement.** `baseline.dry-run-only` and
  `diverge.dry-run-only` mean synthetic numbers are the only numbers on disk.
  Never quote them back as results.
- **Dates are load-bearing.** A baseline taken before the currently installed
  build is stale: a better model raises the solo score, and the solo score is
  exactly what makes a crew stop paying. Read `baseline.stale` as "re-run this
  before you defend the crew", not as a minor warning.
- **`diverge.breach` outranks everything measured.** Two of your own agents
  contradicting each other is the failure a fleet mean hides. Name the pair.
- **Lead with the verdict line, then the top two findings, then the fix list.**
  Do not read the whole report aloud.

`--fix` prints the ordered command sequence that closes every open finding. It
executes nothing — offer to run the commands, do not assume.

Exit code 1 means at least one error-severity finding, 2 means a bad path.
