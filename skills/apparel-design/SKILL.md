---
name: apparel-design
description: "Anything printed, embroidered or pressed onto a garment or textile. Use for \"t-shirt\", \"tee\", \"hoodie\", \"cap\", \"tote bag\", \"merch\", \"jersey\", \"screen print\", \"DTG\", \"embroidery\", \"heat transfer\", \"where should the logo go on the shirt\", \"how big should the chest print be\", or \"make a mockup on a shirt\". Carries the constraints of each print method (colour counts, minimum stroke and letter sizes, underbase on dark garments), placement zones with real dimensions for adult, youth and women's cuts, garment colour as part of the artwork, the artwork specs a shop accepts, and SVG garment flats for a true-scale local mockup. Not for paper — print-design owns that."
---

# Apparel design — the garment is the canvas, the method is the constraint

"Make me a t-shirt design" produces a logo centred on the chest, or a slogan in a condensed
bold across it. That is the centroid of every shirt the model has seen, and it is also what a
shop's default template does for free. This skill makes it invalid by treating three things as
decisions the centroid never makes: the **method** (each has physical limits that shape the
art), the **placement** (the chest centre is one of a dozen zones, and rarely the best), and
the **garment** (its colour and cut are part of the artwork, not a background for it).

Read [`print-and-physical.md`](../visual-design-mastery/references/print-and-physical.md) first
for the taste; `creative-divergence` still chooses the direction. This file is the craft.

## Choose the method first — it decides what the art can be

Each method is a different medium. Design *for* one; do not design and then ask which method
can print it. Marked **[C]** constraint, **[D]** strong default, **[N]** confirm with the shop.
Full detail in [`references/print-methods.md`](references/print-methods.md).

| Method | What it is | What it can and cannot do |
|---|---|---|
| **Screen print** | One screen per colour; ink pushed through mesh. The standard for runs of ~25+ | **[C]** every colour is a separate screen — 1 to 6 is normal, each adds cost. Solid, opaque, durable, vibrant. Gradients and photographs only as **halftone** (45–65 lpi [N]) or, for full photographic work, as **simulated-process / CMYK-process** separations — 4–8 screens and a separator who knows the craft. Light or opaque colours on a dark garment need a **white underbase** [D] (not when the ink *is* white, not dark-on-dark, not discharge). Min line ~1 pt / 0.35 mm, min letter ~8 pt equivalent [D]. Plastisol is opaque and sits on top; water-based/discharge soaks in with a soft hand but is less opaque on darks. |
| **DTG** (direct-to-garment) | Inkjet onto the fibre | Full colour and photographic, no colour count, good for small runs. **[C]** best on 100% cotton; on dark garments needs pretreat + white underbase and prints slightly softer and less vibrant. Fine detail similar to screen. Fades faster than plastisol. |
| **Embroidery** | Thread | **[C]** no gradients, no photographs, no fine detail. Min letter height ~0.25 in / 6 mm; min line (satin stitch) ~1 mm; max sensible width ~12–14 in on a back, 4 in on a left chest. Cost scales with **stitch count** — a big fill is expensive. Reads as premium; the right answer for caps, polos, left-chest marks, and any mark that must last years. |
| **Heat transfer / HTV** | Vinyl or transfer film pressed on | Solid colours, sharp edges, names and numbers, one-offs and tiny runs. **[C]** no gradients in cut vinyl; printable transfers allow full colour but sit on the fabric like a patch. Stiffer hand; large solid areas do not breathe. |
| **All-over / sublimation** | Dye into polyester | Edge-to-edge, seam-to-seam colour. **[C]** polyester (or high-poly blend) only, and only on white/light base. Cotton cannot take it. |

**Strong default [D]:** a mark or a flat graphic in one to three colours → screen print.
A photograph or a full-colour illustration on a light cotton tee → DTG. A mark on a cap, polo or
jacket, or anything that has to look expensive → embroidery. A single name/number → HTV.

## Placement — the chest centre is one zone of twelve

Real dimensions for an adult unisex tee, all **[D]** — the shop's platen and the garment size
set the hard limits [N]. Youth and women's cuts scale to roughly **80–85%**. Full tables and the
per-garment zones (hoodie, cap, tote, long sleeve, jersey) are in
[`references/placement-and-sizing.md`](references/placement-and-sizing.md).

| Zone | Size | Position |
|---|---|---|
| Full front | up to **12 × 14 in**; 10–11 in wide reads best | top edge 3–4 in below the collar seam, centred |
| Left chest | **3.5–4 in** wide | 3–4 in below the collar seam, centred over the chest — over the heart, not the armpit |
| Full back | up to **12–14 in** wide | top 4–5 in below the collar |
| Upper back / yoke | 8–10 in wide, 2–3 in tall | 2–3 in below the collar |
| Sleeve, short | ~3 × 3 in | centred on the sleeve, 1 in above the hem |
| Sleeve, long | ~3 × 12–14 in, vertical | from the shoulder seam down |
| Hem / pocket | ~3–4 in | just above the hem, offset to one side, or on/over the pocket |
| Inside neck (tag) | ~3 × 3 in | replaces the label; printed, on the inside back |
| Hoodie front | up to ~10 in wide | centred, 2 in above the kangaroo pocket; or a left chest |
| Hood | ~6 in | on the hood itself, seen from behind when down |
| Cap front | **4 × 2.25 in** max (embroidery) | centred on the front panel |
| Tote | up to 12 × 12 in on a 15 × 16 in bag | centred, or offset low to one side |

**The rule for size:** measure it against the *body*, not the artboard. A 12 in print on a
youth small wraps the sides; a 3 in left chest on a 3XL disappears. Ask for the size range being
ordered and design for the middle, or supply two art sizes.

## The garment is part of the artwork

- **Colour interaction [C].** Ink on a coloured garment is not ink on white. Light or opaque
  colours screen-printed on a dark garment need a white underbase **[D]** — which adds a screen
  and thickens the hand — unless the ink is white itself, dark-on-dark, or discharge; on a
  heather, light inks go slightly translucent and let the marl show through, which can be
  beautiful and can be a mistake. Design *knowing* the garment colour — never on a white
  artboard with the colour to be decided later.
- **One-colour discipline.** The best merch is one ink on the right garment colour. Black on
  natural, white on black, a single Pantone on a heather. The garment supplies the second
  colour for free.
- **Tonal and near-tonal.** Ink one step from the garment colour (charcoal on black, cream on
  natural) reads as expensive and quiet — a hero move for a brand that does not want to shout.
- **Fabric decides detail.** Ribbed, fleece and heavy jersey lose fine lines; a smooth 100%
  ring-spun cotton holds them. Ask what the blank is before drawing anything under 2 pt.
- **The blank is a design decision.** Boxy vs fitted, heavyweight vs lightweight, garment-dyed
  vs pigment, the colour range of the line. A design for a heavyweight boxy tee in "bone" is a
  different design from one for a fitted tri-blend in heather grey.

## The moves that only exist because it is fabric

Pick **one** hero move; keep the rest quiet.

- **Placement break.** Left sleeve only. The hem. The yoke. Inside the neck. Down the spine.
  A tiny mark at the left hip. A moved placement is the cheapest surprise in apparel.
- **The back is the front.** A small mark on the chest; the statement on the back, where it is
  seen walking away.
- **One ink, the right blank.** See above — restraint plus a garment colour chosen with intent.
- **Wear-through.** Design what the garment will look like *after* fifty washes: discharge and
  water-based inks fade into the fabric on purpose; a distressed edge that is drawn, not
  filtered.
- **Scale extremity.** A mark at 1 in on the chest — or an all-over print with no focal point.
  Moderation is the centroid.
- **The set.** A line of three garments that share a system — the same mark at three placements
  and three scales — reads as a brand, not a shirt.
- **Method as message.** Embroidery says permanence; a chain-stitch says hand; puff-print says
  play; discharge says vintage. Choose the method for what it *means*, then obey what it can do.

Swap test: *put a different brand's name in this artwork — does it still work?* Then it was the
template.

## Artwork the shop will accept

- **Vector** (SVG, AI, EPS, PDF) for anything screen printed, embroidered or cut. Fonts
  converted to outlines. Colours as **named spots** (Pantone) — one per screen — not as
  gradients or RGB.
- **Raster** (PNG, transparent background) only for DTG and printable transfers, at **300 dpi
  at print size**: a 12 in print is a **3600 px** wide file.
- **Separations** for screen print: one layer per colour, in registration, plus the underbase
  if the garment is dark. Halftones at the lpi the shop asks for [N] — do not pre-screen unless
  they tell you to.
- **A placement sheet** with each artwork: garment, colour, method, zone, size in inches,
  distance from the collar seam, ink colours by name. The template is in
  [`references/placement-and-sizing.md`](references/placement-and-sizing.md).

## Mockups, locally and at true scale

Placement and size are judged on the body, so they are seen before ordering. This config ships
vector garment flats — tee, hoodie, cap, tote — in [`assets/`](assets/), drawn at real garment
dimensions with the print zones marked. Composite the artwork onto one at true scale:

```
node tools/print-render.mjs artwork.svg --mockup tee --zone left-chest --garment "#1c1c1e" --png 150
```

The result is a PNG of the flat with the art at the size it will actually print, on the garment
colour it will actually be on. Photographic mockups are not shipped (they would be assets from
somewhere else); the flat is the honest review tool for placement, scale and colour.

## Slop to recoil from

- **Logo centred on the chest, 10 in wide, on a white tee.** The shop's template made it.
- **A slogan in Impact, Bebas or a distressed "vintage" font** with no idea behind it.
- **Designing on a white artboard** and choosing the garment colour later.
- **A gradient or a photograph specified for embroidery.** Thread cannot. For screen print a
  photo *is* possible — simulated-process or CMYK-process work, 4–8 screens and a separator who
  knows the craft — so never specify it by accident, and never call it impossible.
- **Six colours on a dark garment** — up to seven screens with the underbase, and a print that
  feels like a vinyl sticker.
- **Fine line art at 0.5 pt** on fleece. It will not survive the first print, never mind the wash.
- **Small text on embroidery.** Below 0.25 in it is a row of knots.
- **The distressed filter.** Photoshop grunge over a clean vector is not wear; it is noise.
- **One art size for S through 3XL.** The print either wraps the small or vanishes on the large.

## How this composes

```
creative-divergence  →  the direction (and this skill adds the fabric operators)
apparel-design       →  method, placement, garment, artwork spec, mockup (this skill)
tools/print-render   →  the true-scale mockup on a garment flat; the print-ready export
tools/print-lint     →  the gate: minimum line and letter sizes for the chosen method
visual-design-mastery→  judges the execution; print-and-physical.md carries the taste
print-design         →  the same discipline on paper — hang-tags, packaging, the lookbook
design-tokens        →  measure the brand's real colour off its own materials first
```
