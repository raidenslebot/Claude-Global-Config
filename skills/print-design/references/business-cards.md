# Business cards — one hero move, one reading distance

A card is read at six inches by someone holding it, usually once, usually while doing
something else. It has two sides, four edges, a weight, a texture, and a shape. It is the
smallest surface a brand ever prints on and the one people actually keep. Most of what makes a
card memorable is not on its face.

## The centroid — refuse it

White 14 pt gloss. Logo top-left. Name in bold, title beneath. Four to seven contact lines at
8 pt in a neutral sans, right- or bottom-aligned. One accent colour, usually as a bar or a
corner. Blank back, or the logo again, larger. Rounded corners "for a modern feel".

Nothing about it was decided. Swap the name and logo for a competitor's and it is their card.

## Decisions, in the order they should be made

1. **What is the one thing this card must do?** Be remembered. Be kept. Be handed on. Be
   found in a wallet a year later. Pick one; it decides everything else.
2. **Stock and finish before layout.** Read `stock-finish-and-process.md`. The stock *is* the
   design for most great cards: black with white ink; thick cotton, letterpressed; kraft with
   one colour; a translucent card; a card that is not paper. Choose from the subject's own
   materials — a tattoo studio, a bakery, a tailor, a synth maker each own a texture.
3. **Format.** US 3.5 × 2 is the default and therefore the centroid. Square, vertical, mini,
   folded, or a die-cut shape costs a little more and reads as a decision. Vertical cards
   are underused and very effective for a name-forward design.
4. **What goes on each side.** Two sides, two jobs. The best pattern by far: **front = one
   thing** (the mark, the name, or nothing but the stock and one word); **back = everything
   else**. Handing the card over becomes a two-beat sequence: the front is the impression,
   the back is the information.
5. **Which three contact lines.** Not seven. A name and *the one way to reach you* is often
   enough; name, role, and one channel is the norm. A QR code is a fourth line — only if it
   is designed in (quiet zone, size ≥ 0.75 in, high contrast, and something worth scanning).
6. **The type.** One characterful face, or a display/text pair, set with real care: tracked
   display, true small caps for the role, tabular figures for a phone number, a real italic
   for an email. At 6 in, the reader *sees* kerning. Contact lines 7–8 pt in a text face.
7. **The hero move — one.** Stock, shape, finish, format, the back, or type. Not two.

## Hierarchy at six inches

- The eye lands on **one** thing. Decide which: the name, the mark, or a single word.
- Second tier: what the person does (title, or a one-line description that is more honest
  than a title).
- Third tier: how to reach them. Small, quiet, in a text face, aligned to a grid the eye can
  follow.
- Empty space is the fourth element. A card that is 60% empty reads as confident.

## Physical facts that bite on cards specifically

- **Safe zone [C].** 0.125 in inside the trim — 3.6% of a card's width and over 6% of its
  height. Type or a mark that sits within it will be clipped on some cards in the batch.
- **Edge-to-edge colour** needs bleed, and a full-bleed *dark* card shows every cutting
  imperfection as a white sliver. Painted edges or a **through-dyed** stock (coloured all the way
  through) solve it properly — a coloured *core* between white plies still shows white either
  side of it; a hairline white border is the cheap fix and reads as a choice if it is even.
- **Small reversed type** (white on dark) below 8 pt fills in — go up a size and a weight.
  White ink and foil spread *more* than reversed process ink: treat 8 pt as their floor.
- **Solid dark backgrounds** on gloss show fingerprints; on matte or soft-touch they do not.
  Soft-touch is the finish that makes a dark card feel expensive.
- **Rounded corners:** 1/8 in radius is subtle, 1/4 in is a statement; both keep corners from
  dog-earing.

## Moves that work (pick one)

| Move | What it looks like |
|---|---|
| **Black stock, white ink** | Name only on the front; the back carries the rest in 8 pt white (white ink spreads — not 7). Feels like a ticket to something. |
| **Letterpress on 600 gsm cotton** | One colour, deep impression you can feel with a thumb. The impression is the design; keep the layout to a name and two lines. |
| **Triplex with a coloured core** | Two white plies laminated around a fluorescent or black one; the colour shows as a stripe on the edge. (Two plies is a duplex — two colours, one edge line.) |
| **One foil word** on matte black or uncoated navy | Everything else blind-debossed or in 8 pt white. |
| **Vertical, type only** | Name running up the card in a display serif at 36 pt; contact lines horizontal at the foot. |
| **The die-cut object** | The card *is* the thing the client makes — a pick, a leaf, a key, a bread loaf. No decoration on top of it. |
| **The mini** | 2.5 × 1.5 in, one word and one channel. Fits in a phone case. |
| **The blank front** | Stock and finish only; a small mark bottom-right; everything on the back. Confidence as design. |
| **Tonal** | Ink one step from the stock colour (charcoal on black, cream on natural); read by tilting. |

## What the file has to be

Authored at trim + bleed (3.75 × 2.25 in for US), safe zone respected, type at 7–8 pt in a
text face, black as 100K, backgrounds as rich black if solid, one PDF per side (or a two-page
PDF), plus the spec sheet: stock, weight, finish, colours by name, sides, quantity, corners,
special process. `node tools/print-render.mjs front.html --size business-card-us --marks --png 300`
then `node tools/print-lint.mjs front.html --size business-card-us`.
