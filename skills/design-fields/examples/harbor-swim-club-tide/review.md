# The loop — Harbour Swim Club tide board

Every pass is recorded, including the ones where the gate was right and the piece was wrong.
Three of the five passes below found a real defect that reading the source would never have
shown, which is the argument for the whole pipeline.

---

## Pass 1 — the first build

`cgc lint tide.html` → **clean, 0 of 23.** No fingerprint: no purple, no glass card, no centred
hero, no stock copy, real faces.

`cgc techniques tide.html` → **ambitious, 19 of 51.**

`cgc motion tide.html --duration 1800` → **FAIL: dead. Nothing moved across the whole capture.**

The lint said the piece was clean and the technique gate said it was ambitious. Both were true,
and the animation did not run. That is the case this tool exists for: a page can pass every
check that reads the source and still be broken in the one way nobody looks at.

## Pass 2 — the level jumps instead of rising

The cause, found by reading the sheet rather than the code: the water was at its full height in
frame 0 and every frame after it.

**A registered custom property whose keyframe value contains `var()` does not interpolate.** The
level was typed as a `<percentage>` and animated `from { --level: 0% } to { --level: var(--target) }`;
Chromium resolves that to the end value and holds it. So the level is now composed from two
typed **numbers** in `calc()`, and only numbers are animated. Numbers always interpolate.

`cgc motion` → still **dead**.

## Pass 3 — the animation was on the wrong element

A custom property is substituted **where it is declared**. `--lvl` was composed on the staff and
inherited down as an already-resolved value, so animating the numbers on a *child* could never
move it. The animation moved onto the element that composes the level.

`cgc motion` → still **dead**, and this time the tool was wrong twice over.

- A probe in the browser proved the level really did move: `--t` read 0 → 0.97 → 1 across the
  timeline. The capture was measuring the **mean** change over the whole frame, and a waterline
  inside one column of a 1440px page barely shifts a mean. `motion-render` now decides "did
  anything move" from the **largest change anywhere**, and samples frames at 320px rather than
  160px. Two of the tool's own defects, found by using it on a real piece.
- The page was also wrong: the staff was declared `aspect-ratio: 1 / 5.2`, which at this column
  width made it 1664px tall, so the waterline sat far below the fold and genuinely was not on
  screen. Height is now bounded to the viewport.

`cgc motion` → **ease-out, deviation 0.576, settles at 818 ms.** It moves.

## Pass 4 — looking at the sheet, not the numbers

Nothing measured was wrong, and the piece contradicted its own directions. `directions.md`
committed to *the water is the hero*; on the sheet the hero was a large `COMING IN` and the
staff was a thin ladder off to one side.

Rebuilt around the waterline:

- The staff takes five of twelve columns instead of three, and the marks are solid E-marks with
  the metre numerals set against them.
- **The reading rides the water.** A leader rule runs from the waterline across into the readout
  column with the height figure on the end of it, so the number is *where the level is* and
  travels with it. It is the one element that breaks its box, and it is the reason the
  composition has a subject.
- `COMING IN` dropped from 11vw to 7.2vw. It answers the staff; it does not replace it.

## Pass 5 — the audit

`cgc audit tide.html --mobile` → **7 failures at both widths.**

- Every secondary text run sat at **4.14:1**, below the 4.5:1 floor. The faint tint was mixed at
  64% of the ink; it is now 78%. This is what a derived palette is for — one number changed and
  thirteen text runs moved with it.
- The curve's draw-on ran 1500 ms after a 180 ms delay: **1680 ms for an entrance**, which is a
  wait. Now 1050 ms after 140 ms. The water's rise came down with it, 1400 ms → 1100 ms.

`cgc audit` → **no failures, no warnings, at 1440×900 and 390×844.**
`cgc motion tide.html --duration 1200` → **ease-out, settles at 545 ms, nothing measured wrong.**
`cgc lint` → **clean.** `cgc techniques` → **ambitious, 19 of 51.**

---

## The dimension it never entered, and why that is the answer

`cgc techniques` reports **depth: 0**, and asks whether flat was a choice.

It was. A staff gauge is a painted board bolted flat to a harbour wall; there is nothing behind
anything, and the one place the piece has real depth is the only place the subject has any — the
sea passing **in front of** the marks, which is why the water is a `multiply` blend rather than
an opaque panel drawn over them. Adding perspective or a parallax layer here would put depth
into a picture of a flat object, which is the definition of decoration.

The tool asks the question. It does not get to answer it. That is the correct relationship, and
noting the answer here is what closes the loop rather than gaming the number.

## What the motion earns

Under `prefers-reduced-motion: reduce` the water is simply **at** its level, the curve is drawn,
and the board loses nothing at all — no information, no hierarchy, no meaning. That is the test
of whether motion was decoration, and this passes it in the only way that counts: the rise is
not an effect on the datum, it *is* the datum arriving.
