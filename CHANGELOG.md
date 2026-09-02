# Changelog

The version is `package.json`'s and is tagged `vX.Y.Z` on `main`. Every install follows
`main` automatically at session start (`config/hooks/session-start-update.js`), so this file
is what a machine gained between two starts. Bump the version and add the entry in the same
commit — a test holds them together.

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
