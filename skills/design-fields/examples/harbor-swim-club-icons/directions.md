# Directions — Harbor Swim Club, the icon set

Written before any drawing. The subject is the club whose identity and tee are the other two
examples; the brief is the eight icons its website and app need. An icon set is one drawing
rule applied many times, so the direction here is the rule.

## DNA — the same world, at 24 pixels

| Ask | Answer |
|---|---|
| **Materials** | cold water; the harbour wall; tow-floats; the flags; a thermos on the wall; the tide table; the thermometer on the changing-room door |
| **Motifs** | the waterline — the identity's one variable, and the thing every object in this world is above, below or half under |
| **Palette from source** | navy on cream, cream on navy; the icons are `currentColor` and take the surface's colour |
| **Vernacular** | "a dip", "high water", "9 degrees", "the wall", "between the flags", "dawn" |
| **Rules of the world** | the ring is never decoration; nothing is shouted; the water is always there |
| **Where it is seen** | navigation and status in an app and on a site, at 24 px on a phone and 48 px on a card; never below 20 px — below that the mark alone is used |

## Directions — one drawing rule each

1. **The waterline through everything.** *Constraint amputation:* every icon is an object and
   one horizontal line at the same height, the waterline; the object is above it, below it or
   crossed by it, and that relation is the meaning. *Swap test:* a gym's or a café's icons
   have no water to be above or below; the rule is the club's. **Survives.**
2. **The ring as the frame.** Every icon inside the life-ring. *Cross-domain grammar* (badges).
   *Swap test:* any circle-framed set; and the ring becomes decoration, which the identity
   forbids. **Fails.**
3. **Chamfered, like harbour signage.** A 45° cut on every corner as the set's one rule.
   *Material transplant.* *Swap test:* survives — but it says "industrial" and nothing about
   water. **Runner-up.**
4. **Filled silhouettes.** Solid shapes, no strokes. *Extreme parameter.* *Swap test:* a solid
   set is every default app set. **Fails.**

## Committed

**Direction 1.** Eight icons; one rule.

- **Grid.** 24 px, live area 20 (2 px padding), stroke 2 px, round caps and joins, `fill: none`,
  `stroke: currentColor`. Coordinates on the pixel grid so 2 px strokes render crisp at 24
  and 48.
- **The rule.** A horizontal at `y = 14` in every icon — the waterline. Above it: the flag, the
  thermos, dawn, the swimmer. Crossed by it: the float, the rising tide, the thermometer, the
  wall (which stops it). The line is drawn once per icon and never omitted; without it an
  icon is not in the set.
- **The eight.** `swim` (a head and an arm above the line), `dawn` (a half sun on the line),
  `tide` (an arrow rising through it), `temperature` (a thermometer crossing it), `wall` (the
  quay meeting it), `flag` (the pole crossing it, the pennant above), `float` (the ring, half
  under — the mark at icon scale), `thermos` (the flask standing on it).
- **Sizes.** Drawn at 24; delivered at 24 and 48 (the 2 px stroke becomes 4, still one weight).
  **Not at 16.** At 16 the stroke would be 1.3 px and the waterline would merge with the
  objects; the mark's favicon covers that size. Redraw, don't scale — and here, don't draw.
- **Metaphor discipline.** One object per concept; no icon needs its label to be understood
  once the rule is known, and the contact sheet shows them without labels first.
- **Delivery.** `sprite.svg` (`<symbol>`s, `currentColor`), one file per icon as
  `kebab-case.svg` (written by `split.mjs` from the sprite), and `contact-sheet.html` at 24
  and 48 on cream and on navy.

One sentence: *eight things from the harbour, each above, below or half under the same
waterline.*
