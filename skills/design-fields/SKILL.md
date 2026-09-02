---
name: design-fields
description: "The router for every field except the browser and paper — and the procedure for a field with no skill of its own. Use for \"logo\", \"wordmark\", \"brand identity\", \"lockup\", \"favicon\", \"app icon\", \"icon set\", \"illustration\", \"diagram\", \"infographic\", \"social post\", \"Instagram\", \"story\", \"thumbnail\", \"YouTube\", \"Open Graph image\", \"slide deck\", \"presentation\", \"pitch deck\", \"email template\", \"newsletter\", \"packaging\", \"label\", \"box\", \"signage\", \"wayfinding\", \"banner\", \"trade show\", \"book cover\", \"album art\", \"menu\", \"pattern\", \"textile\", \"motion graphics\", \"title sequence\", \"game asset\", \"map\", or any request to make a thing people will look at. Carries the real specs per field (sizes, safe zones, minimums, delivery formats), the hero moves and the slop of each, and the render path that proves the pixels. Not a substitute for creative-divergence (which chooses the idea) or visual-design-mastery (which judges it)."
---

# Design fields — every surface, one discipline

The centroid exists in every field, not only on web pages. A logo request produces a geometric
monogram in a circle; a slide deck produces title-and-three-bullets on a gradient; a social
post produces a photo with a quote over it; an icon set produces Feather with the corners
rounded. Each field has its own template, its own physical constraints, and its own moves —
and one discipline runs through all of them:

```
1. DNA        creative-divergence Step 1: the subject's real artifacts, not the gallery
2. Directions written down — 3 to 5, structurally different, the swap test on each
3. Field spec this file: the canvas, the minimums, the delivery format for THIS field
4. Moves      visual-design-mastery/references/signature-moves.md — one hero move
5. Build      at the real size, in the real units, in a file the field accepts
6. Render     tools/screen-render.mjs --preset <field> · tools/print-render.mjs for paper
7. Loop       look, name the weakest thing, fix, render again — until a passionate
              professional in that field would sign it (creative-divergence Step 4)
8. Gate       tools/slop-lint.mjs and tools/page-audit.mjs for anything on a screen; print-lint for paper
```

Read the reference for the field before the first line of markup. Facts are marked **[C]**
constraint, **[D]** strong default, **[N]** confirm with the platform or the vendor.

| Field | Reference | The template to refuse |
|---|---|---|
| Logos, wordmarks, identity systems, favicons, app icons | [`identity-and-marks.md`](references/identity-and-marks.md) | a monogram in a circle; a swoosh; a gradient mark; "modern, minimal, versatile" |
| Icon sets, illustration systems, diagrams, infographics | [`icons-illustration-diagrams.md`](references/icons-illustration-diagrams.md) | Feather with rounder corners; flat "corporate Memphis" people; a flowchart with drop shadows |
| Social posts, stories, thumbnails, link previews, slides, email | [`social-slides-email.md`](references/social-slides-email.md) | a photo with a quote; title + three bullets on a gradient; a newsletter that is a web page |
| Packaging, labels, signage, wayfinding, banners, environments | [`packaging-signage-environment.md`](references/packaging-signage-environment.md) | a white box with the logo; a sign in Helvetica with an arrow; a banner that is a poster made wider |
| Paper — cards, flyers, posters, brochures, books, menus, covers | `print-design` | a screen layout at card size |
| Garments and textiles — tees, hoodies, caps, totes, patterns | `apparel-design` | the logo centred on a white tee |
| Web pages, apps, dashboards, game UI | `visual-design-mastery/references/web-and-css.md`, `native-and-mobile.md`, `games-and-engines.md` | the centred hero with two buttons |
| Motion graphics, title sequences, Lottie | `motion-and-animation.md`, `lottie-animation`, `svg-animation` | text sliding in from the left on a gradient |
| Generative art, plotter, TUI, data-viz posters | `generative-creative-tui-dataviz.md` | unseeded noise; a rainbow palette |

## Five pieces in exactly this form

- [`examples/harbor-swim-club-identity/`](examples/harbor-swim-club-identity/) — an identity
  system: directions first, the mark and its redrawn favicon, the wordmark **outlined to paths**
  with `tools/outline-text.mjs`, both lockups and their reversed forms, the system's one
  variable, the icon master, a one-file brand sheet, the spec sheet, and the passes in
  `review.md`. Its stacked lockup is the tee's mark in the `apparel-design` example — one
  subject, two fields, one system.
- [`examples/night-market-social/`](examples/night-market-social/) — a feed series: one
  template, one variable, three weeks at 1080 × 1350, from the DNA of the `print-design`
  poster; the passes in `review.md` include the ink that had to change for a screen.
- [`examples/harbor-swim-club-icons/`](examples/harbor-swim-club-icons/) — an icon set: one
  drawing rule from the subject (the waterline through every icon), a 24-grid sprite in
  `currentColor`, one file per icon written by `split.mjs`, a contact sheet at 24 and 48 on
  both grounds without labels first — and a size deliberately *not* delivered, with the reason.
- [`examples/harbor-swim-club-deck/`](examples/harbor-swim-club-deck/) — a slide deck: seven
  slides at 1920 × 1080 through which the identity's waterline rises one step per slide, one
  number each, a hand-drawn chart standing on the waterline, the tide table as the ledger, the
  flag at high water; the passes in `review.md` are four defects the audit passed and the eye
  caught, which is the argument for the loop.
- [`examples/harbor-swim-club-email/`](examples/harbor-swim-club-email/) — an email: the field
  where the constraints decide the form. Nested tables, a face the reader already has, every
  structural line a table row so the design is **identical with images off**, one bulletproof
  link, 8.9 KB. Its `review.md` is the other half of the argument: the audit caught a contrast
  failure and a 20 px tap target the eye had passed, and following the first one properly took an
  accent out of the design rather than darkening it.

Read them for the shape; do not copy their designs.

## A field with no reference here

Book covers, album art, menus, maps, patterns, trade-show booths, vehicle wraps, game assets,
badges, tickets — the discipline does not change, and the procedure is the same eight steps.
What changes is step 3, and it is found, not guessed:

1. **The canvas and its units.** Physical → inches/mm with bleed and a printer's spec sheet
   (`print-design/references/sizes-and-specs.md`). Screen → pixels at the platform's stated
   size. Neither → ask what will *display* it and design for that surface.
2. **The viewing distance and the minimums that follow.** Type is sized for where the eye
   will be: 1 in of cap height per 10 ft is the rule of thumb for comfortable reading of
   signage [D]; a phone is at 12 in; a slide is at the back of the room.
3. **The delivery format the field accepts** — vector for anything cut, printed at scale or
   embroidered, and a dieline or template from the vendor for anything manufactured [C]; a
   raster at 2×, or SVG, for anything on a screen [D].
4. **The moves that exist only because of this field's material.** A book has a spine and
   a gutter; a map has a legend and a scale; a pattern has a repeat; a ticket has a stub. The
   hero move comes from that, never from the screen.

Write those four answers into `directions.md` before the directions. A field-specific
reference is then worth adding to this skill when the field recurs.

## Composition

```
creative-divergence    →  the idea, written down, with the swap test (always first)
design-fields          →  the field's canvas, minimums, format, moves, render path (this skill)
signature-moves.md     →  the vocabulary with its parameters
visual-design-mastery  →  judges the execution; wins on conflict
print-design / apparel →  paper and fabric, with their own render pipeline and lint
screen-render / lint   →  the proof and the gate for anything on a screen
```
