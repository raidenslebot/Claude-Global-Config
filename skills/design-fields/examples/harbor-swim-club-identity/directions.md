# Directions — Harbor Swim Club, the identity system

Written before any artwork. The subject is the fictional open-water swimming club whose tee is
the `apparel-design` example; its DNA is that example's, extended with the questions an
identity has to answer that a garment does not: what survives at 16 px, what the system's
one variable is, and what every version must be.

## DNA — from open-water swimming's own world

| Ask | Answer |
|---|---|
| **Materials** | cold water; the harbour wall; orange tow-floats; lane rope; a life-ring; the tide table on the changing-room door; the painted signage of a working harbour — stencilled, weathered, medium-weight, never bold |
| **Motifs** | the ring (life-ring, tow-float, buoy); the waterline — a float sits half under; the tide's rise and fall; "swim between the flags" |
| **Palette from source** | navy of deep water; cream of a rope; tow-float orange, used only where safety uses it |
| **Tempo** | dawn, weekly, regardless of weather; the timetable is the tide |
| **Vernacular** | "high water", "slack", "a dip", "the wall", "9 degrees" |
| **Rules of the world** | the ring is never decoration; nothing on the water is shouted; you swim when the tide says |
| **What it will be seen on** | a favicon and a phone home screen; a cap and a polo (embroidery, 4 in max); the tee; a sign on the wall; a stamp on a membership card; a WhatsApp group icon |

## Directions

1. **The ring is the whole identity.** *Constraint amputation:* no symbol beyond the ring
   with its waterline, no colour beyond navy and cream (orange only as a safety signal), and a
   wordmark that is subordinate — caps, tracked, medium weight, the voice of harbour signage.
   *Swap test:* a pool club has no waterline and no tide; the ring half-under is a tow-float in
   open water. **Survives.**
2. **The tide as the wordmark.** The letters of HARBOR rise and fall on a tide curve. *Material
   transplant* (the tide table). *Swap test:* survives — but it is playful, and nothing on the
   water is shouted. **Discarded as the wordmark; the tide returns as the system's one
   variable** (below).
3. **Type only, the O as the ring.** "HARBOR SWIM CLUB" stacked in a condensed grotesque with
   the O of HARBOR drawn as the life-ring. *Antagonistic pairing* (utilitarian signage × one
   ceremonial letter). *Swap test:* the letter-as-symbol trick is on a thousand marks; it is
   the category. **Fails.**
4. **The number.** "9°" as the mark. *Extreme parameter.* *Swap test:* survives; the number is
   the identity — but it reads as a joke before it reads as a club, as it did on the tee.
   **Discarded.**

## Committed

**Direction 1, with one graft from 2.** The mark is the ring with its waterline through the
centre. The system has exactly one variable: **where the waterline sits.** On the mark it is
at the centre — slack water. On event materials for a swim at high water it rises to three
quarters; that lockup is the only variant, and it is used only when the tide is the point.

- **The mark.** A ring whose stroke is 16 units on a 350 grid (4.6% of the width), the
  waterline a bar of half that. Optical: the bar sits 2 units above the geometric centre so it
  *reads* as centred; the ring's outer edge overshoots the wordmark's cap line by the stroke
  width so the two read as one weight.
- **The wordmark.** HARBOR in **Archivo** at `wdth 75, wght 600`, caps, tracked 0.14 em —
  outlined to paths with `cgc outline`, so no file depends on the font. Medium
  weight, not bold: harbour signage, not a shout. "SWIM CLUB" only in the stacked lockup, at
  half the size, tracked 0.2 em.
- **Lockups.** Horizontal (mark left, wordmark on the ring's centre line) and stacked (mark
  above, wordmark beneath, as on the tee). Clear space: twice the ring's stroke on every side.
  Minimum sizes: the lockup at 1 in / 100 px; the mark alone at 0.25 in / 16 px — and at 16 px
  it is **redrawn**, not scaled: the stroke doubles to 22% of the width and the waterline
  thickens, or the favicon is a grey blur.
- **Colour.** Navy `#1f2a44` (Pantone 2767 C [N]) and cream `#efe9dc` (Pantone 7499 C).
  Tow-float orange `#ff5a1f` (Pantone 1655 C [N]) exists in the system for one use: the flags
  on safety notices. Versions: navy on cream, cream on navy (reversed), one colour in either,
  and the favicon set.
- **What not to do.** No gradient, no shadow, no rotation, no outline stroke around the
  wordmark, never the ring without its waterline, never orange for decoration.

One sentence: *a life-ring half under the water, drawn once, with signage lettering that
never raises its voice.*
