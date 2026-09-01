---
description: Snapshot or diff the agent tooling you depend on, to catch behaviour changing under you between versions
argument-hint: "snapshot | diff [A] [B] | list"
allowed-tools: Bash, Read, Write
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" drift $ARGUMENTS`

## Read this for the user

Your agent's behaviour can change without you changing anything: a line shipped
into a system prompt, a default flipped, a tool gated by model. There is no
setting to inspect and session logs never record a system prompt, so your own
logs will say nothing happened.

- **Policy-shaped additions are the signal.** Strings containing "do not",
  "never", "unless the user", "only when" are the ones that silently change
  whether something fires. Lead with those; ignore churn in identifiers.
- **Correlate with behaviour.** If the user reported that runs got slower or
  that delegation stopped firing, a new policy string between the two snapshots
  is a candidate cause — but say "candidate", and propose the confirming test:
  run one task on two models and count the child tasks that start.
- **Snapshot before every upgrade.** A diff needs a before.

Exit code 1 from `diff` means policy-shaped strings were added.
