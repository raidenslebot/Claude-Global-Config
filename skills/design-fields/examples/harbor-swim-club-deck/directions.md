# Directions — Harbor Swim Club, the annual-meeting deck

Written before any markup. The subject is the club of the identity, tee and icon examples; the
brief is the seven slides its committee shows at the annual meeting, in the club's own hall,
from a projector that has seen better days. A deck is a sequence, not a document.

## DNA — the club's world, in a room

| Ask | Answer |
|---|---|
| **Materials** | the changing-room door with the tide table pinned to it; the whiteboard where the season's swims are counted in chalk, five strokes at a time; the thermometer; the flags; a projector on a trestle table |
| **Motifs** | the tally — swims are counted by hand; the waterline; the tide's rise; one number that everyone in the room already half knows |
| **Palette from source** | navy on cream, cream on navy; chalk |
| **Tempo** | one thing at a time; a room that nods before the next slide |
| **Vernacular** | "swims", "the wall", "high water", "9 degrees", "between the flags", "dawn" |
| **Rules of the world** | nothing is shouted; the numbers are the club's own, and the room can check them; the tide is the calendar |
| **Where it is seen** | 16:9 from the back of a hall, on a projector that overscans and washes out; then as a PDF in the members' inbox |

## Directions

1. **The tide comes in.** *Temporal signature:* every slide carries the identity's waterline,
   and it rises through the deck — low water on the title, high water on the last slide, where
   the flags are. The sequence *is* the tide; the room feels it before it notices it.
   *Swap test:* a company's quarterly deck has no tide to rise. **Survives.**
2. **The chalk tally.** *Material transplant:* every number drawn as tally strokes on navy, the
   way swims are counted on the whiteboard — 412 swims as 82 gates of five. *Swap test:* survives
   for anything counted by hand; too much for a whole deck, and unreadable from the back for
   any number over a hundred. **One slide's move, not the deck's.**
3. **One number per slide.** *Extreme parameter:* the number at a fifth of the width, one line
   beneath it, nothing else. *Swap test:* any deck with a number. **The centroid of "good"
   decks — a discipline, not a direction.**
4. **The ledger deck.** *Cross-domain grammar:* every slide a page of the club's ledger, dotted
   leaders, tabular figures. *Swap test:* survives; the identity sheet already uses it. **Right
   for the tide-table slide, monotonous for seven.**

## Committed

**Direction 1, with 3 as its discipline and 2 and 4 each given one slide.** The waterline is at
88% of the height on the title and reaches 22% on the last slide, one step per slide. Seven
slides, one idea each:

1. The title — the mark, the name, the date; low water.
2. **412 swims** — the number; beneath it the one line.
3. **Swims by month** — a bar chart with the waterline as its axis: twelve bars, the busiest
   month in navy and the rest in a lighter ink, the takeaway *as the title*, the axis labelled
   once (the `dataviz` rules: one series emphasised, no legend, no chart junk).
4. **The water** — twelve temperatures in a row, tabular, the coldest set larger.
5. **61 → 84 members** — the number, the arrow, one line.
6. **High water, October** — the tide table as the ledger (direction 4's slide).
7. **Swim between the flags.** — the flag icon at the top of the tide, and nothing else; high water.

- **Canvas.** 1920 × 1080 (`--preset slide`); everything inside a 5% title-safe inset, because
  the projector overscans [D]. Delivered as the HTML slides and a PDF.
- **Type.** The room decides: titles 96 px, the numbers 440 px, body 40 px, labels 28 px in
  the mono — nothing under 28 px, so the back row reads it. Archivo (the identity's face, at
  width 75 weight 600 for titles, width 100 for body) and JetBrains Mono for figures.
- **Colour.** Cream slides, navy ink; the tally slide reversed (chalk on navy). The signal
  orange appears once in the whole deck: the flags.
- **Motion.** None between slides — transitions are off [D]; the rising waterline is the
  deck's motion, one step per slide.
- **The chart.** Drawn as SVG by hand, twelve bars, values from the club's own tally; the
  waterline is the baseline, so the chart belongs to the deck rather than to a library.

One sentence: *seven slides through which the tide comes in, one number at a time.*
