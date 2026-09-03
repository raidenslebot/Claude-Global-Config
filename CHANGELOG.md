# Changelog

The version is `package.json`'s and is tagged `vX.Y.Z` on `main`. Every install follows
`main` automatically at session start (`config/hooks/session-start-update.js`), so this file
is what a machine gained between two starts. Bump the version and add the entry in the same
commit — a test holds them together.

## 1.25.0 — 2026-09-02

Two tools at the end of the pipeline, where a mistake becomes a physical object.

**`outline-text` could not outline a Google font at all.** Every identity, apparel, signage and
vinyl brief ends with "outline the fonts", and this is the tool that does it — and for any
family fetched from Google it failed with *no woff2 in the stylesheet*, which is to say always.
The face URL was matched by its **file extension**, and a subsetted face — which is what
`&text=` returns, and `&text=` is the path this always takes — is served from
`fonts.gstatic.com/l/font?kit=…&skey=…` with no `.woff2` anywhere in it. It is matched by the
declared `format('woff2')` now, latin block first. The parser is its own exported function with
its own test, because what broke here was never reachable from a test that used a local font.

The same tool's failure path aborted rather than exiting. Calling `process.exit()` in the turn a
`fetch` rejected in trips libuv on Windows — *Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING)* — and exits **127**, so anything reading the status saw a crash rather than
the 1 it meant. It sets the exit code and lets the loop drain.

**`print-render` refuses artwork that is not the size of the page it is being placed on.** The
source is embedded at exactly trim + 2×bleed. A piece drawn at *trim* size therefore sat in the
top-left corner of the sheet with white down two edges — and the summary line said `page 3.75 ×
2.25 in · trim 3.5 × 2 · bleed 0.125`, as though everything agreed. The press cuts on the marks;
the card comes back with a white sliver on two sides. It now reads what the file declares,
compares it to the box, and stops with both numbers and the two ways out. A file that declares
no size still flows into the box and fills it, which is correct and is left alone.

The declared size is one function (`declaredSize` in `print-lint`) that both the gate and the
renderer call, so they cannot come to different conclusions about how big the piece is.

## 1.24.0 — 2026-09-02

The audit measures the page at rest, and measures the parts of it that hang off the edge.

- **A headline that bleeds off the canvas is measured, not excused.** Any run with a negative
  left was refused outright and reported as "could not be measured" — a warning that looks like
  nothing and is a hole. It was the biggest word on a shipped social post, and measured, it
  failed. The run is clamped to the canvas now.
- **Contrast is measured on the design at rest.** Two screenshots of a page that is still moving
  are two screenshots of two pages: an animation on `width` reflowed the document between them,
  the pair came back at different heights, and any run past the shorter one was measured against
  cleared canvas — read as opaque black, reported at 1.11:1, on a page with nothing black on it.
  Finite animations are finished (their settled state *is* the design), endless ones paused, and
  the sampled region is the intersection of the two shots. This also made the audit's own test
  suite deterministic; it had been failing about one run in three.
- **A tap target is in a sentence whether it is `inline` or `inline-block`.** A link styled
  inline-block for its underline offset is still a link in a sentence, which is the case WCAG
  exempts.

**Two shipped examples were wrong, and the sharper audit is what found them.**

- *Night Market* chose its orange against the paper swatch — 3.1:1, comfortably over the 3:1
  large-text bar. But the grain layer and the blue ghost pull the paper under that word to
  `#e4dcca`, where the same ink reads **2.72:1**. The word's ink is two steps deeper now:
  3.36:1 where it actually sits. A colour chosen against its swatch is a colour chosen against a
  ground that exists nowhere on the page.
- *Tide* set a unit label at `0.5em` of a number that clamps to its floor on a phone — 10.8px, a
  size nobody chose, arrived at by multiplication — and floored its gauge scale at 11.2px. Both
  now hold 12px at the bottom and are untouched everywhere the viewport is wide enough to matter.

Both reviews carry the new pass: the loop is the deliverable, not just the file.

## 1.23.0 — 2026-09-02

Every design this package ships as a reference now passes the gates this package ships. Five of
the six failed them before this release, and in every case the gate was asking a question that
did not belong to the piece — the surest way to teach anyone to ignore a gate.

**The accessibility gate sees motion it has no API for, and text where the reader meets it.**

- **A page can animate entirely from JavaScript**, which is what GSAP's default path and every
  hand-rolled loop do, and `document.getAnimations()` reports none of it. The audit counted
  animation frames that wrote style: when a loop is running and the CSS API is empty it says so
  and points at `cgc motion`, rather than reporting a moving page as still. Under
  `prefers-reduced-motion: reduce` it now photographs the page twice a second apart — whatever
  drives the movement, JavaScript, canvas or media, two different pictures is two different
  pictures.
- **Pinned text is measured where the reader meets it.** A `fixed` or `sticky` header is
  captured once by a full-page shot, at scroll 0, over its own hero. Scrolled to the bottom it
  sits over the article, and a bar that is legible over a dark hero and invisible over white
  paper was passing clean. It is measured there too now, from the pixels.
- **WCAG exempts a tap target that sits in a sentence** — which needs both halves: the control
  flows inline, and what surrounds it is running text. "Any parent with any text" exempted a
  20px × beside the word Menu, and every nav link in a row that carried a separator.

**A gate asks the questions that belong to the piece.**

- **A fixed canvas is audited at its own size.** A slide, a social post, a label and a banner
  declare their pixel size and carry no viewport meta, because nothing lays them out — they are
  the layout. Audited at 390px every one of them reported sideways scroll, which is the artefact
  being the size it was specified to be. `check` reads the declared canvas and audits there.
- **A page and the stylesheet it links are one design.** Judged as markup alone a deck slide has
  no technique at all, because every technique it uses lives one file away. `techniques` now
  reads a page with its stylesheets and scripts, and `check` stops judging the stylesheet
  separately for ambition it can only have through a page.
- **A trademark is not judged as a web page.** A wordmark, a lockup and an app icon are drawings
  in a set, and the set gate asks the questions that apply to them. Measured against the
  technique registry, every logo ever drawn reads "assembled · 0 of 10" — a mark that needed a
  gradient, a filter or a mask would fail the moment it was embroidered, faxed or set in one
  colour.
- **A folder of drawings is only judged as a set when it is one.** An identity system — a
  favicon at 32, a mark at 350, lockups at 469 × 166, a wordmark at 287 × 49 — was failed for
  disagreeing with itself about a grid it never shared, for pinning the brand's own colours, and
  for lettering that is off-grid because letterforms are. Two thirds on one grid makes a set;
  below that `icon-lint` says which questions it did not ask, and asks only the ones true of any
  drawing.
- **A script is a design only if it draws.** A `.js` or `.mjs` file with no drawing surface
  anywhere in it is build tooling. A linter was being told to reach for anchor positioning
  because one of the sentences it prints contains the word "gradient".
- **A note about a technique is not the technique.** Comments and quoted code are blanked before
  anything is measured. One comment in a deck's stylesheet — the command line that exports it,
  which mentions `--bleed` — put the whole deck in the *print* medium and filled its pool with
  foil, spot colour and paper stock, none of which a slide can have.
- **`check` stopped walking into its own footprints.** It entered the frames directory
  `motion-render` writes beside a design and audited the contact sheet as if it were one:
  fourteen failures, on a diagnostic photograph.

**The registry recognises typographic craft it was blind to.** `font-stretch: 75%` is the
standards-preferred way to drive a variable font's width axis and how a real project writes it;
reading only `font-variation-settings` scored a width-axis deck at zero. And `text-wrap: balance`
and `pretty`, with the hyphenation limits, are now their own technique — the line breaks decided
rather than accepted, which is the difference between typeset and poured.

Blanking comments also exposed two detectors that had only ever matched the prose describing
them: a shader's distance field (named `sdSphere` or `sdfSurface` in real code, never `sdf` on
its own) and a chart's alpha bound to a value rather than set to a constant. The fixture test
that catches a dead pattern is what found both.

## 1.22.0 — 2026-09-02

A second adversarial review, this time of the two static gates — `slop-lint` and `print-lint`.
Both were passing files they should have failed, and failing files they should have passed. The
pattern behind most of it: a gate read the file as characters rather than as what the browser
would do with it. A token was not resolved, a comment was not skipped, a code sample was read
as if it were a stylesheet.

**`slop-lint` reads the page, not the source.**

- **Design tokens no longer hide the fingerprint.** `--font-body: system-ui` used through
  `var()`, a purple gradient assembled from two token colours, an acid accent on a
  `var(--ink)` ground — all three families read the resolved text now. A project that names
  its colours was invisible to the gate, which is every project of any size.
- **A page that documents a technique is not using it.** The content of `<pre>`, `<code>`,
  `<samp>` and `<textarea>` is blanked before linting — blanked, not removed, so every line
  number still points where the reader would look. An article explaining why the glass card
  fails was reporting itself as a glass card.
- **A translucent sticky bar is navigation.** `backdrop-filter` behind a `position: sticky`
  header is one of the few genuinely good uses of it; the *glass card* is a content surface
  with a blur standing in for structure. Only the second is reported.
- **A state colour is not an accent.** A dark dashboard needs a green that means "running"
  beside a red that means "failed". The dev-tool default is one saturated hue carrying an
  entire design, so `acid-on-black` now counts the hues first — excluding gradient stops (one
  gesture, not two accents) and token declarations (a declaration is not a use).
- **A ramp built at one hue answers the grey charge.** Four dead greys still fail; a page whose
  neutrals carry a little chroma has already done the thing the family exists to ask for.

**`print-lint` measures what goes to press.**

- **A raster placed as a background is checked.** `background-image: url(...)` with a physical
  width is how a full-bleed cover is usually placed — and it was the one way a raster reached
  the page unchecked. The commonest placement of the largest image on the piece.
- **The page size is read from the rules the browser would apply.** An `@page` quoted in a
  comment beside the real one — exactly what a designer writes — was taken as the size, and
  every downstream check (bleed, and every SVG unit conversion) inherited it.
- **Named sizes are sizes.** `@page { size: A4 }` and `@page :first { … }` are how most people
  write this; both were rejected as "no `@page` rule".
- **`min-width` and `max-width` are not the placed width.** A `min-width: 1in` passed a 150dpi
  image; a routine `max-width: 8in` failed a 450dpi one. In both directions, from one `\b`.
- **Single-quoted attributes are read**, which several SVG exporters emit, and class and id
  names are escaped before they become a `RegExp`.
- **The same finding a thousand times is one line.** An exported SVG with four thousand
  hairlines printed four thousand identical FAIL lines and buried everything else; it now
  prints once, with a count.
- **A failing measurement reads as failing.** "2.1mm = 6.0pt, below the 6pt minimum" was a
  rounding artefact; it prints at whatever precision it takes to be visibly below the limit.
- **A bare run says what it did not check.** With no `--size` or `--trim` there is nothing to
  compare against, so the bleed check never ran — and a document at exactly trim size looks
  identical to a correct one from there. It no longer says "Passes the physical checks" after
  skipping the check most likely to send a job back. Apparel methods are exempt: a screen-print
  film is not cut out of a larger sheet.

**The loop no longer trips over its own footprints.** `cgc check` walked into the frames
directory `motion-render` writes beside a design and audited the contact sheet as if it were
one — fourteen failures, on a diagnostic photograph. A `-frames` directory is the tool's own
output and is skipped.

## 1.21.0 — 2026-09-02

An adversarial review of the accessibility gate returned fifteen findings, nearly all of them
false passes — real defects shipping under "no failures". Five shared one root cause: contrast
was derived from the computed-style chain, which answers "what did the author declare" rather
than "what does the reader see".

- **A background image anywhere turned the contrast check off for the entire page**, and said
  so as an `info` line, which the summary counted as clean. A 1×1 transparent GIF on `<body>` —
  changing not one rendered pixel — was enough to hide white-on-white text from the gate. Any
  noise texture or subtle gradient did the same.

- **A scrim painted over the text was invisible to it**, because the composite walked only from
  the bottom of the stack up to the text and dropped everything above. Ink at 1.3:1 under a 93%
  white veil measured 9.7:1 and reported nothing at all.

- **A decorative layer with `pointer-events: none` composited the wrong ground** — the composite
  used hit-testing, which by definition skips exactly the layer every hero overlay is written
  with. Two files differing by 22 characters that change nothing on screen gave opposite
  verdicts.

- **A blend mode measured the declared colour**, so black text rendering white on white was
  computed at 21:1. And **a gradient ground could only ever inform**, which is the commonest
  hero contrast failure there is.

Contrast is now measured from the pixels. The page is photographed twice — once as it is, once
with every glyph made transparent — and the difference between the two shots is the ink, on
whatever it turns out to be sitting on. Two ratios come out of that, and both are needed: the
declared ink on the **painted** ground, which is the ratio the standard defines and the only
one that is fair at small sizes; and the painted ink on the painted ground, which is what the
reader sees. When the second collapses to a quarter of the first, something is drawn over the
text and it says so. Glyphs that change nothing between the two renders are not unmeasurable —
they are invisible, which is a finding rather than the absence of one.

- **Text in a shadow root, in an `<svg><text>`, directly inside `<body>`, or one character long was
  never measured at all.** A page built from web components audited as if it were blank, and
  said "no failures" with a palette line that made it look measured. Badges, counters, close
  glyphs and single-letter avatars — the runs most likely to be too small or too faint — were
  skipped by a two-character minimum.

- **An HTTP error page was audited as though it were the page you meant.** A typo, a stale
  route or a dev server that had moved on gave "No failures" and exit 0. And a page whose load
  never completed exited 1 — the code for "this page has accessibility failures" — so a caller
  could not tell a bad page from an audit that never happened.

- **`outline: 2px solid transparent` counted as a visible focus state.** It is a routine reset
  idiom, and two pages equally unusable by keyboard gave opposite verdicts. A flag placed
  before the path also swallowed it, so `page-audit --json page.html` handed a JSON consumer
  the usage banner.

Text explicitly hidden from assistive technology is now exempt from contrast: a submerged gauge
numeral is meant to be illegible, and the reading it stands for is carried in text that is not
hidden. The tide example gained that exemption and lost a pair of 9.9px axis labels the widened
collection caught — a real defect in it that nothing had ever measured.
## 1.20.0 — 2026-09-02

Found by doing the thing this package promises and had not been re-tested in eight releases:
cloning it from GitHub onto a machine that has nothing, and installing it.

- **A fresh install produced a design toolchain that could not draw.** `playwright-core` ships no
  browser of its own — it says so in its own README — and the install brought the package and
  stopped. So a friend following the README got a green install in which `cgc render`,
  `cgc audit`, `cgc motion` and `cgc print` all failed, which is most of what this package is
  for. The browser is now part of the install.

- **And the doctor called that healthy: 41 ok, 0 failed.** It checked that the MODULE resolved,
  which is a different question. Worse, a path check would not have helped either — a headless
  launch uses the headless shell rather than the full build the path names, and a newer
  `playwright-core` can want a build number that nothing has downloaded while an older build
  sits beside it. Both the doctor and the install now answer the only honest version of the
  question, the one every gate asks: they launch a browser and close it.

- **Importing `install.mjs` performed an install.** It has no exports and acts the moment it
  loads, so an accidental import — from a test, or from a tool reaching for one of its helpers
  — silently ran one. It now says what it is instead.

The fresh clone was then driven end to end with an isolated home and an empty browser
directory: install, browser download, doctor, and a real `page-audit` run that exits 0. The
line such a machine prints is `CGC v1.20.0 enabled · 42/42 checks`.
## 1.19.0 — 2026-09-02

An adversarial review of the two newest tools returned 29 findings, and named the theme
exactly: both treated **"I could not find it" as "it is not there"**, and every one of those
resolved to a green verdict. That is the worst way for a gate to be wrong — the author is told
their work is fine when it is not.

### `cgc check` — a gate that produced nothing has not passed

- **Four ways a gate could vanish and be counted as clean.** A child that crashed, printed
  something unparseable, timed out at the three-minute limit, or was simply missing from a
  partial install produced no row at all for the techniques, lint and icons gates — only audit
  and motion had an else. Every gate now goes through one decision that either builds a row
  from the result or says plainly that there is no result to read.

- **A child that reported nothing wrong and then exited non-zero was trusted.** A tool that
  crashes after emitting a clean-looking partial result was indistinguishable from success. It
  is now reported as untrustworthy rather than as a pass.

- **`--strict` and `ok` ignored "could not run".** The file’s own comment stated the rule it
  was breaking. A skipped gate now makes both fail, which matters most in CI, where `--strict`
  is the only signal and a missing browser is the normal failure mode.

- **A boolean flag ate the next path**: `check --no-mobile bad.html tiny.svg` checked only the
  SVG and reported everything clean, and `check --json page.html` handed a JSON consumer the
  help text. Flags that take no value are now declared as such, and a flag missing its value
  is an error rather than a silent theft.

- **A docs page was judged as a print piece.** `@page` inside a `<code>` block or a JS string
  matched, so any tutorial or style guide skipped the lint, the audit and the render entirely.
  Quoted code is now removed before the test. The inverse was also true: `size: A4`, the
  commonest form there is, was invisible to the whole print path.

- **Four common ways to animate were missed** — including `animate(…)` from motion.dev, which is
  the library the stack mandates as its default — so those pages reported "no gate applies".

- **An icon set is a folder, not a tree.** `cgc check .` judged every SVG under a project as one
  set, so a logo failed for disagreeing with icons it has nothing to do with.

- Also: a result missing a field aborted the whole run; a repeated `--skip` silently kept only
  the last; a duplicated path ran every gate twice; a junction loop exited with ELOOP; and a
  file that could not be read vanished from the report.

### `cgc icons` — the parser

- **Everything outside `<symbol>` was discarded**, so a sprite hard-pinned to two hex colours
  and stroking at a quarter of a pixel from its own stylesheet was declared clean. Symbols now
  inherit the root attributes and the document `<style>`, which is where a set states its rules.

- **A comment mentioning `<symbol>` turned a plain icon into a sprite of one empty symbol**, and
  the real document — live text, an embedded raster and a pinned colour, three of the four
  absolute faults — was thrown away and reported clean. Comments are removed before anything
  is read, which also stops a rejected variant inside a comment being read as live artwork.

- **Only the first stroke width was ever tested**, so an icon at stroke 2 with two 0.4 paths
  inside it passed while drawing real hairlines. Every width is now checked against the set,
  and the thinnest one decides whether the icon survives the size it is used at.

- **A deferred colour was reported as a pinned one and a real pin was missed.** `url(#gradient)`
  and `var(--icon)` — the two ways an icon is HANDED its colour — were failures, while the
  `stop-color` hexes inside that gradient, which are a genuine pin, were never looked at.

- **A self-closing `<symbol/>` swallowed the next symbol**, losing an icon, misattributing one
  finding and destroying another.

- Also: `2px` and `2` were different weights; eight `opacity="0.87"` values counted as eight
  traced coordinates; an attribute containing `>` truncated the root tag and produced a false
  "no viewBox"; `fill="none"` counted as filled; a tie between two grids blamed whichever
  sorted later; `--size abc` silently became 16 and `--size` with nothing after it became 1px,
  failing every icon; and a file in the set that yielded no icon was dropped without a word.

### One thing I could not verify here

The unreadable-file path is fixed and reads correctly, but I could not construct its trigger on
this machine: the process runs elevated, so a denied ACL is bypassed, and the other trigger is a
file past Node’s string limit. It is four lines and covered by inspection, not by a test.
## 1.18.0 — 2026-09-02

A gate nobody is told to run is a gate that does not exist — which is the same defect as the
repo-relative commands that started all of this, wearing a different hat.

- **`cgc icons` and `cgc outline` were named only in the README**, which is the one place
  nothing reads while the work is happening. Both are now in the mandate and in the routing
  hook, on the field route where icon and identity work actually lands: the set gate with what
  it derives and what it refuses, and the reminder that a wordmark ships as outlines rather
  than live text so the artwork depends on no font being installed anywhere.

- **Four shipped tools had never reached the install table** — `cgc.mjs`, `check.mjs`,
  `techniques.mjs` and `icon-lint.mjs`. A reader installs what the table describes and then
  finds commands nothing told them existed.

- Two gates so neither can happen again: every tool that ships must be named in the README,
  and every `cgc` subcommand that is not plumbing must be named somewhere the model reads
  while working — the mandate, a hook, or a shipped skill. The README alone does not count.
## 1.17.1 — 2026-09-02

The last of the review findings, and tests against a real browser for the two fixes that
mattered most — both subtle enough that until now I had only checked them by hand.

- The session hook still described the fetch throttle that was removed, `update()` still took a
  parameter it no longer used, and the status map still held a phrase for a status that can no
  longer occur. A comment that contradicts the code is worse than no comment: it is the thing a
  reader trusts instead of reading. Removing them exposed that the variable had a second job —
  it decides whether the line is announced to the user or merely recorded for the session — so
  it is back under the name of the job it actually does.

- Four browser-backed tests now hold the reduced-motion contract: a fade instead of a move
  passes; cutting the animation passes, because there is then no path to travel; no guard at
  all fails and says how far the page still travels; and a page animated from a `setTimeout` is
  not reported as dead. That logic was wrong twice, and both mistakes failed pages that had
  done the right thing, which is the worst way for a gate to be wrong.

- And one test holds the defect that made the tool lie: with no browser available, the audit
  and motion rows must appear as unable to run and be counted as such — never vanish into
  "every gate clean".
## 1.17.0 — 2026-09-02

An adversarial review of the new tools and hooks, reproduced against a scratch repository.
Sixteen findings; the worst of them made a gate lie.

- **A gate could vanish and be counted as passing.** `playwright-core` ships no browsers, so a
  machine with the MCP server and no downloaded Chromium got a crash and exit 1 rather than the
  documented exit 2 — and `cgc check`, which only knew about 2, dropped the audit and motion
  rows entirely and printed **"every gate clean"** about a page it had never rendered. All four
  browser tools now return 2 when the browser cannot launch, and a gate that cannot run prints
  a row saying so with the reason. An absent gate reads as a gate that passed, which is the one
  thing a summary must never imply.

- **The reduced-motion check failed the remedy it recommends.** The reduced run was captured
  at two frames and compared against the sum of a twelve-frame capture — different quantities.
  An opacity fade, which the finding’s own note tells you to use, was reported as a failure at
  five times less motion. Both sides are now the summed path over the same frames, which also
  distinguishes the case endpoints cannot: `transition: none` leaves the element in the same
  place at the end but travels no distance to get there, and now passes.

- **The virtual clock did not cover timers, so the tool was not deterministic.** An animation
  triggered by `setTimeout` advanced on real wall time, so the same page reported `NOTHING MOVED`
  on a fast capture and animated correctly on a slow one. `setTimeout` and `setInterval` now run
  on the same virtual clock, fired in time order before each frame.

- **The scrub assumed every animation began at zero.** Anything created part-way through the
  capture — a class flipped from a callback, a JS-triggered transition — was scrubbed to the
  absolute capture time rather than to its own elapsed time, so it jumped most of its distance
  in one frame and finished early. That manufactured jump-cut verdicts, corrupted the easing,
  and made the delay-is-lag check unable to fire at all. Each animation is now scrubbed from
  the instant it was first seen.

- **A scroll capture was judged against a duration no page declared** (`frames × 100`), and then
  told that its evenly spaced samples were "linear" and its invented 1600 ms was too slow. A
  scroll capture has no duration, so the findings that need one no longer apply to it.

- **The motion hook read `.3s` as 3000 ms** — the pattern required a digit before the decimal
  point, which is the commonest way nobody writes it. It reported "3000 ms of motion is long
  enough to be waited on" about a 300 ms transition, and its `break` then hid any real finding
  later in the file. The same pattern was **quadratic**: unbounded and unanchored, so every bare
  word "transition" in prose was a start position. A 355 KB article took 2.3 seconds and a 5 MB
  one never finished; both are now milliseconds, and a test fails if it goes quadratic again.

- **`border-top-color` was called a layout animation** because `\b` reads `top` inside it as a
  word of its own. It is paint-only, and so is `border-bottom-color`.

- **The test-path exclusion was dead on Windows**, the platform this runs on: the character
  class held a forward slash only, so no directory ever matched — while `latest.css` and
  `greatest.js` were silently exempted from the design report, because unescaped dots read
  them as "a" + "test" + "." + "css".

- **Six patterns fired on words rather than on code**, each flipping a whole dimension of the
  headline output: a `[A-Z]` character class counted as a terminal redraw loop and silenced
  "Does anything happen?"; `linear-gradient()` counted as a gradient across text; a jQuery
  `.attr()` read counted as style driven by data; the word `velocity` in a comment counted as
  a simulation; a variable named `brush` counted as a brush interaction; and bare `Math.random()`
  counted as a seeded scene, which is the opposite of what that entry promises. A two-shadow
  stack, meanwhile, was reported as never tried.

- **An extension file could be half applied in silence.** One unparseable pattern threw out of
  the whole loop, so every medium defined after it vanished with no word. Each medium is now
  its own attempt, with a warning naming what was skipped. And because a regex has no timeout,
  a nested quantifier in somebody’s file could hang the tool outright — such a pattern is now
  refused before it is ever run.

- **A directory containing a junction to itself was reported as not existing**, and the real
  file beside it never measured: the walk followed links with no record of where it had been,
  and the caller turned every filesystem error into "no such file".

- **The session hook misreported an untracked-file block as DEGRADED** while reporting the
  identical tracked-file case calmly, because it probed with `--untracked-files=no`, which by
  definition cannot see the file that caused the abort. It also kept only the last line of
  git’s error, which is always the word "Aborting"; the lines naming the files were discarded.

- Also: both hooks exited 1 with a stack trace if their reader hung up, since EPIPE arrives
  asynchronously where a try/catch cannot reach it, against a header promising exit 0 always;
  and `--min abc` made every comparison false, so the gate failed whatever the piece did.

**Nothing was found in the one category that must be impossible.** Five scratch repositories
were driven through the real hook — a modified tracked file the pull changes, the same staged,
an untracked file the pull would add, an unrelated local edit, and a clean tree. Every clashing
case refused and left the work byte-identical; the unrelated edit fast-forwarded and survived.
`update()` runs no reset, checkout, clean, stash or force anywhere.
## 1.16.0 — 2026-09-02

An adversarial fact-check of the technique reference against MDN, caniuse and the platform
docs. Eleven claims were wrong, misleading or overstated. Wrong facts in a reference are worse
than no reference, because they are written as recipes and get copied into real work.

- **The subgrid recipe did not work.** `.row` declared `grid-template-rows` and no columns, so it
  had one implicit column and every card stacked in it. The promised payoff — titles and
  footers aligning ACROSS a row — cannot happen when there is no row. This was the file’s fix
  for what it calls the most common generated-layout defect there is, and copied verbatim it
  produced a single column and the conclusion that subgrid is unsupported.

- **The optical-sizing snippet contradicted itself.** It set `'opsz' 144` and
  `font-optical-sizing: auto` in the same rule, with a comment saying opsz would follow the
  font size. `font-variation-settings` overrides the basic property for the same axis wherever
  it appears, so the auto did nothing and every heading rendered at the poster cut, including
  on a phone. The two are now shown as the alternatives they are. The catalogue also stopped
  scoring `font-optical-sizing: auto`, which is the property’s initial value: it was awarding a
  technique for writing out the default.

- **"Everything below is shipping in every current browser" was false**, and it disabled the
  file’s own safety rule, which calibrates its `@supports` advice against that sentence.
  `hanging-punctuation` is Safari only; `initial-letter` has no Firefox; `text-wrap: pretty` has
  no Firefox; anchor positioning is partial in Firefox; scroll-driven animation arrived there
  only very recently. Support is now stated per entry, with a table of the five that are not
  everywhere and what to do about each — and the scroll-driven and drop-cap examples carry the
  `@supports` gates they always needed. Without a timeline, `animation: … both` is an ordinary
  animation that fires once at load, so every "reveal" on the page happens at the same moment.

- **`mix-blend-mode: difference` does not "stay legible over anything."** It guarantees
  inversion, not contrast: white over a mid-grey lands on that mid-grey, which is most of what
  a photograph is made of. The claim licensed dropping the scrim, which is the actual guarantee.

- **The variable-axis list called five custom axes "common".** Only `wght`, `wdth`, `opsz`,
  `slnt` and `ital` are registered. `GRAD`, `CASL`, `MONO`, `SOFT` and `WONK` are family-specific,
  and setting one on a family that lacks it fails silently — no error, no warning, no
  difference — so the reader ships dark-mode grade correction that never applied. The families
  that actually carry each axis are now named.

- Also corrected: paint worklets were ranked as a high-lift move while being Chromium-only
  (Firefox does not implement them, Safari ships the API disabled); trapping was described as
  an expressive effect when it is a prepress correction normally applied by the RIP;
  `display-p3` was said to be on every modern screen; haptics were called a channel the web
  does not have at all; and SwiftUI’s `.visualEffect` was being matched as a shader modifier
  when it is a geometry proxy.

- The tide example carried `font-optical-sizing: auto` on Archivo, which has no `opsz` axis, so
  the declaration could not do anything. It is gone, and its `review.md` records why the
  measured count moved from 19 to 18 with no change to the design.
## 1.15.0 — 2026-09-02

A gate for the one field that is judged as a set, and three cases where a gate asked the
wrong question of the wrong file.

- **New gate `cgc icons <dir>` — an icon SET judged as a set.** A single icon is almost never
  wrong; a set is wrong constantly, and always in ways that are invisible when the icons are
  looked at one at a time, which is how they are always looked at. It derives what the set does
  — grid, stroke weight, caps, joins — from the majority, then names every icon that disagrees,
  plus what is wrong at any size: live text that depends on a font the viewer may not have, an
  embedded bitmap, a missing viewBox, a colour pinned instead of `currentColor`, coordinates that
  sit off the grid because the icon was traced rather than drawn, and a stroke that renders
  under one pixel at the size the set is actually used at. `cgc check` runs it over any folder
  holding three or more SVGs. The set that ships passes it; a deliberately broken set produces
  seven failures and two warnings, each naming the icon.

- **Three wrong questions, all found by running the new gates on real files.** A 200-byte icon
  was being asked to be ambitious, so a folder of perfectly good icons reported ten failures; a
  fragment is now below the threshold, as it already was in the hook. A `sprite.svg` was judged
  as artwork when it is a delivery format for a set — the set gate is the right one and already
  runs. And a test, a fixture or a scratch script is not a design however much markup it quotes,
  so the write-time report now stays out of test and fixture paths.
## 1.14.0 — 2026-09-02

The loop in one command, and two ways the medium detector was reading the wrong evidence.

- **New command `cgc check <file|dir>` — every gate that applies, one verdict.** The loop had
  four or five commands in it, which is exactly why it was run once and then remembered as
  having been run. This reads the file and decides for itself: the ambition measure on any
  design file, the fingerprint lint on web source, the rendered-page audit on a page, the frame
  capture on a page that animates, the press gate on anything in physical units. One verdict,
  with the next action under it. `--strict` makes it an exit code, `--skip` drops a gate, and a
  directory is walked. The individual commands are still what you reach for when fixing one
  thing; this is what answers "did you run the loop", which previously had five answers.

- **A file’s own extension is evidence about the file; the same string in its TEXT is not.**
  Medium detection matched both against one haystack, so any file that mentions `'.frag'` or
  `'.css'` — a linter, a build script, this package’s own tools — was judged as a shader or a
  stylesheet and handed advice about container queries. Extensions are now matched against the
  extension and patterns against the content, and neither borrows the other’s evidence.

- **A file that matches five or more media is a file ABOUT design, not a design.** The
  catalogue itself contains every marker it looks for, as regex source; so do linters and docs
  generators. A real piece spans two or three — a page with inline SVG and a print stylesheet —
  so the count is the tell. Such a file is still measured when asked directly, and is never
  reported at anybody unprompted. The test measures the catalogue itself, which makes it
  self-verifying.
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
