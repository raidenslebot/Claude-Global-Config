---
description: Run the same task list solo and crewed, and say whether the crew is earning its calls or quietly breaking work solo already had right
argument-hint: "--tasks FILE [--workers N] [--repeats N] [--dry-run] [--strict]"
allowed-tools: Bash, Read, Write
---

!`node "${CLAUDE_PLUGIN_ROOT}/../src/cli.js" baseline $ARGUMENTS`

## Read this for the user

Lead with the verdict line and the amplification number. The pass rates are the
evidence, not the answer, and the raw delta is the number that flatters a crew.

- **`AMPLIF` is the finding.** Of the tasks the solo agent already had right,
  how many did the crew break, against how many it rescued. A crew that fixes 2
  and breaks 5 still moves a pass count in the right direction on some lists.
  Name the specific regressed task ids from the table — a regression is a file
  the user can go look at; a rate is not.
- **`crew-subtracts` → say stop.** The recommendation is to drop back to one
  agent on this task list, not to add workers or change the prompt.
  `crew-neutral` means the crew is paying the cost multiplier for nothing, which
  is the same recommendation with a softer verb.
- **The 45% solo-success inflection is a prior, not a law.** It comes from one
  study on one model family. If the measured solo rate here is high, the crew
  was always going to struggle to add anything — say that is the likely cause
  before blaming topology. The user's own numbers override the prior; if the
  task list is unrepresentative of their real work, the verdict is too.
- **This verdict expires on model releases, not on dates.** A better model
  raises the solo baseline, and a higher solo baseline is exactly what makes a
  crew stop paying. Tell them to re-run after every model upgrade, not next
  quarter.
- **Under `--dry-run` nothing was called.** The outcomes are simulated from the
  seed. Report the shape of the comparison, never the numbers as a result.

Exit code 1 with `--strict` means the verdict is `crew-subtracts` — the CI gate
working, not a tool failure.
