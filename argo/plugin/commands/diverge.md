---
description: Ask several of your agents the same questions and measure how far apart their answers land, pair by pair
argument-hint: "[--threshold 0.35] [--repeats N] [--dry-run]"
allowed-tools: Bash, Read, Write
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" diverge $ARGUMENTS`

## Read this for the user

The unit is the **pair**, not the fleet. A fleet average is the number that
hides the problem: two agents giving contradictory answers average out to
something that looks healthy.

- **Name the worst pair and the worst question.** That specific disagreement is
  the actionable output — it usually points at a genuine ambiguity in the
  codebase or in the agents' shared context, not at model quality.
- **A flagged consensus trap is not good news.** Unanimous agreement is also
  what it looks like when every agent copied the same wrong thing. If the
  answer they agree on is wrong, the problem is replication, and a better model
  will not fix replication.
- **If a pair breached the gate**, the fix is upstream of the models: give the
  disagreeing agents the same grounded context, or remove the edge that lets
  one contaminate the other.

Exit code 1 means a pair breached the threshold — that is the CI gate working,
not a tool failure.
