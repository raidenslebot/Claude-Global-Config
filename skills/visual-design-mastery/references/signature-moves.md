# Signature moves — the vocabulary, with the numbers

The creed says "make one decision only this project would make". This is the list of decisions
that exist to be made, each with the parameters that make it work and the case where it is
wrong. It is a vocabulary, not a menu: **one hero move per piece**, chosen because the subject's
DNA (`creative-divergence` Step 1) points at it, with everything else quiet. Two hero moves
fight. Five is a template with effects on it.

Every face named here is free (Google Fonts unless marked *Fontshare*), so there is never a
reason to fall back to Inter. Load with `<link href="https://fonts.googleapis.com/css2?family=…&display=swap">`
or self-host; `cgc render` names any @font-face that failed to load. See a pairing and a
palette set for real before choosing: `cgc specimen --display "Fraunces:ital,opsz,wght,SOFT,WONK@1,9..144,300,0..100,0..1"
--text Archivo --mono "JetBrains Mono" --palette "oklch(0.97 0.012 80),oklch(0.22 0.02 60),oklch(0.55 0.17 25)"`
renders the display line, the text at reading size, the pairing reversed, and every colour with its contrast
against the surface and the ink. Google Fonts serves only the axes the URL requests — an axis left out
of the request is pinned at its default, and `font-variation-settings` for it does nothing.

**The ambition floor:** a finished piece carries at least one move from *Layout*, *Material*
or *Motion* — not type and colour alone. Type and colour dress a structure; they do not make one.

---

## Type — the highest-leverage decision on any screen

### Faces with a point of view

| Voice | Face | The move |
|---|---|---|
| Editorial, warm | **Fraunces** (opsz 9–144, SOFT, WONK axes) | italic at `wght 300`, `opsz 144`, huge. The most characterful free serif. |
| Modern review | **Instrument Serif** (one weight + italic) | display only, at ≥ 48px; pair with Instrument Sans |
| Literary | **Newsreader** (opsz) | body at 18–20px with `opsz` auto; display italic |
| High contrast, fashion | **Bodoni Moda** (opsz 6–96); **Abril Fatface** (a Didone fat face) | `wght 900` at `opsz 96`, tight leading, one word |
| Light, archival | **Cormorant Garamond** | `wght 300` at 8–12vw; never for body |
| Loud serif | **Young Serif**, **Gloock**, **DM Serif Display** | one line, one size |
| Grotesque with wobble | **Bricolage Grotesque** (opsz, wdth 75–100) | `wght 800 wdth 75` display; the wobble is in the opsz |
| Extended, gallery | **Syne** (`wght 800` is extended) | all-caps at 3–5vw, tracked 0.02em |
| Whole family in one file | **Archivo** (wdth 62–125, wght 100–900) | narrow display + regular text from ONE face |
| Width as the instrument | **Anybody** (wdth 50–150) | animate or step `wdth` per line |
| Clean text | **Instrument Sans**, **Hanken Grotesk**, **Onest**, **Schibsted Grotesk**, **Familjen Grotesk**, **Geist** | body; never as the only face on the page |
| Signage, industrial | **Big Shoulders Display** (wght 100–900; the newer consolidated **Big Shoulders** adds opsz 10–72) | `wght 900` condensed caps at extreme size |
| Mono with character | **JetBrains Mono**, **IBM Plex Mono**, **Azeret Mono** (wght 100–900), **Martian Mono** (wdth), **Fragment Mono**, **Geist Mono** | values, ledgers, labels; a mono as *display* is a move only when the subject is code or machinery |
| Slab, poster | **Alfa Slab One**, **Ultra**, **Chango** | one word; never below 64px |
| Shaded / display oddities | **Bungee** (+ Bungee Shade), **Rubik Mono One**, **Monoton** | a wordmark, never running text |
| *Fontshare* | **Satoshi**, **General Sans**, **Clash Display**, **Cabinet Grotesk**, **Zodiak** | contemporary; Clash Display for the big word |

**Overused now, flag before using:** Inter, Space Grotesk, Playfair Display + Montserrat,
Poppins, Bebas Neue, Oswald, Manrope, DM Sans, Plus Jakarta Sans. Not banned; no longer a decision.

### Pairings that hold

1. **Fraunces italic 300 + Archivo** — editorial with warmth. Body Archivo 400 at 18px/1.55.
2. **Instrument Serif + Instrument Sans** — the modern magazine. Serif only above 40px.
3. **Bricolage Grotesque 800 wdth 75 + Newsreader** — technology written about like literature.
4. **Syne 800 + IBM Plex Mono** — a festival, a gallery, a label.
5. **Bodoni Moda 900 + Hanken Grotesk** — fashion, luxury, one photograph.
6. **Big Shoulders Display 900 + Azeret Mono 300** — industrial, signage, a warehouse.
7. **Cormorant Garamond 300 + Martian Mono** — an archive, a catalogue raisonné.

Never both faces from one family, never the same face at two weights as "the pairing", never
Inter-on-Inter.

### Settings that make a face sing

```css
/* Display: tight, tracked negative, optical size at maximum, balanced. */
.display {
  font-size: clamp(3rem, 12vw, 14rem);
  line-height: 0.88;                         /* 0.82–0.95 at display; never 1.2 */
  letter-spacing: -0.035em;                  /* -0.02 to -0.05em above 64px */
  font-optical-sizing: auto;
  font-variation-settings: "opsz" 144, "SOFT" 40;   /* Fraunces — SOFT and WONK act only if the font URL requested them */
  text-wrap: balance;
  hanging-punctuation: first;                /* Safari only as of 2026; harmless elsewhere */
}
/* Caps labels: small, tracked wide, never bold. */
.label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 500; }
/* Body: a real measure and a real scale. */
p { max-width: 66ch; line-height: 1.55; text-wrap: pretty; }
:root { --s-1: 0.8rem; --s0: 1rem; --s1: 1.25rem; --s2: 1.563rem; --s3: 1.953rem; --s4: 2.441rem; } /* ×1.25 */
/* Figures: tabular in ledgers and tables, proportional in prose; real small caps when present. */
.ledger { font-variant-numeric: tabular-nums; font-feature-settings: "tnum", "case"; }
.sc { font-variant-caps: all-small-caps; letter-spacing: 0.06em; }
```

### Type moves

- **The one enormous word.** 14–18vw, `line-height: 0.8`, clipped by the viewport edge on
  purpose (`overflow: hidden` on the section, the word wider than it). The page is the word.
  Wrong for: anything with more than one message.
- **The hanging italic.** A display italic at `wght 300`, 8–10vw, with a 66ch paragraph in the
  text face *hung from its baseline* (grid, `align-items: baseline`). The tension between the
  two weights is the design.
- **Numerals as the hero.** The number IS the message — `34`, `0`, `4.4×` — at 20vw in
  tabular figures, the words at 1rem beside it. Wrong when the number is not real.
- **The running caps line.** One uppercase line, 11px, tracked 0.2em, repeated as a rule
  between sections or scrolled as a marquee. Carries the vernacular ("Fridays · 7 till late").
- **Vertical type on the spine.** `writing-mode: vertical-rl` at the page edge — a label on a
  book spine. One line, once.
- **The drop line.** The first line of body set in small caps (`::first-line`), the way a
  chapter opens. Free, and almost no one does it on a screen.
- **Width as rhythm.** One variable face stepped through `wdth` per line (Anybody, Archivo):
  the block reads as a poster, not a paragraph.
- **The wordmark leaves as paths.** Anything set in a face and sent to a shop, a cutter or an
  embroiderer goes as outlines: `cgc outline --font "<family:axes>" --text "…"
  --out mark.svg` — one `<path>`, the font's own kerning, the viewBox at the ink. Customise
  the letterforms from there; never ship live text.

---

## Colour — from the subject, in OKLCH, three roles

**The method.** Neutrals with a hue (chroma 0.004–0.022 through the whole ramp — warm ink at
H≈60–80, cool slate at H≈250–265). One dominant surface (≈60–70% of area), one supporting
(≈25–35%), one **signal** at ≤ 5% — used *once* where the eye must land. The signal's hue comes
from the subject's own artifacts (`design-tokens` measures it); the surface's temperature
comes from the material the subject is made of. Dark mode is not inversion: lift the surface
to L≈0.20–0.24, lower every chroma by a third, and make hairlines translucent white.

**Palettes that are not the defaults** — starting points with a rule each:

| Name | Surface | Ink | Signal | The rule |
|---|---|---|---|---|
| **Ink on paper** | `oklch(0.97 0.012 80)` | `oklch(0.22 0.02 60)` | `oklch(0.55 0.17 25)` | signal only on the correction, the price, the one word |
| **Ultramarine & chalk** | `oklch(0.30 0.12 265)` | `oklch(0.96 0.01 80)` | `oklch(0.80 0.16 75)` | dark that is *blue*, not black; amber once |
| **Riso** | `oklch(0.94 0.02 85)` | `oklch(0.35 0.10 265)` | `oklch(0.70 0.19 40)` | two inks, `mix-blend-mode: multiply` where they cross, nothing else |
| **Bottle & brass** | `oklch(0.30 0.06 160)` | `oklch(0.93 0.015 90)` | `oklch(0.76 0.10 85)` | brass as hairlines only |
| **Clay** | `oklch(0.93 0.025 70)` | `oklch(0.35 0.05 40)` | `oklch(0.62 0.12 45)` | everything within 40° of one hue |
| **Slate & saffron** | `oklch(0.93 0.01 250)` | `oklch(0.24 0.02 250)` | `oklch(0.80 0.16 85)` | saffron on the number, never on text |

Every value above sits inside sRGB (a chroma past the gamut is silently mapped by the browser to
a colour you did not choose — at L 0.70, h 40 the ceiling is about 0.197; at L 0.80, h 85 about
0.163). `specimen` shows the colour that will actually render.
| **Blackboard** | `oklch(0.24 0.03 150)` | `oklch(0.93 0.01 90)` | `oklch(0.82 0.13 80)` | chalk textures welcome; no glow |

```css
/* Derive, do not hand-pick. */
--wash:  color-mix(in oklch, var(--signal) 10%, var(--surface));
--line:  oklch(from var(--ink) l c h / 0.22);
--press: oklch(from var(--signal) calc(l - 0.07) c h);
```

**Colour moves.** The single flat colour block that fills a viewport. The overprint (two inks
multiplied). The signal used once. The tonal page (ink one step from surface: charcoal on
black, cream on bone) — reads expensive and quiet. The duotone image (below). **Never:** the
purple→pink gradient, the acid accent on `#0a0a0a`, four pure greys, glass.

---

## Layout — grammars that are not the three-column grid

- **The editorial split.** 12 columns; content at 7/5 or 8/4, *never* 6/6. The narrow column
  holds the label, the date, the caption; the wide one the matter. `grid-template-columns:
  repeat(12, 1fr); .main { grid-column: 1 / 9 } .aside { grid-column: 9 / 13 }` (8/4).
- **The ledger.** Rows of `name · dotted leader · value`, tabular figures right-aligned, a
  0.5px rule under each. From price boards and audit reports; states a lot in little space.
  `.l { flex: 1; border-bottom: 1px dotted currentColor; transform: translateY(-0.3em) }`.
- **The margin note.** An aside in the gutter, 11–12px, hanging outside the measure
  (`margin-inline-start: -14ch` on wide screens, inline on narrow). The page talks to itself.
- **One thing per viewport.** `min-height: 100svh` sections, one sentence each, `scroll-snap-type:
  y proximity`. Wrong for anything someone scans.
- **The sticky index.** Left column `position: sticky; top: 0` with the section list; right
  column scrolls. A book's running head.
- **The offset stack.** Elements overlap by 10–15% (`margin-block-start: -12%` or grid areas
  that share rows). Depth without shadows.
- **The bleed.** One element — an image, a colour block, the enormous word — touches two edges
  of the viewport. Everything else sits inside the measure.
- **The visible grid.** Draw the column lines as the decoration: `background-image:
  repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px calc(100% / 12))`.
- **The rotated element.** One element at −3° to −6° (`rotate: -4deg`) — a stamp, a label, a
  ticket. One. A second one is a scrapbook.
- **The real table.** A `<table>` with `border-collapse`, 0.5px rules, tabular numerals and a
  caption. Data set as data reads as authority; cards for data read as a brochure.
- **The split screen.** Two independently scrolling halves (`overflow-y: auto` on each, in a
  `100svh` grid). A catalogue and its index, a text and its notes.
- **Left edge, always.** Centre only what is ≤ 2 lines. Everything the eye returns to has a
  left edge.

---

## Material — surfaces with a rule

- **Paper grain.** An SVG filter, once, over the whole page at low alpha. The frequency
  matters: 0.9 is blotchy, 2.4 is paper.
  ```html
  <svg width="0" height="0"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.07 0"/></filter></svg>
  <style>.paper::after { content: ""; position: fixed; inset: 0; filter: url(#grain); pointer-events: none; }</style>
  ```
- **Ink.** Colour that overlaps multiplies: `mix-blend-mode: multiply` on the second ink. On a
  dark surface use `screen`. Opaque white ink does neither.
- **Misregistration.** A second copy of the display word in the second ink, offset 2–4px,
  multiplied, `opacity: 0.55`. Two-pass printing, drawn. Once.
- **Halftone.** Dots, not gradients: `background: radial-gradient(circle, var(--ink) 26%,
  transparent 30%) 0 0 / 6px 6px` under a `mask-image: radial-gradient(ellipse 46% 92% at 50%
  100%, #000, transparent)` so it fades before its own box edge.
- **The hairline.** `border: 0.5px solid var(--line)` or `box-shadow: 0 0 0 0.5px var(--line)`.
  Hairlines are what make a layout look drawn rather than boxed.
- **The deboss.** `text-shadow: 0 1px 0 rgb(255 255 255 / 0.45), 0 -1px 0 rgb(0 0 0 / 0.25)`
  in the surface colour: type pressed into the page. For one word.
- **CRT / phosphor.** `repeating-linear-gradient(0deg, rgb(0 0 0 / 0.18) 0 1px, transparent 1px
  3px)` scanlines and a 1px chromatic offset (`text-shadow: 1px 0 rgb(255 0 0 / .35), -1px 0
  rgb(0 255 255 / .35)`). Only when the subject *is* a screen.
- **Never glass.** `backdrop-filter: blur` over translucent white is the surface of no material.

---

## Motion — one law per piece

`motion-and-animation.md` has the physics. These are the moves.

- **The reveal by clip.** `clip-path: inset(0 0 100% 0)` → `inset(0)` over 600ms
  `cubic-bezier(0.2, 0.7, 0.1, 1)`. Content is *uncovered*, not faded; reads as a curtain.
- **The stamp.** `scale(1.15) → scale(1)` in 180ms `cubic-bezier(0.2, 0.9, 0.3, 1.2)` with a
  1-frame hold: a mark hitting paper. For a verdict, a total, a "done".
- **The draw-on.** SVG `stroke-dasharray: L; stroke-dashoffset: L → 0` over 900ms ease-out: a
  correction mark, a signature, an underline that is a decision.
- **The stagger.** Children enter 30–50ms apart, each 400ms ease-out; the *last* one lands
  where the eye should be.
- **The marquee.** One line, `animation: run 45s linear infinite`, duplicated content for the
  loop, pausable on hover. A ticker, not a carousel.
- **The hold.** Nothing moves except one thing, once, on load. Then stillness. Stillness is a
  motion law too, and the rarest.
- **Exits at 60%** of the entrance duration; **`prefers-reduced-motion: reduce`** collapses all
  of the above to opacity or nothing, always.

---

## Images — treated, not placed

- **No stock photography.** Draw the subject's actual thing as SVG: the diagram, the report,
  the map, the tide table. Specific beats polished.
- **Duotone.** `filter: grayscale(1) contrast(1.15)` on the image, `mix-blend-mode: multiply`
  over the signal colour (or `screen` on dark). One image, one colour.
- **The hard crop.** `object-fit: cover; object-position: 80% 20%` — a crop that shows the
  edge of the thing, not its centre. Aspect ratios that are not 16:9: 4:5, 1:1.41 (A-series), 3:1.
- **The halftone image.** The halftone mask above over a photograph: newsprint.
- **The one full-bleed image** and nothing else on that viewport.

---

## The tests, restated

- **Swap test** — put a competitor's name and copy in it. Still works? It is the category.
- **One-sentence test** — describe the design in one sentence without naming the product.
  If the sentence could describe a Tailwind template ("a dark landing page with a gradient
  hero and feature cards"), it is one. A design that passes has a sentence like "an audit
  report typeset as a printed ledger, with the thesis copy-edited in red".
- **Ambition floor** — name the structural move (layout, material or motion). If the only
  moves are a font and a colour, the structure is still the default.
- **The floor** — the numbers `cgc audit` holds, which are not taste: contrast 4.5:1
  for text, 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold) — WCAG 1.4.3; tap targets ≥ 24 CSS px
  (WCAG 2.5.8; Apple's guideline is 44 pt), with a link inside running text exempt; reduced motion
  respected. A page that fails these is not finished, whatever it looks like.
- **The look** — `cgc render page.html --mobile`, desktop and phone, at
  least twice. The first render is never the one to show.
