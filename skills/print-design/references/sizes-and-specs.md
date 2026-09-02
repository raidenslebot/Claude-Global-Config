# Sizes and specs — the numbers, marked by kind

**[C]** constraint · **[D]** strong default · **[N]** confirm with the printer. Every printer's
cutter, press and paper differ; these are the numbers that get you to the right order of
magnitude and to the right questions. `tools/print-render.mjs --size <preset>` and
`tools/print-lint.mjs` use the same names and values as the tables below.

## Trim sizes (finished size, before bleed)

| Preset | Trim | Notes |
|---|---|---|
| `business-card-us` | 3.5 × 2 in (88.9 × 50.8 mm) | US / Canada standard |
| `business-card-eu` | 85 × 55 mm (3.346 × 2.165 in) | EU / UK |
| `business-card-jp` | 91 × 55 mm (3.583 × 2.165 in) | Japan |
| `mini-card` | 2.5 × 1.5 in | a generic mini; a format break (vendor minis differ — e.g. 70 × 28 mm) |
| `square-card` | 2.5 × 2.5 in | |
| `postcard-4x6` | 4 × 6 in | USPS postcard rate up to 4.25 × 6 |
| `postcard-5x7` | 5 × 7 in | |
| `postcard-a6` | 105 × 148 mm | |
| `half-letter` | 5.5 × 8.5 in | flyers, menus |
| `letter` | 8.5 × 11 in | |
| `legal` | 8.5 × 14 in | |
| `tabloid` | 11 × 17 in | small poster |
| `a6` | 105 × 148 mm | |
| `a5` | 148 × 210 mm | flyers |
| `a4` | 210 × 297 mm | |
| `a3` | 297 × 420 mm | small poster |
| `a2` | 420 × 594 mm | |
| `a1` | 594 × 841 mm | |
| `a0` | 841 × 1189 mm | |
| `dl` | 99 × 210 mm | one third of A4 — the insert/flyer size; the DL *envelope* is 110 × 220 mm |
| `rack-card` | 4 × 9 in | US rack card |
| `poster-18x24` | 18 × 24 in | |
| `poster-24x36` | 24 × 36 in | |
| `sticker-2in` | 2 × 2 in | |
| `sticker-3in` | 3 × 3 in | |

Custom: `--trim 4.25x5.5in` or `--trim 100x150mm`. Any unit in `in`, `mm`, `cm`, `pt`.

## Bleed, safe zone, slug — **[C]** that they exist · **[D]** the sizes

That art must run past the trim and that nothing important may sit near it are constraints. The
distances are strong defaults: shops range from 1/16 to 1/4 in on both, and their template wins **[N]**.

| | US | Metric | Why |
|---|---|---|---|
| Bleed | 0.125 in | 3 mm | the cutter wobbles outward — art must run past the trim |
| Safe zone | 0.125 in inside trim | 3 mm | it wobbles inward too — nothing important within it |
| Large format (≥ 18 in) | 0.25 in | 5 mm | bigger sheets, bigger wobble **[N]** |
| Slug (crop marks live here) | 0.25 in | 6 mm | added by `--marks`; outside the bleed |

**Document size = trim + 2 × bleed.** A US card is authored at **3.75 × 2.25 in**. With
`--marks`, the rendered page is trim + 2 × (bleed + slug) and the marks point at the trim corners.

## Resolution **[C]**

| Content | Requirement |
|---|---|
| Photographs, raster art | **300 dpi at final printed size** (240 acceptable for large-format viewed from a distance **[N]**) |
| Line art as raster | 600–1200 dpi, or better: vector |
| Type, logos, line art | **vector** — never rasterised |
| Screen previews | 150 dpi is enough to *look*; not enough to print |

Pixels needed = inches × dpi. A 4 in wide photo needs **1200 px**; a 12 in poster image
**3600 px**. Upscaling does not add detail; it adds blur that looks like a mistake on paper.

## Type **[D→C]**

| | Minimum | Comfortable |
|---|---|---|
| Body / contact lines, positive (dark on light) | 6 pt | 7–9 pt |
| Reversed (light on dark), sans | 7 pt | 8 pt+, weight up one step |
| Reversed, serif or thin | 8 pt | avoid below 9 pt — hairlines fill in |
| Legal / fine print | 5 pt **[N]** — some shops refuse | 6 pt |
| Flyer headline (arm's length) | 24 pt | 36–72 pt |
| Poster headline (10 ft) | ~1 in cap height ≈ **100–110 pt** | see below |

**Viewing distance → cap height [D]:** about **1 in of cap height per 10 ft** of comfortable
reading distance; halve it for "noticed but not read". A poster read from 20 ft wants a 2 in cap
height (≈ **200–220 pt**). The point size is the *em*, and a capital is only ~0.65–0.75 of it,
so the size to type is roughly **1.4 × the cap height you want** (72 pt gives a ~0.7 in cap).
Confirm by printing a proof and standing there.

## Lines **[D]** — a minimum exists **[C]**; the number is the shop's **[N]** (0.25–0.5 pt is the usual range)

| | Minimum |
|---|---|
| Positive line | 0.25 pt |
| Reversed line (light on dark) | 0.5 pt |
| Line in a second colour that touches another | 0.5 pt, or trap it |
| Screen-print line on fabric | see `apparel-design` — ~1 pt |

## Black and colour — **[C]** the black rules · **[D]** the gamut heuristic

- **Text black [C]:** 100% K only. Four-colour black text misregisters into a fuzzy coloured edge.
- **Rich black** for solid areas: **C60 M40 Y40 K100** **[D]** (some shops prefer C40 M30 Y30 K100 —
  ask **[N]**). That build is 240% total ink, which is why it is safe on uncoated stock.
- **Total area coverage (TAC) [N]:** press- and stock-specific — ~240% newsprint, 260–280%
  uncoated sheetfed, ~300% SWOP coated, up to 320–340% GRACoL. Over the limit the sheet does not
  dry and offsets. Ask for the shop's number before building a heavy black.
- **Registration black** (100/100/100/100) is for crop marks only, never for art **[C]**.
- **Gamut [D]:** press CMYK cannot reach saturated cyan, lime, orange-red or magenta at screen
  intensity. The lint warns above `oklch` chroma ~**0.14** — a *hue-dependent* heuristic, not a
  rule: process yellow and warm oranges print well above it, saturated blues and violets fail
  below it. Read the warning as "check this hue", and name a Pantone for anything that must match.
- **Spot colour:** name the Pantone (`Pantone 2945 C` — C for coated stock, U for uncoated; the
  same number looks different on each). Fluorescent/neon (801–814) and the metallics (871–877,
  and the four- and five-digit metallic ranges) are spot-only.

## Files **[D]**

| Deliverable | Format |
|---|---|
| Print file | PDF, trim + bleed, crop marks, fonts embedded, one file per side or a two-page file |
| Offset shop asks for | PDF/X-1a (CMYK, flattened) or PDF/X-4 (transparency ok) **[N]** |
| Spot-colour job | vector PDF with spots named, or separations |
| Preview for approval | PNG at 150–300 dpi |
| Editable source | the HTML/SVG this config authored — keep it |

**What this config produces:** RGB PDF + PNG from Chromium, fonts embedded as subsets (not
outlined). Digital and online printers accept it. Offset wants CMYK: ship the spec sheet naming
CMYK/Pantone intent and let prepress apply it — that is the reliable path. If Ghostscript
(9.54+) is present you can convert yourself, **but only with the black flags**:
`gs -sDEVICE=pdfwrite -sColorConversionStrategy=CMYK -dBlackText -dBlackVector -dPDFSETTINGS=/prepress -o out.pdf in.pdf`.
Without `-dBlackText`/`-dBlackVector`, the ICC conversion turns RGB black into a four-colour
build — exactly the fuzzy-edged text the rule above forbids. Either way this is a CMYK PDF, not
PDF/X-1a (which additionally needs `-dPDFX` and an output-intent definition file — ask the shop
whether they need it, most do not). Never label an RGB file as CMYK.

## Common stocks **[D]** — see `stock-finish-and-process.md` for what each one *means*

| Use | Weight | Notes |
|---|---|---|
| Business card, standard | 14–16 pt (≈ 350–400 gsm) | coated or uncoated |
| Business card, premium | 18–32 pt; 600 gsm cotton for letterpress | duplex/triplex layered |
| Flyer, handout | 100 lb text (≈ 150 gsm) | |
| Flyer, sturdy / rack card | 14 pt cover | |
| Poster | 100 lb gloss or matte text; 80 lb for short-term | |
| Brochure | 100 lb text or 80 lb cover | score folds on cover weights **[C]** |
| Sticker | vinyl (outdoor) or paper (indoor) | matte / gloss / clear |
