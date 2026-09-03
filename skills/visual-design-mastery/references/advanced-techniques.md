# Advanced techniques — the ceiling, and how to get above it

The slop lint names what a piece should not have. This names what it does not have.

A page can carry no fingerprint at all — no purple gradient, no glass card, no centred hero —
and still be built entirely from flexbox, `border-radius`, a hex colour and a 300 ms transition.
That page is not bad. It is **conventional**, and conventional is the ceiling almost all
generated work sits at, because the model reaches for the capability it has seen most, and what
it has seen most is 2015 CSS.

Each entry says what it *unlocks* — the thing that is impossible without it — because a
technique adopted for its own sake is decoration, and decoration is the failure mode this file
could otherwise cause.

**Support is stated per entry, and most of this is cross-engine.** Five are not, and they are
the ones people reach for first, so they are named here rather than buried:

| Not everywhere | State | What you must do |
|---|---|---|
| `hanging-punctuation` | **Safari only.** No Chrome, no Firefox, no Edge. | Treat as a bonus. Never let the measure depend on it. |
| `initial-letter` | **No Firefox.** Partial in Chrome/Safari/Edge. | `@supports (initial-letter: 3)`, and a paragraph that reads without the cap. |
| `text-wrap: pretty` | **No Firefox.** (`balance` IS cross-engine.) | Free to use; it degrades to normal wrapping. Do not rely on it to kill widows. |
| anchor positioning | Chrome/Edge/Safari current; **Firefox partial**. | Newly Baseline. A tooltip with no fallback is an unpositioned element, not a degraded one — keep a JS or static path. |
| scroll-driven animation | Chrome/Edge/Safari; **Firefox only very recently**. | Without a timeline, `animation: … both` runs immediately at load. Gate it in `@supports (animation-timeline: view())`. |

Paint worklets are Chromium-only — Firefox does not implement them and Safari ships the API
disabled — so treat `paint()` as an enhancement over a real background, never as the background.

`cgc techniques <file>` reports which of these a piece reaches for and which it never tried, and
knows nine further media besides this one.
Four used with intent beat twelve sprinkled on. Zero means it was assembled.

---

## 1. Colour that derives instead of being pasted

### oklch — the only colour space where a ramp is even

sRGB hex lies about lightness: `#0000ff` and `#ffff00` are nowhere near the same brightness, and
a "10% darker" hex is a guess. oklch is perceptually uniform, so **lightness is a real number**.

```css
:root {
  --ink:    oklch(0.22 0.02 260);
  --paper:  oklch(0.97 0.01 90);
  --signal: oklch(0.62 0.19 32);
  /* A ramp that actually steps evenly — vary L only, hold C and H. */
  --ink-1: oklch(0.32 0.02 260);
  --ink-2: oklch(0.44 0.02 260);
  --ink-3: oklch(0.58 0.02 260);
}
```

Two hues at the same `L` genuinely match in weight — which is what makes a multi-hue palette
feel like one family rather than a set of stickers. **Unlocks:** a palette with a system behind
it, and dark mode by flipping L rather than by re-picking every colour.

### Relative colour — one source, every variant

```css
.card {
  --base: var(--signal);
  background: oklch(from var(--base) 0.97 0.03 h);   /* same hue, near-white tint */
  border-color: oklch(from var(--base) calc(l - 0.12) c h);
  color: oklch(from var(--base) 0.28 0.06 h);
}
```

**Unlocks:** changing one token and having every state, border, tint and hover follow. The
alternative — a new hex per state — is why generated palettes drift.

### color-mix — the pragmatic half

```css
border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
background: color-mix(in oklab, var(--signal) 8%, var(--paper));
```

Better than `opacity` on a border, because it does not fade the content inside.

### @property — the only way to animate a gradient

Custom properties are strings to the animation engine unless you type them. This is why every
generated "animated gradient" is a `background-position` hack.

```css
@property --angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@property --stop  { syntax: '<percentage>'; initial-value: 20%; inherits: false; }

.sweep {
  background: conic-gradient(from var(--angle), var(--signal), var(--paper) var(--stop), var(--signal));
  transition: --angle 900ms cubic-bezier(.2,.8,.2,1), --stop 900ms cubic-bezier(.2,.8,.2,1);
}
.sweep:hover { --angle: 180deg; --stop: 70%; }
```

**Unlocks:** gradient angles, stops, colour ramps and any custom numeric that drives layout,
all genuinely interpolatable. Also gives every custom property a type, an initial value and
inheritance control, which turns a token file into an API.

### display-p3 — colour that does not exist in sRGB

```css
.signal { color: #e2452a; }
@supports (color: color(display-p3 1 0 0)) {
  @media (color-gamut: p3) { .signal { color: color(display-p3 0.92 0.24 0.12); } }
}
```

**Unlocks:** a signal colour with nowhere to hide on a wide-gamut display — most recent Apple
hardware and better Android and desktop panels, but far from all of them, and many current
monitors are sRGB only. Which is why the sRGB value above it is the design and this is the
bonus, never the other way round.

---

## 2. Type that was set, not scaled

### Variable axes past weight

Most variable fonts ship three to six axes and almost every usage animates only `wght`.

```css
/* Automatic: opsz tracks font-size. This is the default, so it is worth writing only to
   restate it, or to switch it off. */
p  { font-family: 'Fraunces', serif; font-optical-sizing: auto; }

/* Deliberate: opsz is set by hand, for a display cut that should NOT follow the size. */
h1 { font-family: 'Fraunces', serif; font-variation-settings: 'opsz' 144, 'SOFT' 40, 'WONK' 1; }
```

**These two do not combine.** `font-variation-settings` overrides the basic property for the same
axis wherever it appears in the cascade, so `'opsz' 144` next to `font-optical-sizing: auto` pins
the display cut at 144 and the `auto` does nothing — including on a phone, where every heading
then renders at the poster cut. Choose one per rule.

**Registered axes** — five, all lowercase, and the only ones you can assume: `wght` weight,
`wdth` width, `opsz` optical size, `slnt` slant, `ital` italic.

**Custom axes** are per family, uppercase by convention, and setting one on a font that does not
have it **fails silently** — no error, no console warning, no visible difference:

| Axis | What it does | Families that actually have it |
|---|---|---|
| `GRAD` | grade: weight without changing metrics, so a line does not re-wrap | Roboto Flex, Roboto Serif, a few Google families |
| `SOFT` | softens the terminals | Recursive, Fraunces |
| `CASL` | casual ↔ formal | Recursive |
| `MONO` | proportional ↔ monospace | Recursive |
| `WONK` | swaps in the wonky glyphs | Fraunces |

Grade is the one worth knowing — it is how dark-mode text stops looking fat without any layout
moving — but check the family exposes it before relying on it, because nothing will tell you.

**Unlocks:** one family behaving as a whole typographic system. Grade in particular is how you
keep dark-mode text from looking fat without changing the layout.

### OpenType features nobody switches on

```css
.figures  { font-variant-numeric: tabular-nums slashed-zero; }   /* tables, timers, prices */
.editorial{ font-variant-numeric: oldstyle-nums proportional-nums; }
.display  { font-feature-settings: 'ss01' 1, 'dlig' 1, 'swsh' 1; }
.caps     { font-variant-caps: all-small-caps; letter-spacing: .06em; }
```

**Unlocks:** the character the type designer drew and shipped. `ss01` on a good face is often a
completely different `a` or `g` — a free change of voice.

### Trimming the box to the letters

```css
h1 { text-box: trim-both cap alphabetic; }   /* or the older leading-trim/text-edge pair */
```

**Unlocks:** headings whose spacing is measured from the letterforms, not from the line box.
This is the single most common reason generated layouts feel loose at the top of a section.

### Fluid scale, once

```css
:root {
  --step-0: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --step-3: clamp(2rem, 1.4rem + 3vw, 4rem);
  --step-5: clamp(3rem, 1.6rem + 7vw, 8rem);
}
h1 { font-size: var(--step-5); line-height: 0.92; letter-spacing: -0.03em; text-wrap: balance; }
p  { font-size: var(--step-0); line-height: 1.55; text-wrap: pretty; max-width: 62ch; }
```

Tracking is a function of size: display sizes want negative tracking (−0.02 to −0.04em), caps
labels want positive (+0.08 to +0.16em). A scale that changes size without changing tracking is
the tell of type that was scaled rather than set.

### Editorial devices that cost one rule

```css
/* vertical-rl is cross-engine. The other two are not — see the support table at the top. */
.spine { writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: .2em; }

@supports (initial-letter: 3) {
  .article p:first-of-type::first-letter { initial-letter: 3 2; margin-right: .08em; font-family: var(--display); }
}
/* Safari only. A bonus when it lands, never something the measure depends on. */
.pull { hanging-punctuation: first last; }
```

---

## 3. Structure that is not a stack of rectangles

### Deliberate overlap — the fastest way out of the centroid

Every generated layout is boxes in a column. One element breaking its box changes the whole
read, and it costs three lines:

```css
.spread { display: grid; grid-template-columns: repeat(12, 1fr); }
.figure { grid-column: 1 / 8;  grid-row: 1; }
.panel  { grid-column: 6 / 13; grid-row: 1; margin-top: 12vh; z-index: 1; }  /* overlaps by 2 cols */
```

Both children occupy `grid-row: 1`, so they share the cell and overlap. **Unlocks:** depth and
an editorial read with no extra markup. The rule of thumb: overlap by 10–20% of the smaller
element, and let the type cross the image edge, not just sit near it.

### Container queries — a component that knows its own size

```css
.card-host { container-type: inline-size; container-name: card; }
@container card (min-width: 34rem) {
  .card { grid-template-columns: 12rem 1fr; align-items: start; }
  .card h3 { font-size: var(--step-2); }
}
```

**Unlocks:** one component correct in a sidebar, a grid and a full-width hero, with no variant
props. Viewport media queries cannot express this and never could.

### Subgrid — shared baselines across cards

```css
.row  {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));  /* without this there is no ROW */
  grid-template-rows: auto auto 1fr auto;
}
.card { display: grid; grid-row: span 4; grid-template-rows: subgrid; }
```

The columns are the part that is always forgotten. A `.row` with only `grid-template-rows` has
one implicit column, every card auto-places into it, and they stack — which looks like subgrid
being unsupported and is actually the grid having no row to align across.

**Unlocks:** every card's title, body and footer aligning across the row even with different
content lengths. The ragged card row is the most common generated-layout defect there is.

### :has() — style from the children up

```css
.field:has(input:invalid:not(:placeholder-shown)) { --edge: var(--warn); }
.card:has(img) { grid-template-columns: 8rem 1fr; }
.page:has(dialog[open]) { overflow: hidden; }
```

### Anchor positioning — no library for a tooltip

```css
.trigger { anchor-name: --t; }
.tip { position: fixed; position-anchor: --t; position-area: block-start center;
       margin-bottom: .5rem; position-try-fallbacks: flip-block; }
```

---

## 4. Surface — texture, edge and light

### Masks: the alternative to another card

The default answer to "this needs separation" is a box with a background. A mask gives an edge
that is not a rectangle at all.

```css
/* Type or image fading out — no gradient overlay div. */
.fade { -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent); mask-image: linear-gradient(to bottom, #000 60%, transparent); }
/* A reveal that wipes rather than fades. */
.wipe { mask-image: linear-gradient(75deg, #000 50%, transparent 50%); mask-size: 300% 100%; mask-position: 100% 0; transition: mask-position 700ms cubic-bezier(.2,.8,.2,1); }
.wipe:hover { mask-position: 0 0; }
/* Text knocked out of an image. */
.knockout { background: url(photo.jpg) center/cover; -webkit-background-clip: text; background-clip: text; color: transparent; }
```

### Blend modes — ink that reacts to what is under it

```css
.headline { mix-blend-mode: difference; color: #fff; }   /* inverts against the backdrop */
.ink      { mix-blend-mode: multiply; }                  /* overlapping shapes behave like real ink */
.duotone  { background-blend-mode: luminosity; background-color: var(--signal); background-image: url(photo.jpg); }
```

**Unlocks:** a headline that crosses an image and inverts instead of sitting in a box; two-colour
printing behaviour on screen.

**It guarantees inversion, not contrast.** `difference` computes |backdrop − source|, so white
over a mid-grey `#808080` gives `#7f7f7f` — the headline disappears into exactly the mid-tones a
photograph is mostly made of. Use it where the backdrop is dark or light, not where it is
neither, and keep a scrim for the general case.

### Real grain, generated

Stock "noise.png" overlays are a fingerprint. This is a filter, weighs nothing, and scales:

```html
<svg width="0" height="0" aria-hidden="true">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.42"/></feComponentTransfer>
  </filter>
</svg>
```
```css
.grain::after { content:''; position:absolute; inset:0; filter: url(#grain); opacity:.28; mix-blend-mode: overlay; pointer-events:none; }
```

Related: `feDisplacementMap` driven by turbulence for a torn or liquid edge; `feColorMatrix` for
a true duotone; `feDropShadow` for a shadow that follows an alpha silhouette rather than a box.

### Edges that are not horizontal

```css
.section { clip-path: polygon(0 0, 100% 3vw, 100% 100%, 0 calc(100% - 3vw)); }
.blob    { clip-path: path('M0,60 C0,20 40,0 90,0 ...'); }
```

### Shadows that look like light

One `0 4px 20px rgba(0,0,0,.1)` is the giveaway. Real falloff is layered, and the tint carries
the environment:

```css
--lift:
  0 1px 1px  color-mix(in oklab, var(--ink) 5%, transparent),
  0 2px 4px  color-mix(in oklab, var(--ink) 5%, transparent),
  0 6px 12px color-mix(in oklab, var(--ink) 6%, transparent),
  0 14px 28px color-mix(in oklab, var(--ink) 7%, transparent);
```

---

## 5. Motion the platform gives you free

### Scroll-driven animation — no listener, no library

```css
@keyframes rise { from { opacity: 0; transform: translateY(2rem) } to { opacity: 1; transform: none } }
@supports (animation-timeline: view()) {
  .reveal {
    animation: rise linear both;
    animation-timeline: view();
    animation-range: entry 10% cover 35%;
  }
}
@media (prefers-reduced-motion: reduce) { .reveal { animation: none } }
```

The `@supports` gate is not optional here. Without a timeline, `animation: rise … both` is an
ordinary animation: it runs once, immediately, at load — so every element on the page reveals
itself at the same moment and nothing is tied to the scroll at all.

Runs on the compositor, so it cannot jank the way a scroll handler does. `scroll()` ties to the
scroller's own progress — a reading progress bar is four lines with no JS.

### View Transitions — the most modern-feeling move available

```css
.hero-img { view-transition-name: hero; }
::view-transition-old(hero), ::view-transition-new(hero) { animation-duration: 420ms; }
```
```js
if (document.startViewTransition) document.startViewTransition(() => applyNewState())
else applyNewState()
```

**Unlocks:** an element that *morphs* from one state or route to the next. Everything else
crossfades; this is the difference people describe as "native".

### Entry animation for things that did not exist

```css
dialog[open] { opacity: 1; translate: 0 0; }
dialog { opacity: 0; translate: 0 1rem;
         transition: opacity 240ms, translate 240ms, overlay 240ms allow-discrete, display 240ms allow-discrete; }
@starting-style { dialog[open] { opacity: 0; translate: 0 1rem; } }
```

**Unlocks:** popovers and dialogs that animate in as well as out, which previously required JS.

### Movement along a path

```css
.dot { offset-path: path('M10,80 C80,10 220,10 290,80'); offset-rotate: auto;
       animation: travel 3s cubic-bezier(.4,0,.2,1) infinite; }
@keyframes travel { to { offset-distance: 100% } }
```

### Stagger without a library

```css
.item { animation: rise 420ms cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 45ms); }
```

45 ms between children, 400 ms each: the eye is led to the last one. Everything arriving at once
is a flash, not choreography.

> Whatever you build here, **watch it**: `cgc motion <file> --duration <ms>`. The measured curve,
> not the keyword, is the animation. See `motion-and-animation.md`.

---

## 6. Interaction surfaces most work never draws

```css
:focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; border-radius: 2px; }
::selection    { background: var(--signal); color: var(--paper); }
:root          { accent-color: var(--signal); caret-color: var(--signal); color-scheme: light dark; }
```

Native `popover` and `<dialog>` put an element in the top layer with light dismiss and focus
handling for free — the alternative is a div, a z-index war and a focus trap you will get wrong.

```html
<button popovertarget="menu">Menu</button>
<div id="menu" popover>…</div>
```

---

## How to use this file

1. Decide the idea first. `creative-divergence` produces the concept; this file does not.
2. Ask which **one or two** techniques the idea actually requires. A piece about layers wants
   blend modes; a piece about precision wants tabular figures and a real grid; a piece about
   material wants grain and a mask.
3. Let the technique change the **structure**, not the surface. If it could be deleted and the
   piece would read the same, it was decoration.
4. Run `cgc techniques <file>` and `cgc lint <file>`. The first says whether anything was
   reached for; the second says whether the defaults crept back.
5. Everything here degrades: `@supports` around the ones that carry meaning, and a floor that is
   still a designed page.

---

## The other media

This file is the web set. `cgc techniques` knows nine more, each measured against its own
vocabulary rather than against CSS, and each with a reference beside this one:

| Medium | Where the craft is |
|---|---|
| SVG, canvas, generative, terminal, data-viz | [`generative-creative-tui-dataviz.md`](generative-creative-tui-dataviz.md) |
| Shaders and the GPU | [`shaders-and-gpu.md`](shaders-and-gpu.md) |
| 3D scenes | [`shaders-and-gpu.md`](shaders-and-gpu.md) and the `threejs-webgl` / `react-three-fiber` skills |
| Native and mobile UI | [`native-and-mobile.md`](native-and-mobile.md) |
| Games and engines | [`games-and-engines.md`](games-and-engines.md) |
| Print and physical | [`print-and-physical.md`](print-and-physical.md) |
| Anything that moves | [`motion-and-animation.md`](motion-and-animation.md) |

And a medium none of them covers is added as data, not code: drop JSON at
`<project>/.cgc/techniques.json` or `~/.claude/techniques.json` and `cgc techniques --media`
will list it alongside the rest.
