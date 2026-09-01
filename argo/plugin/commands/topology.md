---
description: Declare, lint and render your agent graph — which agents exist and which may talk to which
argument-hint: "init | lint [FILE] | render [--format mermaid|dot]"
allowed-tools: Bash, Read, Write, Edit
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" topology $ARGUMENTS`

## Read this for the user

The graph is an artifact, not a vibe. If it is not written down, nobody can say
which edges exist — and the edges that cause damage are the accidental ones.

Lint findings worth leading with:

- **A peer edge** (worker reading worker) is the highest-value finding. It turns
  one wrong step into four. It needs an explicit written justification or it
  should be deleted.
- **An unsupervised fan-out** has no correction step. Errors aggregate instead
  of being caught.
- **Shared state with more than one writer** is how a whole fleet copies one
  mistake. Put the verification on the write.
- **Fan-out wider than the repo's shared surface supports** means workers will
  collide on frozen files. Cross-check with `/argo:graph`.

Exit code 1 means an error-severity rule fired.
