# Review — the passes

Rendered with `cgc print timetable.html --trim 297x420mm --bleed 3.175mm --png 150`, gated with
`cgc check .`, `cgc print-lint --size a3`, `cgc audit --viewport 1123x1587` and `cgc distinct`.
Six passes. Every one of them started by looking at the proof, and four of the six defects were
found by a gate rather than by reading the source — which is the argument for the gates.

## Pass 1 — the first proof was three problems at once

The masthead ran off the right edge of the paper, taking the last service column and the end of
the strapline with it; the header rule struck through the first station name; and the sheet
stopped two thirds down the page with the rest bare. None of that is visible in a stylesheet. It
is visible in one look at the render.

The name was set at 34pt because a masthead "should be big" — which is a habit, not a decision.
A timetable has no headline: the times are the content and the name is a label. 25pt, and the
strapline allowed to wrap under it rather than being pushed off the sheet.

## Pass 2 — the breakpoint fired on the paper

The route still did not reach the foot of the sheet after the minute was made taller, and the
reason was mine: `@media (max-width: 300mm)`, written for a narrow screen, matches an A3 sheet,
which is 297mm wide. The print render was re-scaling the piece being proofed, so the proof was of
a different design from the one that would be printed. Scoped to `screen`.

This is the whole case for rendering rather than reasoning. A breakpoint that fires on paper is
invisible in source and obvious in a picture.

## Pass 3 — what the audit found that the eye had accepted

`cgc audit` at sheet size: **ten runs of type under 12px** and **the colon painted at 1.81:1**.
The colon was set at 30% of the ink because it is the least important character in a time. It is
still a character — "06:12" with an invisible colon is "0612" — and 1.81:1 is not quiet, it is
gone. Raised to a derived tint of the ink rather than an opacity, and the small print raised from
6.5–7.5pt to 8–8.5pt. Above the press minimum was the floor; being read is the floor.

## Pass 4 — a gate that could not see the design

`print-lint` reported *no `@page` rule — the document has no physical size* for a sheet that
declares A3 in its stylesheet. It was reading the markup only, so for any piece whose CSS lives
in a separate file — which is nearly all real print work — it measured no type, no rules and no
rasters, and could have reported a pass having checked almost nothing. Fixed in the tool, not in
the design: `print-lint` now reads a page with the stylesheets it links, as the browser does.

The example found the defect because it was built the way real work is built.

## Pass 5 — the bleed was a real decision, not a formality

With the stylesheet finally visible, `print-lint` failed the sheet for having no bleed. That is
correct here and it is worth being explicit about why: the paper-coloured ground is **printed**
and runs off the edge, so a sheet authored at exactly trim comes back from the guillotine with
white slivers wherever the cut wanders. Authored at 303.35 × 426.35mm — A3 plus 3.175mm on every
side — with the inset moved into the sheet's own padding, because the renderer drives the PDF's
margins and a sheet with no padding of its own ran off the paper.

## Pass 6 — the rule through the first name

`padding-top` on the first row was a patch on a structural problem: minute zero began directly
under the header rule, so the axis and the rule occupied the same place. A 6mm gap track between
the head and the scale fixes it where it is actually wrong — the axis now starts below the rule
instead of on it, and the scale label moves with it because both are placed on the same track
list.

## Where it stands

`cgc check .` — press-ready, lint clean, techniques **considered** (7 of 52, across four
dimensions), audit no failures. The four dimensions it never entered are *time*, *depth*,
*response* and *generative*, and that is the answer a printed sheet should give: it does not
move, it has no layers, nothing can be clicked, and nothing is computed at view time.

`cgc distinct` — shares no axis with `harbor-swim-club` or `night-market`: a cool white ground
rather than their cream, a signal crimson at a different hue from their orange, Archivo Narrow
with IBM Plex Mono rather than Archivo, and a computed-grid grammar rather than a stacked or
placed one. That was the brief, and it is the only claim here a machine can settle.

What no gate settled: whether a station being 4.15mm-per-minute down the page actually helps
someone find their train. It does for the run across the fen, which is the part of the journey
worth knowing about. It costs a lot of paper to say so.
