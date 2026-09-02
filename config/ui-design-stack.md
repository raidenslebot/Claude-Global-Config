# MANDATORY UI/Design Resource Stack

For ANY frontend, UI, styling, animation, component, or design work — in every project, without exception — consult and use these resources FIRST, before writing anything from scratch.

## Universal design excellence — every language, not just React

The resources below are the **component layer** for React/Tailwind. Above them sits the
**taste layer**, which applies to *anything that draws pixels in any language*: the
`visual-design-mastery` skill. It carries one design/animation creed (intention over
defaults; spend boldness in one place; motion is meaning; hierarchy first; refuse the
templated look) and routes into per-stack references — web/CSS, shaders/GPU (GLSL/HLSL,
WebGL, Three.js), games (C#/MonoGame SpriteBatch, Unity, Godot, game-feel/juice), native
(SwiftUI, Jetpack Compose, Flutter), and generative/TUI/data-viz. Load
`visual-design-mastery` for ALL visual work; use this React stack as the component layer
underneath it when the project is React/Tailwind. "Fine" is the enemy in every medium.

## The three layers — consult in this order

1. **TASTE** — `visual-design-mastery` (skill). *Should this move at all? What does it mean? What
   would only this project do?* **Wins unconditionally on conflict.** Nothing below may replace
   it; the layers below only add specificity *under* it.
2. **TECHNIQUE** — the per-library craft skills below. *How do I implement this well in GSAP /
   SVG / three.js?* Consulted after taste has decided the move is warranted.
3. **COMPONENT** — the libraries further down (21st.dev, Magic UI, Aceternity, React Bits,
   KokonutUI, Bklit). *Has someone already built this?* Check before hand-rolling.

## Technique layer — installed, always available

Per-library animation craft. These are installed skills; just use them.

> **Read `{{LIBRARY_ROOT}}\_index\CAVEATS.md` before pasting code from any of them.** They ship
> verified defects — `react-three-fiber`'s `useThree` example has a duplicate-`const` SyntaxError
> and pins R3F 8 against a live R3F 9 (peer-conflicts with React 19); `ascii-animation` cites a
> `getImageContext()` API that does not exist and lists two luminance ramps running in opposite
> directions; `threejs-webgl` repeats a WebGL-1 power-of-two rule dropped in three.js r163.

- **`gsap-web`** — GSAP timelines, ScrollTrigger, scrub/pin. The scroll-animation workhorse.
- **`svg-animation`** — path draw-on, morphing, stroke-dasharray, SMIL vs CSS vs JS.
- **`lottie-animation`** — After Effects → web, dotLottie, runtime control. **Use this one**, not
  `claudedesignskills/lottie-animations`.
- **`60fps-animation`** — compositor-only properties, layer promotion, jank diagnosis.
- **`accessible-animation`** — `prefers-reduced-motion`, vestibular safety, focus handling.
- **`micro-interaction`** — hover/press/focus feedback at the component scale.
- **`page-transition-animation`** — route transitions, View Transitions API, shared element.
- **`glassmorphism`** — backdrop-filter craft (and when it's the wrong call).
- **`ascii-animation`** — terminal/TUI motion.
- **`threejs-webgl`** / **`react-three-fiber`** / **`web3d-integration-patterns`** — the 3D stack.
  One stack, deliberately: Babylon, PlayCanvas, A-Frame, Spline and PixiJS are indexed in the
  Tier-3 library, not installed. Don't run five engines.

Physical media are not screens, and have their own technique layer and a real output pipeline:

- **`print-design`** — business cards, flyers, posters, brochures, stickers, packaging, menus,
  invitations. Trim/bleed/safe, resolution, CMYK and spot colour, stock and finish as design
  decisions, folds and die-cuts, the print-specific divergence moves, and the file a printer takes.
- **`apparel-design`** — t-shirts, hoodies, caps, totes, merch. Screen print / DTG / embroidery /
  HTV constraints, placement zones with real dimensions, garment colour as part of the artwork,
  SVG garment flats for a true-scale mockup.
- **`cgc print`** renders HTML/SVG authored in physical units to a PDF at trim +
  bleed (crop marks in a slug; several files become one multi-page PDF) and a PNG proof at a
  real dpi, or composites artwork onto one of nine garment flats at true scale
  (`--presentation` for a reviewable studio render) — through the headless Chromium already
  installed for the Playwright MCP. No account, nothing fetched. **`cgc print-lint`** is the gate: type under the minimum,
  hairlines, rasters under 300 dpi, a page sized in pixels or without bleed, all **fail**.
  Taste first (`visual-design-mastery/references/print-and-physical.md`), concept next
  (`creative-divergence`), then the technique skill, then render, then lint.

## Tier-3 library — 815 skills on disk, none in context

`{{LIBRARY_ROOT}}\` holds 12 cloned repos. Only the 13 skills above are resident (~1,508 tokens);
installing all 815 would cost **~57,674 tokens every session** and thrash skill dispatch, so the
rest is kept as a **searchable library** of 814 indexed entries (`build-index.mjs` holds an
`EXCLUDE` list for what this repo chooses not to surface):

```
grep -i "<topic>" {{LIBRARY_ROOT}}\_index\INDEX.md     # find it
# then read the SKILL.md at the path the index gives you
node {{LIBRARY_ROOT}}\_index\build-index.mjs           # regenerate after a git pull
```

Worth pulling by hand: `animation-principles/skills/09-by-tool-framework/` (After Effects, Rive,
Motion One, Popmotion specifics), `.../12-by-problem-type/` (motion sickness, timing calibration),
`design-extract/website/public/gallery/` (23 **real** measured design systems — cal.com, clerk,
coinbase, duolingo, raycast), `pixel-plugin/skills/pixel-art-professional/` (Bayer matrices,
Floyd–Steinberg weights — engine-agnostic, transfers straight to MonoGame/shaders).

## Component libraries (React/Tailwind)
- **21st.dev** — https://21st.dev/ — community component marketplace (shadcn-compatible). Search here first for ready-made components.
- **Magic UI** — https://magicui.design/ — 150+ free animated components: marquees, bento grids, text effects, buttons, backgrounds.
- **KokonutUI** — https://kokonutui.com/ — polished open-source Tailwind/React components.
- **Aceternity UI** — https://ui.aceternity.com/ — high-impact animated components: hero sections, cards, spotlight/beam backgrounds.
- **React Bits** — https://reactbits.dev/ — animated text, backgrounds, and interactive components.
- **Bklit** — https://bklit.com/ — design-engineered data-visualization components (area, bar, candlestick, pie, line charts, legends, tooltips).

## Animation libraries
- **Motion** — https://motion.dev/ — the default animation library for React/JS work (successor to Framer Motion).
- **Anime.js** — https://animejs.com/ — lightweight JS animation engine; use for non-React projects or timeline-heavy sequences.

## Design inspiration / reference
- **Refero** — https://styles.refero.design/ — real-product design references and patterns.
- **Godly** — https://godly.design/ — curated top-tier web design inspiration.
- **awesome-claude-design** — 68 `DESIGN.md` briefs describing real product design systems
  (Linear, Vercel, Raycast, Supabase, Stripe…), indexed by industry. Links live at
  `https://getdesign.md/<product>/design-md`; the catalogue is `{{LIBRARY_ROOT}}\awesome-claude-design\README.md`.
- **design-extract gallery** — 23 *measured* design systems as actual token files, not prose:
  `{{LIBRARY_ROOT}}\design-extract\website\public\gallery\<site>\.claude\skills\designlang\`.

## Precedence — one answer per question

| Question | Winner | Why |
|---|---|---|
| Anything visual, first move | **`visual-design-mastery`** | Taste layer is unconditional. Technique skills add specificity under it, never replace it. |
| React animation library | **Motion** (`motion.dev`) | Already mandated here. Ignore `claudedesignskills/motion-framer` — a frozen snapshot of a live mandate. |
| Animated component source | **21st.dev / Magic UI / React Bits / Aceternity**, fetched live | Ignore `claudedesignskills/animated-component-libraries` — a 2024-era snapshot of these same libraries that will drift wrong. |
| Reduced-motion / a11y | `visual-design-mastery` decides *whether*; **`accessible-animation`** supplies the fix | Constraint vs technique. |
| Scroll technique vs whole scroll site | **`gsap-web`** for technique; pull `dskills\scroll-craft` only when the deliverable is an entire scroll-driven site | — |
| Lottie | **`lottie-animation`** (web-animation-skills) | Better authored than the claudedesignskills duplicate. |
| "Motion works but feels dead" | **`visual-design-mastery/references/animation-principles.md`** | Never install the 144-skill cross product. |
| Anything printed on paper | **`print-design`**, rendered by `cgc print`, gated by `cgc print-lint` | A screen layout at card size is not a print file. The host `canvas-design` skill owns a poster's *philosophy*; `print-design` makes it printable. |
| Anything on a garment | **`apparel-design`** | Method before art, placement before layout, garment colour is part of the artwork. |

## Rules
1. **The component libraries are for EXECUTION, never for deciding the concept.** Once you know
   what you are building, check them before hand-rolling a carousel, a command palette or a
   chart — reimplementing solved mechanics is waste. But reaching for them *first*, while the
   concept is still open, is how work ends up looking like everything else: these libraries are
   the average of current web design, and adapting one is adopting its opinion. Decide the idea
   first (`creative-divergence`, or the `design-divergence` workflow), then use them to build it
   fast. A library component that fights the concept gets rebuilt, not accepted.
2. For animation, reach for Motion (React) or Anime.js **for UI motion** — don't hand-roll
   keyframe/rAF machinery a library already solves. This is not a ban on `requestAnimationFrame`:
   per-pixel and per-frame work (ASCII rendering, canvas/WebGL loops, generative fields, a hand-
   rolled FLIP measurement) has no library equivalent and a rAF loop is the correct tool. The rule
   is "don't reinvent a tween engine", not "never write a frame loop." GSAP is the right call over
   Motion for scroll-driven timelines, pinning, and scrubbing — that's what `gsap-web` is for.
3. Before making layout/visual design decisions, ground them in patterns from Refero and Godly.
4. Use WebFetch to pull component code/docs from these sites, and the **context7 MCP server** for up-to-date library docs (e.g. `motion`, `animejs`, `magicui`).
5. For data visualization/charts, check Bklit before other chart libraries.
