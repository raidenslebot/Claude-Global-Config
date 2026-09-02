# Placement and sizing — measured against the body

Every number here is a strong default **[D]** for an **adult unisex** garment in the middle of
the size range (L). The shop's platen and the specific blank set the hard limits **[N]**. The
zone names are the ones `cgc print --mockup <garment> --zone <zone>` understands,
and the flats in `assets/` carry these zones at true scale.

## Tee (front) — flat 22 × 29 in, `--mockup tee`

| Zone | Width | Height | Position |
|---|---|---|---|
| `full-front` | 10–12 in (max 14 **[N]**) | up to 14 in | top edge **3–4 in below the collar seam**, centred |
| `left-chest` | 3.5–4 in | 3.5–4 in | 3–4 in below the collar seam; centred over the chest (**wearer's** left) |
| `right-chest` | same | same | mirror |
| `sleeve-left` / `sleeve-right` | 3 in | 3 in | centred on the sleeve, ~1 in above the sleeve hem |
| `hem-left` / `hem-right` | 3–4 in | 2–3 in | 1.5–2 in above the hem, offset to one side |
| `pocket` | 3–4 in | 3–4 in | on or just above the pocket, if the blank has one |

## Tee (back) — `--mockup tee-back`

| Zone | Width | Height | Position |
|---|---|---|---|
| `full-back` | 12–14 in | up to 14 in | top edge **4–5 in below the collar** |
| `yoke` | 8–10 in | 2–3 in | 2–3 in below the collar, centred; the "upper back" strip |
| `spine` | 2–3 in | up to 16 in, vertical | centred, from the yoke down |
| `tag` (inside neck) | 3 in | 3 in | inside, below the collar, replacing the label |

## Long sleeve — flat 26 × 29 in, `--mockup long-sleeve`

As tee (`full-front`, `left-chest`, `hem-left`), plus `sleeve-long`: **3 × 11–14 in**, along
the sleeve from 1 in below the shoulder seam toward the cuff. The zone is *rotated* to lie on
the arm (`sleeve-long-right` mirrors it) and the mockup rotates the art with it. Reads walking
past; the best-value placement in apparel.

## Polo — flat 22 × 29 in, `--mockup polo`

| Zone | Width | Height | Position |
|---|---|---|---|
| `left-chest` | 3.5–4 in | 3.5–4 in | 3–4 in below the collar seam, beside the placket — **embroidery** is the norm |
| `right-chest` | same | same | mirror; a second mark (a sponsor, a year) |
| `sleeve-left` / `sleeve-right` | 3 in | 3 in | centred, 1 in above the sleeve hem |

Pique holds embroidery well and small screen-print detail badly. Keep the mark ≥ 0.25 in
letter height and let the placket be; nothing prints across it.

## Jersey (back) — flat 24 × 30 in, `--mockup jersey`

| Zone | Width | Height | Position |
|---|---|---|---|
| `name` | up to 12 in | 2.5 in | arched, top edge **3 in below the collar** |
| `number` | up to 9 in | **8 in** tall (adult; 6 in youth) | centred, 1 in below the name |
| `hem-sponsor` | up to 9 in | 3 in | above the hem |

Numbers are usually **HTV or sublimation**; block or athletic faces with open counters, one or
two colours with a contrasting outline of ≥ 0.25 in. Front zones are the tee's.

## Beanie — flat 10 × 9 in, `--mockup beanie`

| Zone | Width | Height | Position |
|---|---|---|---|
| `cuff` | **max 3 in** | **max 1.6 in** | centred on the folded cuff; embroidery or a woven label |

Knit stretches and the surface is coarse: a bold mark, nothing under 2 mm, no small text.

## Hoodie — flat 24 × 28 in, `--mockup hoodie`

| Zone | Width | Height | Position |
|---|---|---|---|
| `front` | up to 10 in | up to 8 in | centred, bottom edge **2 in above the kangaroo pocket** |
| `left-chest` | 3.5–4 in | 3.5–4 in | as tee |
| `hood` | 5–6 in | 4–5 in | on the hood, seen from behind when it is down |
| `sleeve` | 3 in | 3 in | upper sleeve |
| `full-back` | 12–13 in | up to 14 in | 4–5 in below the collar |
| `pocket` | 3–4 in | 2–3 in | on the kangaroo pocket, offset |

Fleece loses fine lines — nothing under ~1.5 pt, text ≥ 10 pt for screen print.

## Cap — flat 8 × 6 in (front view), `--mockup cap`

| Zone | Width | Height | Position |
|---|---|---|---|
| `cap-front` | **max 4 in** | **max 2.25 in** | centred on the front panels; embroidery is the norm |
| `cap-side` | 2 in | 1 in | left or right panel |
| `cap-back` | 2.5 in | 1 in | above the closure |

Structured caps (buckram) hold detail; unstructured "dad" caps pucker on large fills.

## Tote — flat 15 × 16 in, `--mockup tote`

| Zone | Width | Height | Position |
|---|---|---|---|
| `front` | up to 12 in | up to 12 in | centred, or **offset low** to one side (reads better carried) |
| `corner` | 3 in | 3 in | bottom corner |

Canvas holds fine detail well; a 1-colour print in the tote's own tone is the classic.

## Scaling across sizes [D]

| Range | Scale of the adult-L art |
|---|---|
| Youth (XS–L) | **80%** |
| Women's fitted | **85%** |
| Adult XS–S | 90% — or keep L art if it stays inside the platen and off the side seams |
| Adult 2XL–3XL | 100–110%; a 3 in left chest can go to 3.5 |

**The test:** a full-front print must stay **≥ 1.5 in from each side seam** and not cross the
armpit line. If one art size cannot do that across the order, supply two sizes and put both on
the placement sheet.

## Design on the body, not the artboard

- Draw the flat at true scale (the `assets/` SVGs are), place the art at real inches, and look
  at it as a garment. A 12 in print that looked balanced on a white canvas usually wants to be
  10 in on a body.
- **Optical centre** is above geometric centre. A chest print placed at the geometric centre of
  the torso looks low; hence "3–4 in below the collar seam", not "centred on the front".
- The **left chest sits over the heart**, roughly a hand's width in from the centre and 3–4 in
  down. Too far out and it is on the shoulder; too far down and it is a rib.
- **Sleeves and hems are seen from the side** — small, one colour, high contrast.

## The placement sheet — ship it with every artwork

```
GARMENT:      Bella+Canvas 3001 unisex tee (or shop equivalent)   COLOUR: Black
METHOD:       screen print, 1 colour, plastisol, with white underbase
INK:          Pantone 7499 C (cream)
PLACEMENT:    left-chest — 3.5 in wide, top edge 3.5 in below the collar seam,
              centred over the wearer's left chest
              back — full-back 12 in wide, top edge 4.5 in below the collar, centred
SIZES:        S–2XL: art as supplied.  Youth S–L: scale to 80%.
FILES:        mark.svg (vector, fonts outlined, 1 spot colour), placement-mockup.png
NOTES:        Please send a strike-off / photo proof before the run.
```
