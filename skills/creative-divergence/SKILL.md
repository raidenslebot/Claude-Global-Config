---
name: creative-divergence
description: "Use when the work must look genuinely original rather than merely competent — 'this looks generic', 'it looks like every other app', 'make it unique', 'this is AI slop', 'I want something nobody has seen', 'design something impressive', 'it has no personality', or when starting any hero, landing page, game UI, dashboard, brand surface, or art direction where looking distinctive is the actual goal. Also use when a piece is technically fine but forgettable. Runs a divergence protocol: extract the subject's own DNA, generate structurally different directions with explicit operators, test each for genericness, then commit to one. Not a substitute for visual-design-mastery, which judges whether the result is good."
---

# Creative divergence

## Why competent visual work still comes out generic

A model completing a design request produces the **centroid of every design it has seen**. For
"a companion app for a game" that centroid is: dark theme, centered hero, three feature cards,
one accent colour, Inter, `rounded-lg`, a subtle gradient. It is competent. It is also what
everyone else gets.

Two things make this worse rather than better:

- **Naming slop only moves the centroid.** Tell the model "no purple gradients" and it produces
  the *second* most probable design — the same shape without that one token. Whack-a-mole never
  reaches originality, because the problem is the distribution, not the individual features.
- **Every retrieval tool pulls toward the centroid by construction.** Component marketplaces,
  design galleries, "find an existing implementation and adapt it" — each is an average of
  current practice. They are the right tools for *building* and the wrong ones for *deciding*.

**You cannot instruct your way out of a prior. You have to constrain the search space until the
average answer is invalid.** That is what this skill does. It is a method, not an exhortation:
nowhere below will you be told to "be creative."

## The one test that matters

> **Swap the product name, the copy, and the content for a different product's. Does the design
> still work?**
>
> If yes, you designed the category, not the thing. Discard it.

Run this on every candidate before you fall in love with it. It is falsifiable, it takes ten
seconds, and it kills most first drafts — which is the point. A design that survives it is one
whose form is doing work that only this subject's form could do.

A weaker corollary, useful mid-build: **could a competitor ship this unchanged?** If so, nothing
about it is yours.

## Step 1 — Mine the subject, not the galleries

Originality is almost never invented. It is **transplanted from the subject's own world** into a
medium that has not carried it before. So before any pixels, extract the subject's DNA:

| Ask | For a Warframe companion app |
|---|---|
| **Materials** — what is this world physically made of? | Orokin gold filigree over void-black; Grineer stamped, riveted, rusted steel; Corpus white plastic and glass; bio-organic Infested membrane |
| **Motifs** — recurring geometry | Orokin ogee curves and radial symmetry; Grineer harsh chamfers; the diamond/lotus |
| **Palette from source, not taste** | Void black, Orokin gold, energy cyan, Infested ochre — sampled from actual frames, not chosen from a palette generator |
| **Tempo** — how does this world move? | Sudden, weightless, then absolutely still. Parkour bursts and long silences |
| **Vernacular** — what does it call things? | Not "Settings" — *Arsenal*, *Foundry*, *Codex*, *Relay* |
| **Rules of its world** | Orokin tech is ceremonial and symmetrical; Grineer is mass-produced and asymmetric; the two never share a surface |

Pull this from **the subject's actual artifacts** — screenshots, concept art, its own UI, its
fiction — not from a design gallery. Use `design-tokens` to measure real colour and type off
source imagery rather than guessing. This step alone separates "a dark app about Warframe" from
"an Orokin artifact that happens to display your loadout."

For a subject with no strong world (an invoicing tool), the DNA comes from its *domain*: the
materials of money and paper, ledger grammar, the tempo of a transaction.

## Step 2 — Generate with operators, not with taste

Each operator is a **hard constraint that makes the centroid invalid**. Apply one deliberately;
do not blend them at this stage. An operator chooses the *structure*; the parameters that
realise it — the faces, the settings, the palettes, the layout grammars, the materials, the
motion laws — are in [`signature-moves.md`](../visual-design-mastery/references/signature-moves.md),
with the numbers. A face or a palette is chosen by looking at it set, not by its name in a list:
`cgc specimen --display <face> --text <face> --palette <colours>` renders the pairing
at display and reading size, reversed, with every colour and its contrast.

**1 · Material transplant.** Pick a physical material or process and obey its actual rules.
Letterpress cannot do gradients — it does deep impression, tight registration, and ink spread.
A CRT has scanlines, bloom, and phosphor persistence. Risograph misregisters and its colours
multiply. Woven textile has a grid you cannot escape. Obeying the material's *limitations* is
what produces form you would not otherwise reach.

When the output *is* physical — a card, a poster, a shirt — this operator stops being a
transplant and becomes the medium: the stock, the ink count, the thread, the placement on a body
are the constraints to obey, and each has moves the screen never offers. `print-design` and
`apparel-design` carry those; run this protocol first, then theirs.

**2 · Diegetic framing.** The interface is an **object inside the product's world**, not a
website about it. Not "a dark UI with gold accents" — an Orokin console the Tenno actually
operates, with its symmetry laws, its ceremonial pacing, its refusal to show a scrollbar.
Diegetic framing forces a thousand small decisions the centroid never has to make.

**3 · Constraint amputation.** Forbid the default instrument. No cards. No rounded corners. No
drop shadows. Two colours total. No rectangles. Type only — no imagery. Every amputation kills
one lazy path and forces an invention to replace it.

**4 · Extreme parameter.** Take one variable to an unreasonable value and hold it: display type
at 200px, 90% of the canvas empty, one colour at full chroma against pure neutral, a single
gesture that takes four seconds. Extremity is memorable; moderation is the centroid.

**5 · Cross-domain grammar.** Borrow the *layout grammar* of an unrelated artifact — a nautical
chart, a museum wall label, a mixing desk, an illuminated manuscript, a stock ticker, a surgical
tray. Grammar means its hierarchy and spatial logic, not its decoration.

**6 · Temporal signature first.** Decide how the thing *behaves over time* before how it looks.
A UI that snaps hard and then holds perfectly still is a different product from one that eases
everything. Design the motion law, then design the surface that expresses it. See
`animation-principles` for the vocabulary and `motion-and-animation.md` for the mechanics.

**7 · Antagonistic pairing.** Force two things that should not coexist and resolve the tension —
brutalist structure with delicate type; clinical precision with hand-drawn marks. The resolution
is where the personality lives.

## Step 3 — Diverge, then commit

**Produce three to five directions that differ STRUCTURALLY, not cosmetically.** If you can
describe the difference between two candidates as "the same but blue", they are one direction.
Assign each a *different* operator on purpose.

State each direction in one sentence before building anything:

> *"An Orokin reliquary: radial symmetry, gold hairlines on void, everything ceremonial and
> centred, the loadout displayed like a relic in a case."*
> *"A Grineer requisition slip: stamped, riveted, deliberately misaligned, monospace, ink that
> bled — the UI as bureaucratic artifact."*
> *"A void-navigation instrument: no page at all, a single continuous field you fly through."*

Then run the genericness test on each and discard the survivors' weakest.

**Commit to ONE. Do not blend.** This is the rule people break and it is the one that matters:
**averaging several good directions reconstructs the centroid.** Blending is how "three strong
concepts" becomes "a dark app with gold accents and some cards". Pick the direction with the
most internal logic, keep that logic pure, and graft at most **one** element from a runner-up.

Then hand it to `visual-design-mastery` to judge whether the execution is good, and to the
technique layer to build it. Divergence chooses *what*; the taste layer governs *how well*.

## Step 4 — Build it, look at it, and loop until a professional would sign it

The first render is never the one to show. Build the committed direction fast, then run this
loop — and do not leave it on a count:

> **Fix and refine and improve and evolve and extrapolate in a loop until it achieves, at
> minimum, the equivalent of a passionate human professional's work in that field.**

Each pass:

1. **Render it the way it will be seen.** `cgc render page.html --mobile`
   (desktop and phone; `--preset` for a social, slide, email or icon canvas);
   `cgc print` for paper; the garment mockup for fabric. Look at the PNG — the
   picture, not the code.
2. **Name the weakest thing.** One, specifically: "the hierarchy collapses on the phone", "the
   display face is set at a text weight", "the signal colour appears four times", "the copy
   says nothing only this subject could say", "the hero move is decoration, not structure". If
   nothing can be named, ask the professional's questions below until one can.
3. **Fix it, and extrapolate the fix.** What does it imply for the rest? A tighter measure
   implies a larger display size; a chosen material implies a different rule for hairlines; a
   moved placement implies a new reading order. Follow the implication through the piece.
4. **Gate it.** `cgc lint page.html` clean, then `cgc audit
   page.html --mobile` with no failure — it measures the rendered page: the contrast of every
   text run on its real ground, faces that fell back, the measure, text too small, a widow in a
   heading, a page that scrolls sideways on a phone (no screenshot shows that), tap targets, a
   focus nobody can see, animations under reduced motion, the palette by area. `print-lint`
   for paper and fabric. The gates find the average and the broken; they cannot see the good.
5. **Render again and compare.** Keep the log in `review.md` beside the file: the pass, the
   weakest thing, the change, the verdict. The log is what makes the loop honest.

**Stop only when a pass answers every question below with yes and finds nothing a passionate
professional in the field would still change.** The first passes always find something. A loop
that stops after two passes because two was the number is the first idea polished; a loop
that stops because there is nothing left to name is finished work.

The professional's questions — each one a *yes*, or another pass:

- **Two seconds.** Does a glance land where it was meant to, and learn the one thing?
- **The sentence.** Can the design be described in one sentence that could not describe a
  template? A design that passes has a sentence like *an audit report typeset as a printed
  ledger, with the thesis copy-edited in red*.
- **Swap.** With a competitor's name and copy in it, does it stop working?
- **Structure.** Is there a hero move from *layout, material or motion* — not only a face and a
  colour? (the ambition floor in `signature-moves.md`)
- **Type.** A chosen display face with a text face that holds it; a real scale; negative
  tracking at display size; measure 45–75 characters; no widow in a heading; tabular figures
  wherever numbers stack.
- **Colour.** Three roles; neutrals with a hue; the signal used once; contrast that passes.
- **Grid and detail.** Everything on a grid the eye can feel; optical alignment where the
  maths lies; hairlines rather than boxes; radius, shadow and spacing each doing one job.
- **Copy.** In the subject's own vernacular, saying a specific thing; nothing stock.
- **Motion.** One law, obeyed; exits faster than entrances; reduced motion respected. Or
  stillness, chosen.
- **The phone.** Does the hierarchy survive at 390 px, or is this a desktop design shrunk?
- **The states.** Hover, focus, empty, loading, error — designed, or left to the browser?
- **The field's own craft.** The minimums and delivery formats in `design-fields`,
  `print-design` or `apparel-design` for this medium, met.

*Would a passionate professional in this field sign it?* is the exit. Not *is it fine*.

A page built through exactly this loop — directions first, then the passes logged in
`review.md` — is in [`examples/cgc-landing/`](examples/cgc-landing/). Read it for the shape of
the loop; do not copy its design.

## When NOT to use this

Novelty is a cost. It is wrong for: a settings page, a checkout flow, a data table, an admin
panel, anything where the user's existing muscle memory is the feature, and anything safety- or
compliance-critical. **Convention is a feature in the places people need to succeed without
looking.** Spend originality where it is seen and remembered — the hero, the empty state, the
loading moment, the one screen someone screenshots — and stay conventional everywhere else. That
is the same "spend boldness in one place" law the taste layer states, applied to concept rather
than to execution.

## Slop to recoil from

- **Polishing the first idea.** The first idea is the centroid by definition. If you did not
  generate alternatives you did not make a choice, you accepted a default.
- **Variations mistaken for directions.** Four colourways of one layout is one direction.
- **Blending the finalists.** Produces the average of the things you liked, which is the average.
- **Decorating the centroid.** Adding grain, glow, a custom cursor and a noise overlay to a
  generic layout does not make it specific — it makes a generic layout with effects on it.
- **Mood-board cosplay.** Copying the *surface* of a reference (brutalist fonts, Swiss grid)
  without adopting its logic. The grammar transfers; the decoration does not.
- **Asking the model to "be creative"** — including asking yourself. It has no operational
  meaning. Pick an operator and accept its constraint instead.
- **Treating the component library as the starting point.** It is the fastest way to build the
  thing you decided on, and the surest way to decide nothing.

## How this composes

```
creative-divergence   →  WHAT is this, structurally? (this skill: operators, N directions, commit)
                         then the LOOP: render, name the weakest thing, fix, extrapolate, gate,
                         render again — until a passionate professional would sign it
visual-design-mastery →  is the execution good? (taste; wins on conflict, always)
signature-moves.md    →  the vocabulary with its parameters: faces, palettes, grammars, materials, motion
design-fields         →  the canvas, minimums and delivery format of every field that is not a page
screen-render / slop-lint →  the proof and the gate for anything on a screen
technique skills      →  how do I build that in GSAP / three.js / SpriteBatch?
component libraries   →  build the decided thing fast — never to decide it
```

`design-tokens` supplies Step 1 with measured colour and type from real source imagery.
`project-memory` is where a chosen direction and the rejected ones belong, with the reasoning —
so the next session extends the concept instead of re-deriving a fresh centroid.
