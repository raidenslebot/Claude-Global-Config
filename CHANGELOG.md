# Changelog

The version is `package.json`'s and is tagged `vX.Y.Z` on `main`. Every install follows
`main` automatically at session start (`config/hooks/session-start-update.js`), so this file
is what a machine gained between two starts. Bump the version and add the entry in the same
commit — a test holds them together.

## 1.13.0 — 2026-09-02

Proving the vocabularies work, and letting them speak outside the browser.

- **Five dead patterns, found by writing code that would actually trigger them.** Every
  medium now ships a realistic fixture, and a test requires each one to trigger every
  technique that medium claims. Writing them exposed: a terminal detector whose first
  alternative matched any `[`, so every file on earth was a TUI; two escape-sequence patterns
  that only matched when the sequence was written as one literal string, which real code never
  does; a fluid-type rule that missed `clamp()` on a token and caught it only on `font-size`, so
  the better practice went undetected; and a layered-shadow rule that counted the commas inside
  `rgba()`, so one shadow read as four. A vocabulary nobody can trigger is worse than none: it
  reports the piece as empty and the author believes it.

- **The write-time report was web-only.** A shader, a Unity script, a SwiftUI view, a Godot
  scene, an SVG or a terminal UI got no word at all when it was written, which is most of what
  this package claims to cover. The ambition half now runs on all of them and judges each in
  its own medium — a fragment shader is never handed advice about container queries. The
  fingerprint half stays web-only, because its tells are web tells, and a file in no recognised
  medium is left alone rather than lectured.

- **The motion hook called a scroll-driven animation linear.** It is meant to be: the easing
  comes from the scroll position, and a curve on top of that double-eases it. Same for anything
  that spins forever. Both are now exceptions, with a test that a plain timed animation with
  the same keyword is still reported.

- Overlap detection learned the negative-inset idiom, and a word-boundary bug meant the `%` unit
  — the one a bleed is usually written in — could never match.
## 1.12.0 — 2026-09-02

Using the new gates on real work, which is the only way to find out whether they are any good.

- **A worked motion example, and what it caught.** `harbor-swim-club-tide` is the first piece
  in the shipped family that moves: a harbour staff gauge with the sea covering its painted
  marks and the height reading riding the waterline. Building it found three real defects that
  no check reading the source could see, and two of them were in the capture tool:
  a registered custom property whose keyframe contains `var()` does not interpolate, it jumps;
  a custom property is substituted where it is DECLARED, so animating it on a child cannot move
  a value composed on the parent; and `motion-render` decided "did anything move" from the MEAN
  change over the frame, so a waterline inside one column of a wide page read as dead. It now
  asks for the largest change anywhere and samples at 320px rather than 160px.

- **Two new gates on the examples themselves.** An example that animates must have been watched
  and must record the measured result, and must collapse under `prefers-reduced-motion`. The
  first gate immediately caught `cgc-landing`, which had shipped with two animations nobody had
  ever seen in motion: half a second of frozen page, then two beats queueing politely behind
  one another. Retimed so they overlap, and recorded.

- **The technique catalogue stopped being counted, and learned the other way to break a box.**
  Three shipped files claimed "44 real capabilities" — true of one medium on the day it was
  written, wrong the moment there were ten, and wrong by construction for anyone who extends
  the registry from their own JSON. A test now refuses any counted claim in shipped prose and
  requires every medium to be named by the docs that route to it. Separately, overlap was only
  detected as two children sharing a grid cell; an absolutely positioned child with a negative
  inset is the same move and now counts, while `left: -9999px` still does not.
## 1.11.0 — 2026-09-02

The ambition half of the design gate, and the update that was not running every time.

- **Every session start and every resume now checks for an update, without exception.** There
  was a five-minute fetch throttle, so sessions started in quick succession reported whatever
  version happened to be checked out — and a stale version line looks exactly like a healthy
  one. Worse, the hook refused to update whenever the clone had ANY local edit, which is
  stricter than git itself: a fast-forward only fails when the incoming commits touch a file
  that was modified locally, and git refuses that safely on its own. One unrelated edit in the
  clone therefore pinned it to an old version session after session. Both are gone: it asks git
  instead of pre-judging, and when a fast-forward genuinely cannot apply it says so loudly and
  names the version it is stuck below. A test now drives startup, resume, clear and compact with
  a release landing between each, and requires every one of them to arrive.

- **New gate `cgc techniques` — what a piece never tried.** The slop lint names what a design
  should not have; nothing named what it does not have. A page can be free of every fingerprint
  and still be built entirely from flexbox, a hex colour and a 300 ms transition. It measures on
  two axes: the MEDIUM, detected from the file (web, SVG, canvas, shader, 3D, native, game, TUI,
  data-viz, print), each with its own vocabulary so a shader is not judged for having no CSS;
  and the DIMENSION — material, structure, type, time, depth, response, generative, variation —
  reported as a question about the piece rather than a feature to add. The registry is data and
  extends from `<project>/.cgc/techniques.json` or `~/.claude/techniques.json` without
  touching the tool. New reference `advanced-techniques.md` carries the web recipes with real
  parameters; `post-tool-slop.js` now reports both halves on every substantial screen file.

- **The visual routing hook was silent on the field the work is worst at.** "make this
  transition feel better", "the buttons feel sluggish", "the loading spinner needs work" and
  "the modal should fade in" all fired nothing, so the taste layer never loaded for motion work
  at all. Motion vocabulary and the words people actually use to complain about motion now
  trigger it, and a motion prompt is routed to `cgc motion` and the craft reference. "feel free
  to refactor" and "the database transition state machine" stay silent, and are tests.

- Fixed: a single `rgba()` shadow was read as a four-layer stack because the commas inside the
  colour function were counted as layers.
## 1.10.0 — 2026-09-02

Two defects, both of the same kind: a standard that could not be checked where it mattered.

- **Every gate this package ships was unrunnable outside this repository.** The skills and
  mandates named their commands as repo-relative paths — `node tools/slop-lint.mjs page.html` —
  and that resolves only when the working directory happens to be this clone. In any other
  project it throws `MODULE_NOT_FOUND`, so the lint, the audit, the renders and the print
  checks never ran, and nothing was gated. Which is exactly what a user reported: the design
  work was fine here and slop everywhere else. There is now one global command, `cgc`, linked
  onto PATH by the install (`npm link`, under the `deps` phase); 87 invocations across 46
  shipped files were rewritten to use it; the doctor fails if it is not resolvable; and a test
  refuses any shipped file that names a path relative to this repo.

- **Nothing in the package had ever watched an animation.** Motion was reviewed by reading the
  easing keyword out of the CSS, which cannot see the defect that matters most — that it never
  ran. New tool `cgc motion`: it replaces `performance.now`, `Date.now` and
  `requestAnimationFrame` before the page's scripts run and scrubs declarative animations by
  `currentTime`, so CSS, Web Animations, GSAP, Motion and any rAF loop advance deterministically;
  it photographs every frame and writes a contact sheet with the change under each frame and the
  measured curve against the straight line. From the pixels it reports whether anything moved,
  the easing the frames actually show, where the motion settles, whether one frame carries the
  whole change, and whether it still animates under `prefers-reduced-motion` — verified by
  re-capturing that way, not by grepping for the query. New hook `post-tool-motion.js` reports
  every animating file that has not been watched and names the tells visible in the source.
  The loop in `CLAUDE.md` now covers motion on the same terms as every other surface.

- Fixed: `slop-lint` exited 0 on a file that does not exist and 1 on `--help`.
## 1.9.1 — 2026-09-02

Found by doing the thing the package promises and had never been tested: cloning it from
GitHub onto a machine that has nothing and installing it.

- **The test suite obeyed the environment instead of isolating from it.** Since `paths.mjs`
  began honouring `CLAUDE_CONFIG_DIR` (1.6.0), an ambient value beat the scratch `HOME` these
  tests isolate with — so on any machine that sets it, twenty-five tests failed and the session
  hook reported DEGRADED. Worse, the uninstall tests then operated on the **real** config root:
  the fresh clone's hooks and skills vanished mid-suite, which is how this was found. Every
  HOME-isolated child now has the variable deleted, and before any destructive run the test asks
  the child where its `CONFIG_ROOT` actually is and refuses if the answer is outside the scratch
  home.
- **`--skip-library` is not a broken install.** The flag is documented and the Tier-3 library is
  a 200 MB clone; skipping it made the doctor print thirteen failures and "install is broken",
  and made the session hook repair fruitlessly at every start. Absent Tier-2 skills are now one
  warning naming the command that installs them — unless the library is present and a skill is
  missing from it, which is still a failure.

## 1.9.0 — 2026-09-02

- **The older taste references fact-checked.** Every typeface probed against the live Google
  Fonts API, every support claim against browser data, every engine API against its own docs:
  eleven errors and ten overclaims, all corrected, about a hundred and forty claims confirmed.
  The errors that mattered: the particle example faded a particle that additive blending makes
  pop, because additive never reads alpha; the `font-variation-settings` snippet pinned the very
  optical-size axis its own comment said to let the browser choose; Firefox shipped anchor
  positioning in January 2026, so the "unshipped through 2026" note was backwards; Motion
  deprecated `staggerChildren` in July 2025; `BackdropMaterial` is a WinUI 2 API, not WinUI 3;
  Unity's 2D light types name Sprite, not Point; Godot's HDR 2D moved and is 4.2+; the
  MonoGame tweening package is deprecated in favour of the main one; smootherstep was
  smoothstep; braille is four times the vertical resolution, not eight; `.kkrieger` is a 96 KB
  game, not a 4 KB intro. The overclaims now name their versions and their conditions.
- **An email, worked.** `design-fields/examples/harbor-swim-club-email/`: the field where the
  constraints decide the form. Nested tables, a face the reader already has, every structural
  line a table row so the design is identical with images off, one bulletproof link, 8.9 KB.
  The audit caught a contrast failure and a 20 px tap target the eye had passed — and following
  the first properly took the accent out of the design rather than darkening it, because the
  identity reserves that colour for safety flags.
- **The react-doctor gate's own hole.** A JavaScript file outside any project still fell back to
  the session's project, so a scratch script was reported as an unrelated repository. Only a file
  that names no path at all falls back now, and the test sets the variable that had been hiding it.

## 1.8.0 — 2026-09-02

- **The far read, proved.** `print-render --distance 40ft,10ft,2ft [--viewer 12in]` writes one
  PNG per viewing distance at the angular size the eye actually gets: a piece seen from *D*
  subtends what an image *d/D* its size does at *d*, so each is rendered at 96 × *d*/*D* dpi and
  holding the screen at the viewer distance puts you there. The poster example's far read is now
  a measurement — at ten feet the word and the when-and-where read and the board is texture, as
  its directions claimed. `ft` and `m` are lengths; the signage and print-taste references name
  the command instead of describing the ratio.
- **react-doctor scans the project it was told about.** It ran in the session's working
  directory, so editing a file in one repository reported a different one — pages of warnings
  about code the edit never touched. It now resolves the written file's own project (the nearest
  `package.json`) and stays silent for a JavaScript file that belongs to none.

## 1.7.1 — 2026-09-02

Two defects this session's own work exposed, both of the kind that trains a reader to ignore
a check:

- **react-doctor scanned on writes it cannot read.** Editing a Markdown file ran it over the
  whole project and reported forty pre-existing warnings about code the turn never touched.
  It now scans only when a JavaScript or TypeScript file was written; an event that names no
  file still scans, as before. Four tests hold the gate.
- **`--bleed 0` was rejected.** A bare zero is a real answer — a slide deck, a screen-only
  proof, a piece trimmed flush — and the renderer demanded a unit on nothing. Zero parses; a
  number without a unit still does not. The seven-slide deck renders as one 7-page PDF.

## 1.7.0 — 2026-09-02

A third adversarial review, over the hooks and the remaining tools; fourteen findings, the
real ones fixed and held by tests. And a worked slide deck.

- **The secret scanner sees JSON.** `"client_secret": "…"` — the very shape of `.claude.json`
  — never matched the assignment rule because the key was quoted; a hex secret in a JSON file
  was then skipped by the entropy sweep too. Quoted keys match now.
- **The visual prompt hook stops firing on code.** `tween` in "between", `easing` in
  "increasing", `graph` in "GraphQL", `card` in "discard", `tee` the command, "story points",
  "slide the window", "npm packaging" — all fired the design context, some of them the paper
  or field routing. Every generic term is now a whole word, and a word that is visual only in
  a design sentence fires only beside a word that says the prompt is about something seen.
  Twelve silent cases and ten firing cases are held by a test.
- **The syntax check catches a broken ES module in a .js file**, which `node --check` on Node
  24 accepts; JSONC (VS Code, devcontainer, `.eslintrc.json`) is no longer "invalid JSON"; a
  `$USER` path and a single-letter regex literal are no longer "hardcoded machine paths".
- **The Stop hook** no longer hands deleted files to the linter, and emits its context in the
  shape the Stop event reads. **react-doctor** emits the recognised shape on every write and
  bounds its spawn. **Model routing** treats "fix", "repair" and "failures" as judgment, so
  "run the tests and fix any failures" is no longer routed to the smallest model — and
  CLAUDE.md now states the hook's real contract: it is authoritative and corrects a passed
  model rather than deferring to it. **sync** normalises a hook's script path before its root
  is tokenised, so a hook registered from under HOME, the repo or the library no longer
  round-trips as a dead backslash path on POSIX. Hooks tolerate a `null` payload.
- **A slide deck, worked.** `design-fields/examples/harbor-swim-club-deck/`: seven slides at
  1920 × 1080 through which the identity's waterline rises, one number per slide, a hand-drawn
  bar chart standing on the waterline, the tide table as the ledger, the flag at high water.

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
