---
name: standard-of-work
description: "The bar every piece of work has to clear, and the evidence required to claim it cleared. Use when about to say 'done', 'fixed', 'it works', 'all tests pass', 'this is complete', or 'ready to ship'; when deciding how much rigour a task deserves; when a result is adequate but not excellent; or when asked to 'make this perfect', 'hold the highest standard', 'go above and beyond', or 'no exceptions'. Also use when a standard keeps being stated and keeps being missed — the fix for that is a gate, not a reminder."
---

# The standard of work

## The governing law: a standard nobody checks is a preference

This is the whole skill in one line. Everything below follows from it.

A rule stated in a document is **advisory**. It is read, agreed with, and then not applied,
because nothing happens when it isn't. A rule enforced by something that **fails** is a **gate**,
and gates are obeyed by construction.

Observed, not theorised: in one session, ten advisory rules were injected on *every single
prompt* — and seven defects shipped anyway, including three separate instances of the same
platform assumption, one of them written inside the very function edited to fix its sibling. In
that same session, four gates held perfectly: a pre-commit scan that blocked a planted
credential, a syntax check on generated files, a test suite, and CI. Zero escapes.

The lesson is not "try harder." Trying harder is what produced the seven. The lesson is:

> **When a standard matters, convert it into something that fails.**

| Advisory (weak) | Gate (binds) |
|---|---|
| "Always verify before claiming done" | A check that runs and reports the failure |
| "Never commit secrets" | A pre-commit hook that refuses |
| "Keep the docs accurate" | A test asserting docs against measurement |
| "Write portable paths" | A test that fails on an absolute path |
| "Don't ship broken syntax" | `--check` on every generated file |

When you find yourself *reminding* — yourself or a reader — ask what would have to fail instead.
If a gate is cheap, build it; the reminder is the fallback, not the plan.

## The evidence ladder

Never assert what you can verify. Each claim has a minimum proof, and anything less is a guess
wearing a confident voice.

| Claim | Minimum acceptable evidence |
|---|---|
| "It works" | You ran it and read the output. Not "the code looks right." |
| "Tests pass" | You ran them **this** change, and report the count |
| "The bug is fixed" | It reproduced before, and does not now — both observed |
| "It's fast" | A measurement with units, and what it was before |
| "N things" — any count | Counted programmatically, not from memory or from prose |
| "It's installed / configured" | Queried the system, not the file you just wrote |
| "It's portable / cross-platform" | Exercised on the other platform, or logically proven for it |
| "The API works this way" | Read the current docs or source — not recalled |
| "Nothing else uses this" | Searched, with the search shown |
| "It's secure" | A specific threat named and closed, not a vibe |

**Three specific traps, each of which has shipped real defects:**

- **Trusting the write instead of the read.** Writing a config does not mean the system loaded it.
  Query the running state.
- **A guard that shares the code's assumption.** A validator written from the same premise as the
  thing it validates cannot catch that premise being wrong. Test it with input the code was never
  designed for; that is the only way the shared blind spot shows.
- **A number restated from prose.** Prose rots the moment code changes. Measure it, or pin it with
  a check that measures it for you.

## Calibrate the bar — "excellent" is not uniform

Applying maximum rigour everywhere is not high standards; it is an inability to judge. The bar is
set by **blast radius × reversibility × audience**.

| Work | Bar |
|---|---|
| Throwaway probe, one-off script | Correct output once. Delete it after. |
| Internal tool, one user | Works, fails loudly, no silent wrong answers |
| Shared code others build on | Tested, documented at the boundary, breaking changes considered |
| Anything destructive or irreversible | Dry-run first, backup, explicit confirmation, refuse on ambiguity |
| Anything a stranger installs or runs | Works on machines you will never see; assume nothing about their environment |
| Anything security- or credential-adjacent | Fail closed; an allowlist, never a denylist; assume you will be wrong somewhere |
| The thing the user will look at and remember | The bar is *distinctive*, not merely correct |

Over-engineering a probe is as much a failure of judgement as under-engineering a public API.
State which row you are in when it isn't obvious.

## Above and beyond — what it actually means

Not more output. Not more polish on what was asked. It means noticing what the request *implies*
that the person didn't say, and handling it:

- **Fix the class, not the instance.** A bug found in one place is a question about every similar
  place. Search for its siblings before declaring it fixed — the same defect written three times
  is the normal case, not the unusual one.
- **Leave the check behind.** A fix without a regression check is a fix that returns. The check is
  part of the fix, not a follow-up.
- **Fix the cause, not the symptom.** If the mechanism produced one bad output it will produce
  more. Ask what made this possible, not just what went wrong.
- **Report what you found but did not do.** A known defect left unfixed and *unmentioned* is the
  same as a hidden one.
- **Say the uncomfortable thing.** If the approach is wrong, the request rests on a false premise,
  or the work is worse than it looks — say so plainly, once, with the reason. Agreeable silence is
  a failure of the standard, not politeness.
- **Make the next person's job easier.** Record *why*, not what. The what is in the diff.

## When it is not perfect and shipping anyway

"No exceptions" cannot mean "never finish." Perfectionism that blocks delivery is its own defect,
and gold-plating is failure dressed as diligence. The standard is met when:

1. Every claim you make is backed at the level the ladder demands, **and**
2. Everything you know to be wrong is either fixed or **stated plainly**, **and**
3. The work does what was asked, at the bar its row calls for.

That is compatible with a known limitation, a deliberate shortcut, or a rough edge — as long as
it is **named**. What is never acceptable is the *unstated* gap: the failing test not mentioned,
the platform not tried, the number not checked, the "should work" presented as "works."

**An honest "this is done, with these three caveats" beats a confident "done" every time, and it
beats a fourth polish pass nobody asked for.**

## Slop to recoil from

- **"Should work."** Either it does and you saw it, or you have not finished.
- **Declaring completion in the same breath as the last edit** — with no run, no test, no read.
- **Reporting a partial run as a full one** — "tests pass" after running one file.
- **Softening a real failure** into "mostly working" or "just a minor issue".
- **Fixing only the reported instance** when the same mistake is three lines away.
- **Adding a reminder where a gate belongs.** If it mattered enough to write down twice, it
  matters enough to enforce.
- **Polishing what was already adequate** while something known-broken sits untouched.
- **Burying a caveat at the end of a long report** where it will not be read. Lead with the thing
  that would change the reader's decision.

## How this composes

This skill governs *whether the work is finished*. It does not judge domain quality — pair it
with whatever owns that: the design/taste layer for visual work, the language's own conventions
for code, controlled-language guidance for text a machine must parse.

Where a project already defines checks, **those are the gate**: run them, report them honestly,
and do not claim completion around them.
