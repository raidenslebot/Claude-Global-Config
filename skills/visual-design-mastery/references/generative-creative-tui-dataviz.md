# Generative Art, Terminal Craft & Data-Viz Design

A terminal is a canvas and a bar chart is a composition. The long tail of "unglamorous" surfaces — a CLI's progress output, a scatter plot in a notebook, a sketch that runs once and is thrown away — is exactly where craft gets abandoned, and exactly where a little intention reads as magic. This file is opinionated about three neglected domains: **generative/creative coding** (make the algorithm's output look composed, not accidental), **TUI art** (a text grid has a color palette and a layout system whether you use them or not), and **data-visualization craft** (which composes with the existing `dataviz` skill — don't reinvent its palette system, add the visual finish on top). Defer all easing/timing to `motion-and-animation.md`.

---

## Part 1 — Generative & algorithmic art

### The tools, ranked by what they're actually for
- **p5.js 2.x** (default in the web editor from Aug 2026) — the fastest path from idea to pixels. 2.0 brought an **OKLCH color mode**, **p5.strands** (write shaders in JS, not GLSL), variable-font support, and `async`/`await` asset loading (the old `preload` is gone). Reach for it first for sketches and web pieces.
- **canvas-sketch** (mattdesl) — the professional generative-art harness: built-in seed management, deterministic replays, high-res PNG and print-ready export, and first-class pen-plotter/SVG output. Use it the moment a sketch needs to be *reproducible* or *sellable*.
- **Processing 4** (Java) / **openFrameworks 0.12** / **Cinder** (C++) — when you need real performance, threads, or hardware. **Nannou** (Rust) and **thi.ng/umbrella** (Karsten Schmidt's TypeScript toolkit) are the modern, type-safe end of this spectrum.
- **three.js (r17x)** for 3D/WebGL, **svg.js** or raw SVG for crisp vector/plotter output, **Hydra** for live-coded video synthesis.

### The core aesthetic rule: constrain randomness, don't unleash it
Pure `random()` looks like noise because it *is* noise. Beauty in generative work comes from **structured** randomness — noise fields, distributions, and harmony constraints. The single biggest upgrade to any sketch: replace `random(255)` color picking with sampling from a **curated palette**.

```js
// Bad: confetti. Good: a considered palette sampled with weights.
const palette = ['#0d1b2a', '#e0aa3e', '#e5e5e5', '#c1121f']; // ground, accent, light, hot
const pick = () => palette[Math.floor(Math.pow(random(), 2) * palette.length)]; // biases early colors
```

### Perlin/simplex noise flow fields — the workhorse
A vector field where each cell's angle comes from noise. Particles ride it and leave trails. This one technique produces the "silky topographic" look that defines a huge share of generative art.

```js
function draw() {
  for (const p of particles) {
    const angle = noise(p.x * 0.002, p.y * 0.002, frameCount * 0.003) * TAU * 2;
    p.x += cos(angle); p.y += sin(angle);
    stroke(pick() + '18');           // very low alpha — density builds the image
    point(p.x, p.y);
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) reset(p);
  }
}
```
Tuning that separates good from generic: **low noise scale** (0.001–0.005) for long flowing lines; **very low alpha** (`0x10`–`0x20`) so overlap creates value; let it run for thousands of frames — density *is* the composition.

### The rest of the vocabulary (know when each applies)
- **Particle systems** — emergence from simple rules (attraction, repulsion, alignment = boids). Great for organic motion and dust.
- **Reaction-diffusion (Gray-Scott)** — coral, fingerprints, zebra stripes. Two chemicals, feed/kill parameters; small parameter shifts = wildly different textures.
- **Circle / rectangle packing** — fill space without overlap by growing shapes until they touch. Reads as "designed" instantly. Pair with palette sampling.
- **Recursive subdivision** — split a rectangle, recurse on the pieces with a probability. Mondrian-adjacent; the foundation of a thousand strong pieces.
- **Voronoi / Delaunay** (via `d3-delaunay`) — cellular, cracked-earth, stained-glass looks.
- **L-systems** — string-rewriting turtle grammars for plants, trees, fractals.
- **Dithering** — the deliberately-lo-fi look. **Atkinson** (Mac-classic, high contrast, leaves whites clean), **Floyd–Steinberg** (smooth error diffusion), **Bayer/ordered** (regular cross-hatch grid). Constrain to a 2–4 color palette for a risograph/GameBoy feel.

### Seeded randomness = reproducibility (non-negotiable for real work)
If you can't regenerate the exact image, you can't sell it, print it, or iterate on "that one from Tuesday." Seed everything. In p5: `randomSeed(s); noiseSeed(s);`. For platform work (fxhash, Art Blocks), the seed comes from the mint token — derive a PRNG from it:

```js
// mulberry32: tiny, fast, seedable — the community default for deterministic sketches
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rand = mulberry32(hashToInt(fxhash));   // same token -> same artwork, forever
```

### Color harmony & output aesthetics
- **Work in OKLCH, not HSL.** Perceptually uniform lightness means a generated ramp actually *looks* evenly stepped. Use p5 2.x's OKLCH mode, or **culori** / **chroma.js** in plain JS. Generate palettes by rotating hue at fixed L/C (analogous), or ±180° (complementary).
- **Pen-plotter / AxiDraw aesthetic** — no fills, only strokes; the beauty is in *line economy* and hatching. Export SVG, then run it through **vpype** (`vpype read in.svg linemerge linesort write out.svg`) to merge/sort paths so the pen lifts as little as possible. Community: drawingbots.net.
- **Risograph** — 2–4 spot inks, slight mis-registration, overprint multiply blends, coarse halftone/dither. Fake it: offset each color layer 1–2px and blend with `multiply`.

---

## Part 2 — Terminal / TUI art

A TUI has everything a GUI has — palette, type scale, spacing, hierarchy — compressed into a monospace grid. The failure mode isn't ugliness, it's *thoughtlessness*: raw white text, default spinners, no alignment. Restraint is the whole game; a terminal that uses **two accent colors and real alignment** already beats 95% of CLIs.

### The libraries, by language
- **Rust: ratatui** (0.29+, modularized at 0.30 with `ratatui-crossterm` split out) + **crossterm** backend. The serious choice for full-screen apps — widgets, layout constraints, immediate-mode redraw.
- **Go: Charm's v2 stack** — **Bubble Tea** (Elm-architecture runtime), **Lip Gloss** (CSS-like styling), **Bubbles** (prebuilt widgets), plus **Huh** (forms), **Gum** (style shell scripts with zero Go), **Glamour** (render Markdown in the terminal), **Wish** (serve TUIs over SSH). This ecosystem sets the current visual bar for terminal apps.
- **Python: Rich** (styled print, tables, syntax, progress) and **Textual** (full app framework, and it can now serve the same app to a browser via textual-web).
- **JS/TS: Ink** (React for CLIs — compose with components), **Chalk 5** (ESM colors), **@clack/prompts** (the best-looking prompt flows), **ora** (spinners), **gradient-string**, **boxen**, **cli-progress**, **Listr2** (task trees). Note: **blessed** is legacy/unmaintained — prefer Ink for new work.

### Truecolor: you have 16 million colors, use ~5
Modern terminals support 24-bit color. The escape is `\x1b[38;2;R;G;Bm` (foreground) / `48;2` (background). But treat the palette like a design system, not a crayon box: one background tone, one dim/muted for secondary text, one primary accent, one success/one error. That's it.

```python
# Rich: define a theme once, never hand-write escapes again
from rich.console import Console
from rich.theme import Theme
c = Console(theme=Theme({"ok":"bold #3ddc84","warn":"#e0aa3e","dim":"grey58","accent":"#7aa2f7"}))
c.print("[dim]build[/]  [accent]web[/]  [ok]✓ done[/] [dim]1.2s[/]")
```

### Gradients in text — tasteful, not rainbow-vomit
Interpolate fg color per character across **one** hue sweep (e.g. blue→cyan), reserved for a title or logo — never body text.

```js
import gradient from 'gradient-string';
console.log(gradient(['#4361ee', '#4cc9f0'])('◆ MYAPP  v2.0'));  // one banner, done
```

### Box-drawing, Unicode & sparklines
- **Box-drawing:** `╭─╮ │ ╰─╯` (rounded) reads softer and more modern than sharp `┌┐└┘`. Lip Gloss and Rich both do bordered panels for you — use them instead of hand-aligning.
- **Braille (U+2800–28FF)** packs a 2×4 dot grid into one cell — the trick behind high-res terminal plots (see `plotille`, `asciichart`, ratatui's canvas). 8× the vertical resolution of block chars.
- **Sparklines:** `▁▂▃▄▅▆▇█` map a value to a bar height inline. One line, instantly legible:

```python
def spark(xs):
    bars = "▁▂▃▄▅▆▇█"; lo, hi = min(xs), max(xs); rng = hi - lo or 1
    return "".join(bars[int((x-lo)/rng*7)] for x in xs)
# spark([3,9,4,8,12,5,15]) -> "▁▄▁▃▆▂█"
```

### Spinners & progress — signal, don't decorate
Pick a spinner that matches the app's weight (dots for calm, `cli-spinners` has ~80). Cardinal rule: **show real progress when you know the total** (a bar), an indeterminate spinner only when you genuinely don't. A fake progress bar is a lie the user feels. Pair the spinner with a *changing* status line so it never looks hung, and always leave a clean final state (`✓`/`✗` + elapsed), not a spinner frozen mid-frame.

### Restraint checklist
Align columns to a grid. Left-align labels, right-align numbers (tabular). Dim everything that isn't the point. One accent color carries emphasis. Degrade gracefully: check `NO_COLOR` and non-TTY (`isatty`) and drop to plain text — piping into a file should never spew escape codes.

---

## Part 3 — Data-visualization design (composes with the `dataviz` skill)

**Read the existing `dataviz` skill first** — it owns the categorical/sequential/diverging palette system, the light+dark contrast validator, and mark specs. Do **not** duplicate that here. This section is the *visual-craft finish* that goes on top of a correct palette.

### Typography is half of a good chart
- **Tabular/lining figures** for all numbers (`font-variant-numeric: tabular-nums`) so digits align in columns and axes.
- **Direct-label the last point instead of a legend.** A legend forces a saccade between key and line; a label at the line's end is read in place. This single change makes multi-series line charts feel professional.
- Establish a type hierarchy: title (largest, high-contrast) → axis labels (small, muted) → tick labels (smallest, muted). Kill chartjunk: no bold gridlines, no drop shadows, no 3D, ever.

### The emphasized endpoint
End a line with a filled dot and its value. It answers "where did it end up?" — usually the actual question — without a tooltip.

```jsx
// Recharts: label + dot only at the final point
<Line dataKey="revenue" stroke="var(--accent)" dot={false}
      strokeWidth={2}
      label={({index,x,y,value}) =>
        index === data.length-1
          ? <text x={x+8} y={y} fontSize={12} fontVariantNumeric="tabular-nums"
                  fill="var(--accent)" dominantBaseline="middle">{value}</text>
          : null} />
```

### Area fills & honest axes
- **Area fills:** a low-alpha vertical gradient under a line adds weight without shouting. Fade to transparent at the bottom (`stop-opacity: 0.25` → `0`). Never fill a *multi*-series line chart — the overlaps turn to mud; use faint fills only for a single hero series.
- **Honest axes, the two rules that matter:** bar charts **must** start at zero (bar length encodes magnitude — truncating it lies). Line charts **need not** — they encode *change*, so a zoomed y-range is legitimate and often clearer. Never invert or use dual y-axes to manufacture a correlation.

### Palettes legible in both themes
Test every categorical color against **both** the light and the dark background. A yellow that pops on charcoal vanishes on white. The robust move: keep hue+chroma, and let the `dataviz` validator nudge lightness per theme — or drive colors from CSS custom properties that flip with the theme, so one chart definition serves both:

```css
:root            { --series-1: oklch(0.55 0.18 250); --grid: oklch(0.9 0 0); }
:root[data-dark] { --series-1: oklch(0.72 0.16 250); --grid: oklch(0.3 0 0); }
```

### Animated & transitioning charts (timing lives in motion-and-animation.md)
Animate to *reveal structure*, not to entertain. Stagger a bar grow-in by index, or interpolate between two datasets on filter change so the reader tracks what moved. In D3, `.transition()` on `attr("height"/"y")`; in Recharts, `isAnimationActive` with a per-series `animationBegin` stagger. **Always animate positional/size encodings, never color** (a hue mid-morph is meaningless). Defer easing curves and durations to the motion file.

### Tools, by control needed
- **Observable Plot** — first choice for exploratory and most production charts: a **marks** grammar (`Plot.line`, `Plot.dot`, `Plot.areaY`) built on D3 by the D3 team. A histogram is one line, not fifty.
- **D3** — drop down only when you need bespoke, fully-custom, or heavily-interactive visuals. Complete control, real cost.
- **Recharts** (composable React, fast to ship) / **visx** (Airbnb — D3 math + React rendering, more control) / **Bklit** (from the mandated UI stack — reach for its chart components before hand-rolling).
- **Python:** matplotlib is only ugly by *default* — ship a house `rcParams`/style sheet (muted grid, tabular fonts, no top/right spines) and it's clean. **plotly** for interactivity (set a custom `template`), **Vega-Lite**/**ECharts** for declarative dashboards.

---

## Generative / TUI / dataviz slop to recoil from

- **`Math.random()` with no seed.** You get one output you can never reproduce, iterate on, or ship. Seed it (p5 `randomSeed()`, a small PRNG, `noise()` with a fixed offset) so a good frame is a *result*, not an accident.
- **Rainbow hue-cycling as the palette.** `hue = frameCount % 360` and full-saturation HSL is the generative equivalent of Comic Sans. Pick 3–5 colors (Lospec, a Cooler ramp, a photograph) and stay in them.
- **Perlin noise field + particle trails, again.** The default "generative art" output. The noise is fine; the problem is no *composition* — no focal point, no negative space, no scale contrast. Decide where the eye goes before you decide the algorithm.
- **Rainbow 16-color ANSI in a TUI.** Terminals inherit a *user's* theme. Use the 16 semantic slots (or truecolor sparingly), respect `NO_COLOR`, and never encode meaning in color alone — the reader may be on a light background, colorblind, or piping to a file.
- **Box-drawing everywhere.** A border around every panel is the TUI version of `rounded-lg` on every card. Space and alignment separate regions more cleanly than lines do.
- **Charts with default everything.** Auto legend, no emphasized series, categorical rainbow for ordinal data, a truncated y-axis that exaggerates a trend, and a title that names the columns instead of the finding. Say what the chart *found* in the title; grey out everything that isn't the point.

## Part 4 — ASCII/pixel art & demoscene (inspiration)
- **Image → terminal:** **chafa** (best truecolor+symbol quality), **viu**, **timg**. Great for CLI splash art and previews.
- **Pixel art:** **Aseprite** is the standard tool; pull palettes from **Lospec** (thousands of curated, constraint-driven palettes — a 4-color GameBoy ramp forces better decisions than 16M colors). **PICO-8**'s fixed 16-color palette is a masterclass in why constraint breeds style.
- **Demoscene** — the origin of "maximum beauty per byte." Study **shadertoy** (fragment-shader craft), **bytebeat** (music from one line of C), sizecoding (256-byte/4KB intros like `.kkrieger`), and Revision/Assembly party releases. The lesson that transfers everywhere: **constraint is a creative engine, not a limitation.** Every domain above gets better when you cap the palette, cap the code, and let density and restraint do the work.
