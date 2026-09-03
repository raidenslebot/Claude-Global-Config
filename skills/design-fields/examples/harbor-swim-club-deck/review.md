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

## Pass 4 — the water was never water

Looked at the renders again, all seven, side by side. The deck says its idea out loud in the
stylesheet — *"the waterline rises through the deck"* — and then draws it as a **four-pixel
rule**. A line moving up a slide is a divider. Nothing was ever in the water, so the bottom of
every slide was not air, it was leftover: on the chart slide, a third of the frame held one page
number.

**The water is water.** Below the line is the sea, above it is the air, and the line is only
where the two meet. That one change answers three separate weaknesses at once:

- The empty bottom of every slide becomes the thing the deck is about.
- The rise is *visible* across the seven, because each slide is more submerged than the last —
  which is what "the tide comes in as we go" was always supposed to mean.
- Things can now be **in** it. The month labels under the bars are underwater and set in cream;
  the tide table's rows are in the sea with only its header above the surface, which is the
  reason the waterline was put through that table in the first place; the temperatures on slide
  four stand exactly *on* the surface with their months below it.

**The reversed slides went.** Slides two and seven were flagged `rev` — navy ground, cream ink —
which was a second way of saying "the tide is high" that disagreed with the first about which way
up the slide went. Slide seven had the sea at the top. A slide is dark now because the water has
risen, and for no other reason: seven closes as 78% sea with the flag standing at the surface,
which is a better last image than a flat navy field with a small flag on it.

**The orange finally does something.** `--orange` was declared in the palette and used on exactly
nothing across seven slides. January — fifty-one swims, the record, the whole point of that slide
— is now the one thing on the deck in that ink, and the flag on the closing slide is the other.
One colour, two uses, both of them the subject.

**What the audit caught that the eye did not.** Four runs of type went invisible when the ground
moved under them — navy on navy — and one of the reports was the audit's own fault: it reads the
declared ink from `color`, and SVG text is painted with `fill`, so a cream chart label came back
as navy-on-navy. That is fixed in the tool. The other three were real, and are fixed here.

All seven slides pass at 1920 × 1080 with no failures.

**Still conventional by the ambition measure, and that is the decision.** Four of fifty-two: a
deck that must survive export to PDF and a projector in a hall cannot lean on masks, blends or
scroll-driven anything. What it does use is the part that matters — one custom property carrying
the composition through seven files.
