---
name: print-design
description: "Anything that comes out of a printer or a print shop. Use for \"business card\", \"flyer\", \"poster\", \"brochure\", \"postcard\", \"sticker\", \"label\", \"packaging\", \"menu\", \"invitation\", \"letterhead\", \"print-ready PDF\", \"add bleed\", \"what size should this print at\", \"CMYK\", \"Pantone\", or \"send this to the printer\". Carries the physical facts (trim, bleed, safe zone, resolution, stock, finish, folds, die-cuts), the divergence moves that only exist because the medium is physical, and the local pipeline that renders HTML or SVG at physical size to a PDF and refuses one that would not survive the press. Not for garments — apparel-design owns fabric — and not for anything viewed on a screen."
---

# Print design — the object, not the rectangle

The default output for "make me a business card" is a screen layout at 3.5×2 inches: white,
logo top-left, name, four contact lines, one accent. It is the centroid of every card the
model has seen, and it will print exactly as generic as it looks. This skill exists to make
that output invalid — by treating the piece as a physical object with a stock, a finish, two
sides, an edge and a reading distance, and by shipping a file a printer can actually use.

Read [`print-and-physical.md`](../visual-design-mastery/references/print-and-physical.md) first
for the taste; this file is the craft. `creative-divergence` still chooses the direction.

## The physical facts — constraints, not taste

These are why a design survives the press. Each is marked **[C]** constraint (do not argue),
**[D]** strong default (deviate when you can say why), or **[N]** number to confirm with the
printer. The full tables are in [`references/sizes-and-specs.md`](references/sizes-and-specs.md).

- **Trim, bleed, safe.** Trim is the finished size. **Bleed [C]** is artwork extended past the
  trim — 0.125 in / 3 mm on every side **[D]** — because the cutter is not accurate to a hair;
  anything meant to reach the edge must run *through* it. **Safe zone [C]** is the same distance
  *inside* the trim where nothing important may sit, for the same reason in the other direction.
  The distances are the usual defaults; the shop's template wins **[N]**. A card is therefore
  authored at 3.75×2.25 in and cut to 3.5×2.
- **Resolution [C].** Raster art at **300 dpi at final printed size**. A 1200px-wide image is
  4 in wide at 300 dpi, not 12. Type, logos and line art are vector — never rasterised.
- **Black [C].** Body type is **100% K only** (four-colour text misregisters into a fuzzy
  rainbow edge). Large black areas are **rich black — C60 M40 Y40 K100** as a default [D] —
  because 100K alone prints as dark charcoal beside a rich black and looks like a mistake.
- **Colour [C].** Press is CMYK or spot (Pantone); a screen is RGB. The saturated cyan, lime and
  magenta that look electric on a display are *outside the CMYK gamut* and print dull. Choose
  colours you have seen printed, or name a Pantone. See *colour that prints* below.
- **Type size [D→C].** Nothing below **6 pt**; contact lines at **7–8 pt** are kinder; reversed
  (white-on-dark) type needs a size and weight up because ink spreads *into* the letter.
  Serifs and thin weights reversed out below 8 pt fill in and vanish.
- **Line weight [D].** Nothing thinner than **0.25 pt**; reversed lines nothing under 0.5 pt.
  Hairlines that look crisp on screen drop out on press. That a minimum exists is the constraint;
  the number is the shop's (0.25–0.5 pt) **[N]**.
- **Registration [D].** Two-colour work where the colours touch needs a **trap** (a slight
  overlap, ~0.25 pt) or an overprint, or a white sliver appears where the plates disagree.
  Printers usually handle this; tell them where colours meet.
- **Files [D].** Deliver a **PDF at trim + bleed with crop marks**, fonts embedded (a browser
  PDF embeds them), single file per side or a two-page file, named `<piece>-front.pdf`. For
  offset, the shop may ask for **PDF/X-1a** (CMYK, flattened) or **PDF/X-4** (transparency
  allowed). See *the pipeline* for what this config can and cannot produce.

## Colour that prints

A screen palette is a starting point that the press will renegotiate. Three ways to keep control:

1. **Spot colour.** For one- and two-colour work — which is most great cards and many great
   posters — name a **Pantone** (e.g. *Pantone 2945 C*). The printer mixes that ink; it prints
   exactly, every time, and can be fluorescent, metallic or a colour CMYK cannot reach. One spot
   colour on the right stock beats four-colour process on the wrong one.
2. **Process (CMYK).** For photographs and full-colour work. Author in RGB, but *choose*
   colours near the CMYK gamut — muted, earthy, or mid-chroma hues survive; neon does not. The
   lint warns above `oklch` chroma ~0.14; that is a hue-dependent heuristic (yellows and warm
   oranges print well above it, saturated blues fail below it), so read it as "check this hue"
   and name a Pantone for anything that must match.
3. **Say what you meant.** Whatever the file's colour space, ship a one-line **spec sheet**
   with it: stock, finish, colours by name (Pantone or CMYK percentages), sides, quantity,
   special process. Printers read the sheet before the file. A template is in
   [`references/stock-finish-and-process.md`](references/stock-finish-and-process.md).

## The moves that only exist because it is physical

`creative-divergence`'s seven operators apply unchanged. Its first — *material transplant* —
becomes literal here: the material is not borrowed, it is chosen, and obeying its real
limitations is the design. These are the print-specific operators; pick **one** as the hero move
and keep everything else quiet.

- **Stock as the idea.** Black card, white ink. 600 gsm cotton with a letterpress impression you
  can feel. Uncoated warm-white with one spot colour. Kraft. Translucent vellum. Wood, metal,
  seed paper, transparent plastic. The stock is chosen *first*, from the subject's own materials
  (a tattoo studio on stencil stock; a bakery on butcher paper), and the layout follows.
- **One ink.** Forbid a second colour. Black on white, or one Pantone on one stock. Hierarchy
  has to come from size, weight, space and the paper itself — which is exactly the discipline
  the centroid never has to learn.
- **The back does the work.** The front is one word, one mark, or nothing but the stock. Turn
  it over and there is everything else. The sequence of handling *is* the design.
- **Format break.** Square. Vertical. Mini (2.5×1.5 in). A folded card. Non-standard costs
  more and is remembered proportionally.
- **Shape.** Die-cut to something the subject owns — a guitar pick, a house key, a leaf, a
  ticket stub. One die, one idea, no decoration on top of it.
- **Finish as message.** A single foil word on matte black. Spot UV on the mark only, so it
  appears when the card tilts. Emboss with no ink at all. Painted edges in the one colour.
  Each of these is a *complete* hero move; two of them fight.
- **Type as the entire design.** One typeface, set with real craft — optical sizes, tight
  display tracking, true small caps — and nothing else. Print resolves what screens cannot.
- **Distance as structure.** For posters and flyers: design the three reads (10 ft, 3 ft,
  1 ft) as three explicit layers, and let the far one own 60–80% of the surface.

Run the swap test on every candidate: *replace the name and contact details with another
company's — does the card still work?* If yes, it is the category, not the client.

## Per-piece craft

Each of these has its own reference with the sizes, the centroid to refuse, and the moves that
work. The short version:

- **Business cards** — one reading distance (6 in), one hero move, one thing per side, contact
  lines 7–8 pt in a text face, and a *reason* for every element on it. Standard sizes: US
  3.5×2 in, EU/UK 85×55 mm, JP 91×55 mm. Rounded corners 1/8–1/4 in if any. See
  [`references/business-cards.md`](references/business-cards.md).
- **Flyers and posters** — the three-distance rule; one dominant element; headline at the size
  the *far* read needs (a strong default: **1 in of cap height per 10 ft of viewing distance**,
  confirm by standing there); body copy only where someone will stand and read. Tear-off tabs
  and QR codes are fine when they are *designed*, not appended. See
  [`references/flyers-posters-brochures.md`](references/flyers-posters-brochures.md).
- **Brochures and folded pieces** — choose the fold for the *reading order*, not the page
  count: half, tri (roll), Z, gate, accordion. The panel that folds in is **1/16 in narrower**
  (each successive inner panel on a roll fold) so the piece closes flat — never equal columns.
  Design the sequence of disclosure; the outside is a cover, not a page.
- **Stickers and labels** — kiss-cut (sticker peels, backing stays) vs die-cut (cut through);
  bleed still applies; white ink under colour on clear or kraft; corner radius ≥ 1/8 in or the
  corners lift.
- **Packaging** — get the **dieline** from the manufacturer or the printer before designing;
  never draw one. Every panel is a surface with its own reading orientation; glue flaps carry
  nothing. Structural first, graphic second.
- **Marks that print** — a logo the piece will carry must work in **one colour, reversed, and at
  0.5 in wide**. If it needs a gradient or a second colour to read, it is an illustration, not
  a mark. Test at the size it will actually be printed.

## The pipeline — a file the printer can take

This config renders physical work through the browser it already has, with no accounts and no
keys. Author, render, gate; only then judge.

**0 · Write the directions down first — `directions.md` beside the design, before any markup.**
The DNA table (materials, motifs, palette from source, tempo, vernacular), three to five
directions each stating its operator in one sentence, the swap-test verdict on each, and the
one committed to with the reason. This is not paperwork; it is the step that gets skipped "in
the head", and a direction that was never written down was never compared with anything. The
author of this skill skipped it on the first card made with it and shipped the centroid — the
example in `examples/business-card/directions.md` shows the artifact, including the discarded
directions.

**1 · Author at physical size.** HTML with an `@page` rule and every dimension in `in`, `mm` or
`pt`; or an SVG whose `width`/`height` carry units and whose `viewBox` matches. The document
size is **trim + bleed on every side**; the trim box is where the cut lands; keep content inside
the safe zone. A minimal card, front:

```html
<style>
  @page { size: 3.75in 2.25in; margin: 0; }           /* trim 3.5×2 + 0.125in bleed each side */
  html, body { margin: 0; }
  .sheet { width: 3.75in; height: 2.25in; position: relative; overflow: hidden; }
  .safe  { position: absolute; inset: 0.25in; }        /* bleed 0.125 + safe 0.125 */
  body { font: 7.5pt/1.35 "Source Serif 4", Georgia, serif; color: #000; }
</style>
<div class="sheet"><div class="safe">…</div></div>
```

**2 · Render.** `node tools/print-render.mjs card-front.html --trim 3.5x2in --bleed 0.125in
--marks --png 300` writes `card-front.pdf` (page = trim + bleed; with `--marks`, plus a 0.25 in
slug on every side, the marks sitting in the slug and pointing at the trim corners), and
`card-front.png` at 300 dpi for review. `--size` may be a named preset (`business-card-us`,
`a5`, `letter`, `dl` …). Output is RGB; see the limitation below.

**3 · Gate.** `node tools/print-lint.mjs card-front.html --trim 3.5x2in --bleed 0.125in` fails on:
type below 6 pt; stroke/border below 0.25 pt; a raster placed below 300 dpi; no `@page` size
or a size that is not trim + 2×bleed; pixel units used for physical dimensions. A warning names
any colour whose chroma is likely outside CMYK. **A design that fails the lint is not finished**,
whatever it looks like.

**4 · Deliver.** The PDF, the PNG preview, and the spec sheet. For a two-sided piece, two PDFs
or one two-page file — say which in the sheet.

A finished card in exactly this form — front, back, spec sheet, passing the lint — is in
[`examples/business-card/`](examples/business-card/). Read it for the shape before authoring
the first one; do not copy its design.

**Limitation, stated plainly:** Chromium writes **RGB** PDFs with fonts embedded as subsets
(not outlined). Online services (Moo, Vistaprint, Printful and most digital shops) accept them
and convert. An offset shop asking for CMYK gets the spec sheet naming the CMYK/Pantone intent
so their prepress applies it — the reliable path. A local conversion is possible with
Ghostscript 9.54+ *if* it is installed (it is not required by this config), and **only with the
black flags**: `gs -sDEVICE=pdfwrite -sColorConversionStrategy=CMYK -dBlackText -dBlackVector
-dPDFSETTINGS=/prepress -o out.pdf in.pdf`. Without them the conversion turns black text into a
four-colour build, the exact defect the facts above forbid. That yields a CMYK PDF, not PDF/X-1a.
Do not claim a CMYK file you did not make.

## Slop to recoil from

- **The blank dark card with a small mark in one corner.** It is the *minimalist* centroid, and
  restraint is not an idea. If the stock or finish is meant to be the hero, remember the proof
  is a flat render where stock is invisible — the flat design must still fail the swap test on
  its own, or nothing was designed.
- **The developer-tool card:** a wordmark set bold/light (`argo`**naut**), a short rule, a
  tagline, a `$ command` in monospace, a URL. A template with the name changed.
- **The tech card:** a network of dots and lines as decoration. Every startup's card.
- **A screen layout at card size.** Pixels, `rem`, `rounded-lg`, drop shadows, a gradient.
  Paper has none of these; a design that uses them was not designed for paper.
- **Stock and finish chosen last** — or not at all, which means "14pt gloss" by default.
- **Everything on the front, nothing on the back.** Two sides, one used.
- **Contact lines as the design.** Name, title, phone, email, web, address, socials — seven
  lines of 7pt text is a directory entry, not a card. Choose three.
- **Body copy on a poster.** If it needs a paragraph, it is a flyer; if it is a poster, the
  paragraph is a caption at one foot.
- **Neon on press.** Electric cyan, acid lime, hot magenta chosen on a display. They will not
  print that way, and nobody named a Pantone.
- **A QR code stuck in a corner.** Either design it in — size, quiet zone, contrast, a reason to
  scan — or leave it off.
- **Texture as craft.** A grain or halftone overlay on a generic layout is a generic layout with
  an overlay. Real texture comes from the stock and the process.
- **Claiming print-readiness from a screenshot.** If it did not go through the render and the
  lint, it is a picture of a design.

## How this composes

```
creative-divergence  →  the direction (and print-design adds the physical operators)
print-design         →  the object: stock, size, bleed, colour, folds, the file (this skill)
tools/print-render   →  HTML/SVG at physical size → PDF + PNG, locally, keyless
tools/print-lint     →  the gate: would this survive the press?
visual-design-mastery→  judges the execution; print-and-physical.md carries the print taste
canvas-design (host) →  a poster that is art first — its philosophy, then this skill to print it
apparel-design       →  the same discipline on fabric
design-tokens        →  measure a brand's real colour and type off its own materials first
```
