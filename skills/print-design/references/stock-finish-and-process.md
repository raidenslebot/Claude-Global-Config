# Stock, finish and process — what each one means

On screen every surface is glass. On paper the surface is a decision that the reader feels
before they read a word. This is the vocabulary, what each choice *communicates*, what it
costs, and what it constrains. Confirm availability and exact specs with the printer **[N]** —
every shop has a different house stock list.

## Stock

| Stock | Feel / message | Constraints |
|---|---|---|
| **Coated gloss** (C2S) | Bright, saturated colour; photographic; "advertising" | shows fingerprints on dark solids; hard to write on |
| **Coated matte / silk** | Saturated but calm; "considered" | the most forgiving default for full-colour work |
| **Uncoated** (offset, text, bond) | Warm, tactile, "editorial", "honest" | ink soaks in — colours ~10–15% duller, fine type spreads slightly; takes a spot colour beautifully; writeable |
| **Cotton / 100% rag** (Crane Lettra, Gmund Cotton, Somerset) | Soft, thick, luxurious; the letterpress stock | expensive; uncoated behaviour; deep impression possible |
| **Kraft** | Brown, fibrous, "craft", "workshop" | only dark inks and white ink read; no full-colour photos |
| **Coloured stock** (Colorplan, Keaykolour, French Paper) | The colour is free — one ink on a coloured sheet is a two-colour job | light inks need white underprint or vanish |
| **Duplex / triplex** | Two (duplex) or three (triplex) plies laminated; a coloured middle ply shows as a *stripe* on the edge, white plies either side — only a through-dyed stock or painted edges give a solid coloured edge | thick (32 pt+); premium cost |
| **Translucent / vellum** | Sees through; layered when stacked | light inks vanish; heavy inks show through from the back |
| **Synthetic** (Yupo, polyester) | Waterproof, tear-proof, smooth, faintly plastic | ink dries slowly; some finishes will not take |
| **Wood, metal, acrylic, seed paper** | The object *is* the message | laser-etched, engraved, or specialty-printed; long lead times |

**Weight:** points (pt, thickness, US cover) or gsm (grams per m², everywhere else). For coated
board, roughly: 10 pt ≈ 250 gsm, 14 pt ≈ 350, 16 pt ≈ 400, 24 pt ≈ 600 — an approximation that
depends on density, not a ratio: a soft 600 gsm cotton is ~40 pt thick. "Text" weights (60–100 lb) are for
pages and flyers; "cover" weights (80–130 lb) for cards and covers. Thicker reads as more
expensive, up to the point where it reads as a coaster.

## Finish and coating

| Finish | Effect | Where it works |
|---|---|---|
| **Matte lamination** | Flat, fingerprint-resistant, slightly muted | the safe premium default |
| **Soft-touch / velvet lamination** | Suede feel; deepens dark colours; people keep touching it | dark cards, covers; the single most "expensive-feeling" finish |
| **Gloss lamination / UV** | Wet-look shine | photographic pieces; rarely for type-led work |
| **Spot UV / spot gloss** | Gloss on a matte sheet, only where you put it | a mark or a word that appears when tilted; invisible in flat light — a hero move, not a garnish |
| **Aqueous coating** | Light protective coat, near-invisible | flyers, anything handled |
| **Uncoated, nothing** | The stock as it is | when the stock *is* the design |

## Process — ink and beyond

| Process | What it does | Constraints |
|---|---|---|
| **Offset (litho)** | The standard for quantity; CMYK and spot; exact colour | setup cost; minimum runs; wants PDF/X |
| **Digital** | Short runs, fast, variable data | CMYK on most presses; some (HP Indigo) add white, fluorescent or spot inks — ask **[N]**; toner or liquid ink sits on top; slightly less range |
| **Letterpress** | Type pressed *into* soft stock; the impression is felt | one colour per pass (two or three passes are normal); no gradients or large solids; thin lines only if the plate holds them; a soft stock for deep impression — cotton is the classic, not a requirement |
| **Foil (hot-stamp)** | Metallic, pigment, or holographic foil pressed on | solid shapes and type, not fine detail below ~0.5 pt or 6 pt; one colour per pass |
| **Emboss / deboss** | Raised / recessed shape, with or without ink | needs a die; softer stock shows it better; blind (no ink) is the elegant version |
| **Die-cut** | Any outline | needs a die; inside corners want a radius ≥ 1/16 in; nothing thinner than ~1/8 in |
| **Edge painting / gilding** | Colour or metal on the cut edges | needs a thick stock (≥ 24 pt) to be seen |
| **Risograph** | Stencil duplicator; spot inks, textured, misregistered | 1–2 colours per pass; no large solids; A3 max; grain and misregistration are the look |
| **Screen print (paper)** | Thick opaque ink, any colour, on any stock | one screen per colour; posters, thick inks on dark or kraft |
| **White ink** | Opaque white on dark or clear stock | digital white or screen; makes light designs possible on black/kraft/clear |
| **Thermography** | Raised, glossy ink (the cheap emboss) | reads as "corporate 1995" unless used knowingly |

## Choosing — the questions, in order

1. What does the subject's world *feel* like? (A tattoo studio, a bakery, a law firm, a
   festival.) Pick the stock that belongs to that world.
2. What is the one hero move? Stock, finish, process, shape, format, or the back. One.
3. What run size and budget? Letterpress and foil are for hundreds; digital for tens; offset for
   thousands.
4. What must the piece survive? Wallets (thick, matte), rain (synthetic, laminated), a year on
   a fridge (uncoated, no lamination to peel).
5. Ask the printer for a **sample pack** before committing. The screen cannot show you paper.

## The spec sheet — ship it with every file

Printers read this before the PDF. One per piece.

```
PIECE:        business card, front + back
TRIM:         3.5 x 2 in            BLEED: 0.125 in        SAFE: 0.125 in
STOCK:        600 gsm cotton, natural white (e.g. Crane Lettra Pearl White) — or shop equivalent
PROCESS:      letterpress, 1 colour, deep impression
INK:          Pantone Black 6 U (both sides)
FINISH:       none (uncoated)      CORNERS: square
SIDES:        2, both letterpress
QUANTITY:     250
FILES:        card-front.pdf, card-back.pdf (RGB, trim + bleed, crop marks; fonts embedded as
              subsets, not outlined — say if you need outlines; colour intent as above —
              please apply spot)
NOTES:        Impression to be visibly deep on the name; contact lines lighter.
              Please send a proof before the run.
```

For process colour, replace the INK line with CMYK builds (`rich black C60 M40 Y40 K100; accent
C0 M85 Y70 K0`) or `CMYK from the RGB file — please match to the attached PNG proof`.
