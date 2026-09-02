# Changelog

The version is `package.json`'s and is tagged `vX.Y.Z` on `main`. Every install follows
`main` automatically at session start (`config/hooks/session-start-update.js`), so this file
is what a machine gained between two starts. Bump the version and add the entry in the same
commit — a test holds them together.

## 1.2.0 — 2026-09-02

- **The rendered page, measured.** `tools/page-audit.mjs` renders a page at desktop and phone
  widths and answers the questions of the loop's rubric that a machine can: contrast of every
  text run on its real ground (FAIL under 4.5:1, 3:1 large), faces that fell back (FAIL), body
  measure and leading, text under 12px (FAIL under 10), a widow in a heading, a page that
  scrolls sideways on a phone (FAIL — a screenshot cannot show it), tap targets under 24px
  (FAIL) and 44px, a focus that changes nothing visible (judged with real Tab presses),
  animations still running under `prefers-reduced-motion`, images without alt, and the palette
  by area — how many saturated hues, their share, dead greys. Colours are read through a
  canvas, so `oklch()` and `color-mix()` are measured correctly.
- **See it set before choosing.** `tools/specimen.mjs` writes and renders a specimen: the
  display face at two sizes, the text face at reading size on a real measure, labels, figures
  and glyphs, the pairing on the surface and reversed, and every palette colour as a swatch
  with its contrast against the surface and the ink. Google Fonts by name, with axis specs.
- **The loop uses both.** `creative-divergence` Step 4 gates on page-audit; the moves catalogue,
  `design-fields`, the prompt hook and CLAUDE.md point at specimen before a face or palette is
  chosen. The doctor checks that all six design tools parse and names the browser they run in.
- **The example, fourth pass.** page-audit found the shipped page scrolling sideways at 390px —
  two `nowrap` cells in a ledger row — and its running head under 12px. Both fixed; the log
  says so.
- The status line in CLAUDE.md is stated as a shape; the hook supplies the numbers.

## 1.1.0 — 2026-09-02

- **The session line.** One SessionStart hook (`session-start-cgc.js`) now runs at every
  start and resume: it follows the origin's default branch (fast-forward when behind,
  re-applying config, hooks and skills), runs the doctor and **repairs** any failure by
  re-applying the install, runs the package's own tests once per commit (cached a day), and
  reports one line to the user and the session — `CGC v1.1.0 enabled · 34/34 checks ·
  206/206 tests · up to date (d971142)`. Offline is a word; a dirty checkout, another branch,
  unpushed commits or a diverged history are named and left alone.
- **This config wins.** A skill directory already present under a name this repo ships is
  moved to `<config>/.cgc-replaced/` and replaced by the link (on the authoring machine this
  found a stale copy of `visual-design-mastery` from 31 August); plugins known to shadow
  shipped skills (`open-design`) are disabled in `settings.json`. `CLAUDE_CONFIG_DIR` is
  honoured. `--only` takes several phases.
- **The slop gate.** `tools/slop-lint.mjs` finds the fingerprint of AI-made screen design —
  sixteen families: the default face, the purple gradient, the glass card, the three-card
  grid, the centred hero with two buttons, emoji icons, the acid accent on near-black, the
  blurred blob, the stock copy, … — names each with its line and what a decision would look
  like instead, and a PostToolUse hook reports it on every screen file as it is written.
- **The loop, with no pass count.** `tools/screen-render.mjs` screenshots a page at desktop
  and phone widths, or any social/slide/email/icon canvas at exact pixels, and names web
  fonts that failed to load. `creative-divergence` ends in Step 4: render, name the weakest
  thing, fix and extrapolate, gate, render again — *until it achieves, at minimum, the
  equivalent of a passionate human professional's work* — with the professional's questions
  as the exit and the passes logged in `review.md`.
- **The vocabulary.** `visual-design-mastery/references/signature-moves.md`: faces with a
  point of view and their settings, pairings, palettes that are not the defaults in OKLCH,
  layout grammars, materials, motion laws and image treatments, each with its numbers.
- **Every field.** The `design-fields` skill routes logos and identity, favicons and app
  icons, icon sets, illustration systems, diagrams and infographics, social posts and
  thumbnails, slides, email, packaging and labels, signage and wayfinding, banners and
  environments to references with the real canvas, minimums, delivery formats and slop of
  each — and gives the procedure for a field with none.
- **A worked screen example** (`creative-divergence/examples/cgc-landing/`) built through
  the loop: directions first, three logged passes, the page.

## 1.0.0 — 2026-09-01

- First release on `main`: installer, doctor, secret scanner, 17 hooks, model routing, argo,
  the print and apparel pipeline with nine garment flats and three worked examples.
