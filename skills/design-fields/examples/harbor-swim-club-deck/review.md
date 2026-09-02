# Review — the passes

Rendered with `cgc render slide-NN.html --preset slide` (1920 × 1080 exactly, one
PNG per slide); gated with `cgc lint .` (clean) and `cgc audit slide-NN.html
--viewport 1920x1080` on every slide that carries more than a number (no failures, no warnings).
The audit passed every slide on the first pass; the eye did not.

## Pass 1

**The sequence works** — the waterline rising a step per slide reads as one thing happening,
and one number per slide is the discipline the room needs. Four slides failed by eye, none of
them in a way the audit measures:

- **Slide 3, the chart:** the bars stood 520 px tall from the waterline and climbed straight
  through the title. A chart that belongs to a slide has to stand *under* its takeaway.
- **Slide 6, the tide table:** the waterline cut through the ledger's header, between "Date"
  and the first row — a rule in the wrong place, which is worse than no rule.
- **Slide 7, the flag:** drawn at 420 px and lifted by its full height, the pennant sat above
  the top of the slide; only the pole showed.
- **Slide 2, the number:** the line beneath 412 ran three lines and the third fell below the
  waterline — the caption was half under water.

**Changes.** The chart scales at 5 px per swim on a 340 px stage, values above the bars, months
on the last line above the water; the title at 84 px on two lines with the chart's stage
starting below it. The ledger's header sits on the waterline, so the water is the header's
rule. The flag is 240 px and lifted by 87.5% of its height — the pole's foot in the drawing —
so it stands on the water with the whole pennant on the slide. The caption on slide 2 starts
higher and runs wider, two lines, all above the line.

## Pass 2

Every slide re-rendered and audited; the four read as intended. Slides 1, 4 and 5 held from the
first pass: the mark and the name at low water; the twelve temperatures on the line with the
coldest set large; the members' number with its arrow.

The professional's questions for a deck, each a yes: one idea per slide; the room's type sizes
(nothing under 28 px, the numbers at 440); a title-safe inset the projector's overscan cannot
eat; the takeaway *as* the chart's title, one series emphasised, the axis labelled once, no
legend; the tide table set as data, not as cards; no transitions — the rising waterline is the
deck's only motion; the signal orange used once, on the flag; two faces; the club's own
words; the sentence — *seven slides through which the tide comes in, one number at a time* —
describes no template.

**Considered and not made:** the chalk-tally slide (direction 2) as a second treatment of the
412. It would be the deck's second bold move, and the room only needs one. The loop ends here.
