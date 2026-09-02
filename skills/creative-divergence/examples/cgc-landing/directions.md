# Directions — a landing page for this configuration

Written before the first line of markup, as the protocol requires. The subject is this
repository; the DNA is mined from its real artifacts, not from a gallery of developer-tool
landing pages.

## DNA

| Ask | Answer, from the artifacts |
|---|---|
| **Materials** | Plain text: `doctor.mjs` output (`ok` / `warn` / `FAIL`, a summary line `34 ok · 0 warnings · 0 failed`), `hooks.json`, `settings.json`, a git log. Nothing in this project is a picture. Its material is the *report*. |
| **Motifs** | The two-column report row: a name, a rule of dots or spaces, a verdict at the right edge. The `{{TOKEN}}` in braces. The one-line status: `CGC v1.1.0 enabled · 34/34 checks · 206/206 tests · up to date (d971142)`. The interpunct `·` as the separator everywhere. |
| **Palette from source** | The terminal's green `ok`, yellow `warn`, red `FAIL`; the only *chosen* colour in the whole repo is argo's `#b45252` for a FROZEN file. Everything else is ink on a light ground. |
| **Tempo** | A check runs in 221 ms and then nothing happens for an hour. Sudden, then still. |
| **Vernacular** | *gate*, *advisory*, *report, never veto*, *drift*, *the centroid*, *the swap test*, *ff-only*, *repaired*, *"a standard nobody checks is a preference"* — the sentence the whole repo is built on. |
| **Rules of its world** | A hook reports and never vetoes. Every claim is a number a test holds. Nothing is hard-coded; every path is a token. The repo is the source of truth and the machine follows it. |

## Directions

1. **The audit ledger.** *Cross-domain grammar* (a printed audit, a ledger) with an
   *antagonistic pairing* (a machine's report typeset like an editorial page). The thesis
   sentence at display size in a light italic serif, with its last word **copy-edited** — a
   strike through *preference* and *gate* written in above it in red, a proof-reader's mark.
   Below, the real checks as a ledger: name, dotted leader, value, `ok`. The status line runs
   along the foot of the page like a running footer. — *Swap test:* put another config tool's
   name in it: the thesis is this repo's, the rows are this repo's real checks, the correction
   mark is this repo's argument. **It stops working. Passes.**
2. **The status line as the page.** *Extreme parameter.* The whole page is the one line the
   session hook prints, at 6 vw in mono; each segment opens on hover to what it verified.
   Nothing else. — *Swap test:* every tool with a status line could ship this form; the
   content is specific, the form is not. **Weaker. Discarded** — but the line itself is worth
   grafting into 1 as the footer.
3. **The diff.** *Cross-domain grammar* (a unified diff): `−` lines are what the centroid
   does, `+` lines are what this config does — the page as a patch against Claude's defaults.
   — *Swap test:* works for any "config that changes defaults". **Fails.** And a diff on a
   dark ground is the developer-tool card the print skill lists as slop.
4. **The session as a timeline.** *Temporal signature.* Nineteen hooks along a session's life,
   start → prompt → tool → stop, one horizontal band, scrolled through. — *Swap test:* any
   hook framework. **Fails.**

## Committed

**Direction 1, the audit ledger**, with one graft from 2: the status line as the running foot.

- **Faces:** Fraunces, italic, `wght 300`, `opsz 144`, for the sentence and the one paragraph;
  JetBrains Mono for every value, label and the ledger. Two faces; nothing else.
- **Palette:** ink on paper — surface `oklch(0.97 0.012 80)`, ink `oklch(0.22 0.02 60)`, the
  signal `oklch(0.55 0.17 25)` used **once**: the correction. The `ok` words are ink, not
  green; the report is being *read*, not run.
- **Layout:** the editorial split, 8/4 — the ledger in the wide column, margin notes in the
  narrow one, hung on the same baselines. One column on the phone. Left edge everywhere;
  nothing centred.
- **Material:** paper grain (feTurbulence 2.4, alpha 0.06) over the whole page; hairlines
  at 0.5 px; the strike-through as a drawn stroke, not `text-decoration`.
- **Motion:** one law — the correction is *made*: the strike draws on, then *gate* appears,
  once, on load, 900 ms ease-out. Then stillness. Reduced motion: it is simply there.
- **The rotated element:** the marginal *gate*, at −4°. The only one.
- **Copy:** the repo's own sentences. Nothing about "seamless".

One sentence: *an audit report typeset as a printed ledger, with the thesis copy-edited in red.*
