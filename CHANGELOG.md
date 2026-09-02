# Changelog

The version is `package.json`'s and is tagged `vX.Y.Z` on `main`. Every install follows
`main` automatically at session start (`config/hooks/session-start-update.js`), so this file
is what a machine gained between two starts. Bump the version and add the entry in the same
commit — a test holds them together.

## 1.6.1 — 2026-09-02

A fact-check of the five references written this session, every typeface probed against the
live Google Fonts API and every palette converted to linear sRGB: five errors and nine
overclaims, all corrected, about eighty claims confirmed.

- Errors: the signage viewing-distance arithmetic was off by two; two palette signals sat
  outside sRGB and would have rendered as colours nobody chose; Instagram's tallest feed
  image is 3:4 since 2025 (an `ig-34` preset joins `ig-post`); YouTube's thumbnail limits are
  a decade newer than stated; Fraunces' SOFT axis did nothing unless the font URL requested
  it — the specimen example and the CSS comment say so now.
- Overclaims: house conventions marked as constraints are defaults again (icon stroke at 16
  px, SVG hygiene, diagram type minimums, a stroke minimum that differs by press); the
  app-icon mask rule names the platforms and the macOS versions it does not hold for; the
  email rules distinguish classic Outlook from the new one, name Gmail, and add the 102 KB
  clip; stories accept more than 9:16; the delivery-format bundle splits its constraint from
  its default. The floor the audit holds — WCAG contrast, large-text and tap-target numbers —
  is now stated where the moves are.

## 1.6.0 — 2026-09-02

A second adversarial review, over the older tools and the installer, twelve findings reproduced
and fixed, each held by a test:

- **The installer never loses a user's file.** A hand-written `CLAUDE.md` with no marker is kept
  under `.cgc-replaced` and the shipped file now always ends with the marker, so anything
  written below it survives every update (and `sync` never copies it into the repo). A skill
  directory that cannot be moved aside is copied aside before anything is removed, and the
  message never names a copy that is not there. A dangling junction under a skill name no
  longer crashes the installer natively — it is replaced like any foreign entry. A dry run
  creates no directories. A link that fails is a FAIL, not an `ok`.
- **The doctor tells the truth on more machines.** A prompt or agent hook has no command and
  is not "empty"; an MCP server started by name (`npx`, `uvx`, a binary) is not "missing";
  `.claude.json` is read from `CLAUDE_CONFIG_DIR` when set, as Claude Code reads it (install,
  uninstall and the renderer likewise); bare quoted phrases in a plain YAML scalar are phrases,
  not bare claims. A new check holds every authored skill linked from the live config to this
  repo, which is what the session hook's repair is for.
- **The print lint sees more.** An SVG `<image>` counts as a raster; an SVG with a physical
  size but no viewBox is checked in CSS pixels instead of skipped; an image that cannot be
  read is a warning, not a pass; a `file:` URL resolves properly on POSIX; the attribute form
  of `font-size` is reported once; `--json card.html` keeps its file.
- **The renderer proofs what it prints.** The PNG proof renders under print media, as the PDF
  does; a JPEG artwork is placed at its real aspect; a named garment colour says the ink-blend
  decision was skipped; `--marks back.html` keeps its page.
- **The slop lint catches the canonical gradient** (`#667eea → #764ba2` and its kin, and
  `hsl(280deg …)`), and no longer counts ©, ®, ™, arrows and ticks as emoji.
- **uninstall removes the realized workflows** it installed and leaves any other.

## 1.5.1 — 2026-09-02

An adversarial review of the four newest tools, every finding reproduced before it was fixed,
and each fix held by a test:

- **page-audit.** The contrast ground is what is *painted* under the text — the element stack
  at a point in its first line box, composited from the bottom — not its ancestors alone; a
  hero's white text over a dark positioned block was reported as white on white. Opacity dims
  the ink. The font-fallback probe uses the page's own text, so an icon face or a CJK face
  with no Latin glyphs is judged on what it draws. A smaller inline run shares its line, so it
  is not a widow. A nav's `<li><a>` is a control; only a link inside running text is exempt.
  A CSS animation's easing is read from its keyframes — every eased entrance was "linear".
  Keyframe property names are camelCase, so `fontSize` and friends count as layout.
- **outline-text.** The viewBox starts at the ink: an italic *f* or a *J* hangs left of its
  origin and was clipped. A Google family is fetched subset to the text, so *ő* and *東* get
  their glyphs; a character the face lacks is an error naming it, never a `.notdef` box. The
  help text's pt arithmetic was wrong.
- **The session hook.** git missing from PATH is said; a detached HEAD is named; when
  `origin/HEAD` is unset the hook follows the current branch if the origin has it, then main,
  then master, instead of assuming main and blaming the user's branch. The hook's own timeouts
  sum inside the registration's.
- **All tools** run when invoked through a symlink (entry checks compare real paths); the
  specimen's swatch reader clears its canvas between colours.

## 1.5.0 — 2026-09-02

- **An icon set, worked.** `design-fields/examples/harbor-swim-club-icons/`: one drawing rule
  from the subject — the waterline through every icon, at the same height, the object above,
  below or crossed by it — on a 24 grid in `currentColor`; a sprite as the master, one file per
  icon written by `split.mjs`, a contact sheet at 24 and 48 on both grounds without labels
  first, and a size deliberately not delivered (16) with the reason. The one field in
  `design-fields` that had references and no worked piece now has one.
- The gap analysis records G2 and G3 as closed by the tests that exist; the README layout
  lists every tool.

## 1.4.0 — 2026-09-02

- **The override, reversed.** `uninstall` puts back the copy that install moved aside under
  one of this package's skill names, and removes the state directory (update stamps, the
  self-test cache, the font cache). Tested on the isolated fixture.
- **Every example gated by the suite.** A new test holds all six worked examples to their
  form: directions on disk with the swap test and a commitment, a review or spec beside the
  artwork, every screen file clean of the template, every physical file passing print-lint
  for its stated method or size, every outlined file free of live text.
- **screen-render tested**, and fixed: a preset with `--full` captured the whole page instead
  of its exact canvas. The presets, the viewport sizes, the full-page capture and the
  failed-face report are all held by tests that read the PNG header.
- **The identity example ships its generator**, so the wordmark, lockups, icon master and
  brand sheet regenerate byte-for-byte from `directions.md` and the outline tool on any clone.
- **The line, always.** CLAUDE.md now says what to do when a host never surfaces the session
  hook's output: run the installed hook and open with its line. Never invented, never omitted.
- Docs: the "built-ins only" claim states its one exception; the README lists the `deps`
  phase; troubleshooting covers outline-text.

## 1.3.0 — 2026-09-02

- **Text as paths.** `tools/outline-text.mjs` takes a local font or a Google Fonts family with
  its axis spec, applies variable axes, lays the text out with the font's own kerning and
  ligatures, and writes an SVG whose only element is one `<path>` — the outlined wordmark
  every identity reference demands and every shop asks for. Google fonts are fetched once and
  cached beside the config. The package's one runtime dependency (fontkit) lives in its own
  `package.json`; a `deps` install phase puts it in place and the session hook re-applies it.
- **The motion laws, measured.** `page-audit` records every animation from DOMContentLoaded
  and warns on linear easing on movement, layout properties animated, entrances over 1.5 s,
  one constant for every animation, and more than three that never stop.
- **An identity system, worked.** `design-fields/examples/harbor-swim-club-identity/`: the
  mark, a favicon redrawn for 16 px, the wordmark outlined, both lockups and their reversed
  forms, the system's one variable, the icon master, a one-file brand sheet, the spec sheet,
  and the passes. Its stacked lockup replaces the live text in the apparel example's tee
  mark, which now depends on no font.
- **A feed series, worked.** `design-fields/examples/night-market-social/`: one template, one
  variable, three weeks at 1080 × 1350 from the poster's DNA — with the ink that had to
  change for a screen, and why.
- The doctor checks seven design tools and the font parser.

## 1.2.1 — 2026-09-02

- The session line counts test passes against the tests that ran and names skips
  separately — `215/215 tests (1 skipped)` — instead of a `215/216` that read as a failure
  when the one skip was the no-browser case correctly not running on a machine with a browser.

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
