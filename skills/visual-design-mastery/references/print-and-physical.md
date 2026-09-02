# Print & physical — paper, fabric, and the things you can hold

Everything in the creed still applies when the output is a business card, a flyer, a poster or a
t-shirt. What changes is that the constraints are **physical**, the viewing distance is **real**,
and the material is a **design decision** rather than a default you inherited from a browser. The
screen has one surface; a printed piece has stock, weight, finish, two sides, edges, and a fold.
Most of what makes physical work memorable happens in those places — and every one of them is
invisible to a model that thinks a business card is a 3.5×2 rectangle of pixels.

**Prove the far read, never assert it.** `node tools/print-render.mjs piece.html --size <preset>
--distance 40ft,10ft,2ft` writes one PNG per viewing distance at the angular size the eye actually
gets; hold the screen at 12 in (or pass `--viewer`) and you are standing there. A poster judged at
full size on a monitor was judged from two feet — the one distance a poster is never read from.

This file carries the taste. The craft — sizes, bleed, colour, print methods, placement, the
render pipeline — lives in two technique skills: [`print-design`](../../print-design/SKILL.md)
for anything a printer produces, [`apparel-design`](../../apparel-design/SKILL.md) for anything
on a garment. Read this first, then the one that matches.

---

## The physical centroid — recognise it and refuse it

The "AI made this" look has a print edition. It is what you get when a screen layout is scaled
to paper:

- **The white card with the logo top-left**, name in bold, four contact lines in 8pt sans, one
  accent colour, on default 14pt gloss. Every card in the world. The design made no decision
  the printer could not have made for you.
- **The flyer with a centred headline, a hero image, three bullet points and a QR code**, all
  the same visual weight, in Montserrat, on Letter. Reads at arm's length, dies at six feet.
- **The poster that is a big flyer.** Same hierarchy, just larger, so the body copy is legible
  from across a room and the headline is not *seen* from across a room.
- **The t-shirt with a logo centred on the chest**, or a slogan in Impact/Bebas across it.
  Nobody chose the placement; the template did.
- **A single "textured" overlay** (paper grain, halftone, grunge) on top of any of the above,
  mistaken for craft.
- **RGB colours that will not print** — an electric cyan or hot magenta chosen on a screen that
  turns to mud on press, with nobody having named a Pantone or checked a gamut.

The through-line, as ever: no decisions were made. The material was inherited, the size was
inherited, the placement was inherited, the reading distance was never considered.

---

## What the creed means when the object is real

**1 · Intention over default — the stock is a value too.** On screen every value is a colour or a
size. In print, the *paper* is a value: weight, texture, colour, finish, two sides. "14pt gloss"
is the `#808080` of print — a confession that nothing was chosen. A black card with white ink, a
600gsm cotton with a deep letterpress impression, an uncoated warm-white with a single spot
colour: each is a decision that most of the audience will feel and none will name. Choose the
stock the way you choose the typeface. See `print-design` → *stock, finish and process*.

**2 · Spend boldness in one place — and the place can be physical.** The one hero move on a card
does not have to be on its face. It can be the edge (painted), the shape (die-cut), the finish
(a single foil word on matte black), the *back* (the front is one word; the back is everything),
the format (square, vertical, mini, folded). A physical hero move is remembered far longer than
a visual one, because people *handle* it. Then keep the rest quiet — one bold physical decision
and restrained type beats a card that is trying five things.

**3 · Motion is meaning — and here the motion is the reader's.** Nothing animates on paper, but
the reader moves: they turn the card over, they unfold the brochure, they walk past the poster.
Design the *sequence*: what the front says, what turning it over reveals, what each panel of a
fold discloses in order. A tri-fold whose panels read in the wrong order is a broken transition.

**4 · Hierarchy is the whole job — measured in feet, not pixels.** A poster is read at ten
feet, then at three, then at one. Three reading distances, three tiers, and the far tier has to
work with *one* element. Decide what someone learns walking past at 10 ft (one thing), what they
learn if they stop (a second), and what they learn if they lean in (the rest). A flyer has two
distances; a business card has one, and it is six inches — which is why a card can carry 7pt
type and a poster cannot carry 12pt.

**5 · The details are not details — and in print they are permanent.** A 1px misregistration on
screen is a subpixel. On press it is a visible white sliver between two colours. Thin hairlines
drop out; small reversed type fills in; a 5pt contact line is unreadable; an image at 150 dpi is
soft. Nothing can be patched after the run. Every detail is a decision you make *before* the
proof, and the `print-design` skill lists the ones that cannot be skipped.

**6 · Typography carries the room — and print rewards it more than any screen.** Paper resolves
detail a display cannot: true small caps, real italics, hairline serifs, optical sizes, tight
tracking at display size. The single fastest lift for a card or a poster is one characterful
face used with confidence — a real display cut at display size, a real text face at text size,
and *nothing else*. A card set entirely in one beautiful typeface, with the right stock, needs
no logo, no accent, no ornament.

**7 · Ground it in the subject — physical media makes this easier, not harder.** A tattoo studio,
a bakery, a law firm, a synth maker, a climbing gym: each has materials, a vernacular, a tempo.
The card for a letterpress studio *is* letterpress. The card for a tattoo artist can be printed
on the stock tattoo stencils use. The bakery's flyer can be the shape of a bread bag. Mine the
subject's own world (`creative-divergence` Step 1) and let it choose the medium. This is where
print work becomes specific instead of merely tasteful.

**8 · Restraint, and the earned break.** Print's most common failure is doing too much with a
small surface. A card that says one thing, a flyer with one image and one line, a poster that is
mostly empty — these read as *expensive* precisely because of what they leave out. Then earn the
one break: the one oversized element, the one thing that bleeds off the edge, the one colour at
full chroma on an otherwise monochrome sheet.

**9 · Constraints, strong defaults, and numbers.** Physical work has more hard constraints than
any screen medium, and they must never be dressed as taste: bleed exists because cutters wobble;
the safe zone exists because they wobble the other way; rich black exists because 100K alone
prints charcoal; minimum type sizes exist because ink spreads; embroidery cannot do gradients
because thread is thread. The technique skills mark each rule as *constraint* (do not argue) or
*strong default* (deviate when you can say why) or *number to tune with the printer*. Keep those
categories straight, and when in doubt about a physical fact, **ask the printer or the shop**
— their press and their thread are the ground truth, and every number in these files is a
starting point.

---

## The pipeline this repo actually has

Physical work needs an output a printer can take. The default model output — a paragraph
describing a design — is worth nothing to a print shop. This config ships a real, local,
keyless path:

1. **Decide** the direction with `creative-divergence` (the operators apply directly, and the
   `print-design` skill adds the ones that only exist because the medium is physical).
2. **Author at physical size.** HTML/CSS in `in`/`mm`/`pt` units with an `@page` rule, or an
   SVG with a physical `width`/`height` and a `viewBox` in the same units. Never pixels.
3. **Render** with `tools/print-render.mjs` — headless Chromium (already installed for the
   Playwright MCP) produces a PDF at trim + bleed with crop marks, and a PNG preview at 300 dpi.
4. **Gate** with `tools/print-lint.mjs` — type under the minimum, hairlines that will drop out,
   rasters under 300 dpi at placed size, and a missing size declaration all fail. A design that
   would not survive the press does not leave the machine.
5. **Judge** the execution against the creed above. Fine is the enemy on paper too.

For apparel, step 3 also composites the artwork onto an SVG garment flat at true scale, so
placement and size are seen before anyone orders a hundred shirts.

**Stated limitation:** Chromium emits RGB. Most online print services accept RGB PDFs and
convert; a professional offset shop wants CMYK or PDF/X. The `print-design` skill says how to
hand them what they need — a spec sheet naming the Pantone or CMYK intent beside the RGB file,
or a conversion step if Ghostscript is present. It does not pretend the browser is a RIP.

---

## Route to the craft

| You are making… | Read |
|---|---|
| Business cards, flyers, posters, postcards, brochures, menus, invitations, stickers, labels, packaging | [`print-design`](../../print-design/SKILL.md) |
| T-shirts, hoodies, caps, totes, jerseys, anything printed or embroidered on fabric | [`apparel-design`](../../apparel-design/SKILL.md) |
| A poster that is *art* first — a movement, a manifesto, an image | the host `canvas-design` skill for the philosophy; `print-design` for making it printable |
| A logo or mark the piece will carry | `creative-divergence` for the concept; `print-design` → *marks that print* for the constraints (single colour, reversible, legible at 0.5 in) |
