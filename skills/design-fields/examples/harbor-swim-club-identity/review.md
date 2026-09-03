# Review — the passes

Rendered with `cgc render brand-sheet.html --full` and the icon master with
`--preset app-icon`; gated with `slop-lint` (clean) and `cgc audit
brand-sheet.html --mobile`; the tee's mark, which now carries the outlined wordmark, re-gated
with `cgc print-lint --method screen` and re-rendered as a mockup.

## Pass 1

**The sheet reads as a sheet** — masthead, the mark on cream and reversed, the lockups, the
one variable, clear space, minimum sizes with the favicon redrawn, colour, type, the list of
nevers. **Weakest thing, by eye:** the horizontal lockup on cream had **no waterline** — a ring
beside a word, which is exactly the "ring without its waterline" the sheet forbids. The reversed
one had it. Cause: the generator strips the physical width and height from each SVG's root
before inlining, with a bare first-match regex; on the cream lockup, whose root has no size,
the first match was the bar itself. **Second:** the lockup's ring stroke (6.4 units at that
scale) read lighter than the letters' stems (about 9), so the two did not sit as one weight.
**By the audit:** the clear-space figure was a fixed 480 px, so the page scrolled sideways at
390 px; the heading widowed "under" on the phone; the type caption ran to 120 characters.

**Changes.** The regex anchors on the root tag. The lockup's ring stroke is 9 and its bar 4.5 —
the mark redrawn for the size it is used at, which is the favicon's rule applied one size up.
The inlined art gets `max-width: 100%`; the heading `text-wrap: balance`; captions a 62ch
measure.

## Pass 2

Waterline present on every ring; ring and letters one weight; the sheet audits with no failure
and no warning at 1440 and 390; one saturated hue at 1% of the page, the orange chip. The tee
mockup shows the outlined HARBOR under the ring at the size the placement sheet states, and
`print-lint` passes it for screen print.

The professional's questions, each a yes: the glance lands on the mark and learns "a ring,
half under"; the sentence — *a life-ring half under the water, drawn once, with signage
lettering that never raises its voice* — describes no template; with another club's name the
waterline and the tide variable stop meaning anything; the structure is a system (versions,
one variable, a redraw for size), not a font and a colour; one face, outlined where it is
delivered; three colours with the third used once; hairlines and one grid; copy in the club's
words; no motion, chosen; the sheet survives the phone; every deliverable a shop or a
developer asks for is a file beside this one.

**Considered and not made:** a second wordmark weight for the stacked lockup; a fourth
colour for the website. The first is a second voice; the second is what the sheet forbids.
The loop ends here.

## Pass 4 — the one variable read as two pictures

Looked at the sheet again, whole. The weakest thing is the section the whole identity turns on:
**the one variable**. Two tiles, each a ring with a bar, the bar in a slightly different place.
Side by side at that size the difference is something the reader has to hold in memory and
compare — so the variable reads as *two pictures of a ring* rather than as one line moving.

**Change.** The high-water tile now carries a ghost of the slack-water line at 14% and an orange
tick showing the rise between them. You see the movement instead of reconstructing it, and the
caption gives the number: 58 units above slack.

Two constraints that shaped how it was done:

- **The ghost is a note on the sheet, never on the artwork.** `mark-high-water.svg` is a
  delivered file and the sheet's own NEVER list forbids anything but the ring and its line. So
  this one tile is drawn in the generator rather than inlining the SVG, with a comment saying
  why — every other tile on the sheet inlines its file, and the difference would otherwise look
  like an oversight.
- **The change went into `generate.mjs`, not into `brand-sheet.html`.** The sheet is generated.
  Editing the HTML looks like it worked and is reverted the next time anyone runs the generator,
  with nothing said. That is now a test: whatever is checked in has to be what the generator
  produces.

The sheet passes at 1440 and 390 with no failures.
