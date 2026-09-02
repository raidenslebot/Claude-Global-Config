# Review — the passes

Rendered with `node tools/screen-render.mjs contact-sheet.html --mobile`; gated with
`slop-lint` (clean) and `node tools/page-audit.mjs contact-sheet.html --mobile` (no failures, no
warnings at 1440 and 390). Each icon file is written from the sprite by `split.mjs`, so the
master and the delivered files cannot drift.

## Pass 1

**The rule reads.** At 48 the waterline is visible in every icon and the relation carries the
meaning: the flag and the thermos above it, the float half under, the tide and the thermometer
crossing it, dawn resting on it. At 24 without labels, six of eight read at once; `swim` and
`thermos` need the rule known, which the sheet gives before the labels. **Weakest thing:**
`wall` read as the letter F — a vertical with two horizontals to the right is a glyph, not a
quay. The idea was right (the one object the line *stops at*) and the drawing was generic.

**Change.** The wall became the harbour steps: `M13 21v-9h4V8h5` — two treads coming down to
the water. Swimmers climb them; nothing else in the world has that profile; and the waterline
still stops at the wall's face. The sheet's copy says "steps" where it said "wall".

## Pass 2

The steps read at 24 and at 48, on cream and on navy. No failures, no warnings.

The professional's questions for a set, each a yes: one drawing rule, stated, from the
subject; one stroke weight, one cap and join, one grid, coordinates on the pixel grid; one
metaphor per concept; the set works without labels once the rule is known; `currentColor` on
both grounds; SVG hygiene (a viewBox, no transforms, no groups, no styles inside a symbol); a
master and per-icon files that cannot drift; sizes redrawn rather than scaled — and at 16,
where the rule would fail, the honest answer is not to deliver, and to say why.

**Considered and not made:** a filled variant for "active" states, and a 16-pixel redraw. The
first is a second rule; the second has no room for the rule. The loop ends here.
