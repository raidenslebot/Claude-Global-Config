# Print methods on fabric — what each can do, and the numbers

**[C]** constraint · **[D]** strong default · **[N]** confirm with the shop. Every shop's
screens, platens, threads and pretreat differ. `tools/print-lint.mjs --method <name>` applies
the minimums below.

## Screen printing

One screen per colour. Ink is pushed through a mesh stencil onto the garment, one colour at a
time, in registration.

| | Value |
|---|---|
| Colours | **[C]** 1 per screen; 1–6 typical; each adds setup cost. Light or opaque colours on a dark garment add a **white underbase** screen **[D]** — white ink itself, dark-on-dark and discharge do not need one |
| Minimum line | ~**1 pt / 0.35 mm** **[D]**; finer lines break up on the mesh and on textured fabric |
| Minimum text | ~**8 pt** equivalent for positive text; 10 pt reversed (knock-out) |
| Minimum negative space | ~1 pt between shapes or the ink bridges |
| Gradients, photographs | as **halftones**: 45–65 lpi **[N]**; a dot below ~5% or above ~95% is lost. Full photographic work is **simulated-process** (spot-colour halftones, usually 4–8 screens, the norm for band and streetwear photo tees) or **CMYK process** (light garments only) — real, mainstream, and needs an experienced separator **[N]** |
| Registration | tight but not perfect: allow a 1–2 pt **trap** where colours meet, or design with a gap |
| Max print area | platen-limited; ~14 × 16 in adult front **[N]** |

**Inks [D]:**
- **Plastisol** — opaque, bright, durable, sits *on* the fabric with a slight hand; the
  default. Prints any colour on any garment (with underbase on darks).
- **Water-based** — soaks *into* the fibre; soft, breathable, matte; less opaque, so it
  works best on light garments or as a deliberately muted look on mid-tones.
- **Discharge** — removes the garment's dye and replaces it; only on 100% cotton and only on
  dischargeable dyes **[N]**; the softest hand and the most "vintage" result; colours shift
  slightly per garment lot.
- **Specialty** — puff, metallic, glow, high-density, glitter: each is one screen and a hero
  move on its own; never combine two.

**Design for it:** flat shapes, solid colours, deliberate halftone if tonal work is needed.
Count the screens before you design; a two-colour design on the right blank beats six colours.

## DTG (direct-to-garment)

An inkjet prints water-based ink directly onto the fibre.

| | Value |
|---|---|
| Colours | unlimited; photographic |
| Garments | **[C]** 100% cotton best; blends lose vibrancy; polyester poor |
| Dark garments | **[C]** pretreat + white underbase; prints softer and slightly less vibrant than on white; the pretreat can leave a faint box |
| Minimum detail | similar to screen (~1 pt lines); very fine detail softens |
| Durability | fades somewhat faster than plastisol; wash inside out |
| Artwork | **PNG, transparent background, 300 dpi at print size**; RGB is fine |

**Design for it:** photographs, full-colour illustration, gradients, small runs and one-offs.
Design on the *garment colour* — the white underbase changes how mid-tones look on darks.

## Embroidery

Thread, stitched by a machine following a digitised path.

| | Value |
|---|---|
| Colours | thread colours (hundreds available); no gradients, no blends **[C]** |
| Minimum letter height | **~0.25 in / 6 mm** (sans); serifs and scripts want 0.35 in+ |
| Minimum line (satin stitch) | ~**1 mm**; below that it is a running stitch and looks thin |
| Minimum detail | ~2 mm; anything smaller is a knot |
| Maximum area | ~4 in left chest; ~12–14 in jacket back; cost scales with **stitch count** |
| Fills | large fills pucker light fabric and are expensive; use outline + partial fill |
| Fabric | pique, twill, fleece, denim, caps: great. Thin jersey tees: puckers **[N]** |

**Design for it:** marks and wordmarks with bold, simple shapes; caps, polos, left-chest logos,
jacket backs. Expect the shop to *digitise* your vector (convert to stitches) — send clean
vector with no strokes narrower than 1 mm and text no smaller than 0.25 in.

## Heat transfer (HTV, printable transfer, DTF)

Vinyl or printed film pressed onto the garment with heat.

| | Value |
|---|---|
| HTV (cut vinyl) | solid colours; one colour per layer; sharp; names/numbers; **[C]** no gradients |
| Printable transfer / DTF | full colour, works on many fabrics including poly; sits on the surface like a patch |
| Minimum detail | HTV ~1 mm; DTF ~0.5 pt lines |
| Hand | stiffer than screen/DTG; large solid areas do not breathe |
| Durability | good; can crack on heavy solids over time |

**Design for it:** one-offs, team names and numbers, small runs on mixed fabrics, tiny
placements (sleeve, hem, tag) where a screen setup is not worth it.

## Sublimation / all-over

Dye turned to gas under heat, bonded into polyester fibre.

| | Value |
|---|---|
| Garments | **[C]** polyester or high-poly blends only; white or light base only |
| Colours | unlimited, edge to edge, seam to seam; no hand at all |
| Artwork | full garment template from the manufacturer **[N]**; 150–200 dpi at full size is typical |
| Look | sports, technical, festival; cotton *cannot* take it |

## Choosing — decision table [D]

| The artwork is… | Garment | Run | Method |
|---|---|---|---|
| A mark or flat graphic, 1–3 colours | any | 25+ | **Screen print** |
| A mark or flat graphic, 1–3 colours | any | < 25 | DTG (light cotton) or DTF |
| A photograph / full-colour illustration | light cotton | < 50 | **DTG** |
| A photograph / full-colour illustration | dark cotton | < 50 | DTG with underbase, or DTF |
| A photograph / full-colour illustration | any | 50+ | Screen print, **simulated-process** separations |
| A mark on a cap, polo, jacket; anything "premium" | pique/twill/fleece | any | **Embroidery** |
| Names, numbers, one-offs | any | tiny | **HTV** |
| Edge-to-edge, seam-to-seam | polyester | any | **Sublimation** |
| Vintage, soft, faded on purpose | 100% cotton | 25+ | Screen — **discharge** or water-based |

## The artwork file, per method

| Method | Send |
|---|---|
| Screen | vector (SVG/AI/PDF), fonts outlined — do this in the vector editor; `print-render` embeds fonts, it does not outline — one named spot colour per screen, separations if asked; halftone lpi per shop **[N]** |
| DTG / DTF | PNG, transparent, 300 dpi at print size (12 in = 3600 px), RGB |
| Embroidery | vector, fonts outlined, no line < 1 mm, no text < 0.25 in; the shop digitises |
| HTV | vector, one colour per layer, fonts outlined |
| Sublimation | the manufacturer's template, filled, at their dpi |

Always with a **placement sheet** — see `placement-and-sizing.md`.
