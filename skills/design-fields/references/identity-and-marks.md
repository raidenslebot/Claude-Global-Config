# Identity and marks — logos, wordmarks, lockups, favicons, app icons

A logo is the smallest design and the one that has to survive the most: a 16 px favicon, a
0.25 in embroidery, a 40 ft sign, a monochrome fax of itself. It is a *system* of versions,
not one picture. **[C]** constraint · **[D]** strong default · **[N]** confirm with the vendor.

## What a mark is made of

- **The wordmark** — the name, set. Most identities need only this, done superbly. The letterforms
  themselves carry the personality: a customised terminal, one ligature, a deliberate weight or
  width, a single wrong-on-purpose letter. Draw it as paths, not as a font choice [D].
- **The mark** (symbol) — optional. Earned only when the name will be seen without the words:
  an app icon, a favicon, a sign, a garment. If it will never appear alone, it is decoration.
- **The lockup** — mark + wordmark in fixed relation, in **horizontal** and **stacked** versions
  [D]. The relation is measured in a unit derived from the mark (its stroke, its x-height),
  never eyeballed.
- **Clear space** — a zone around the lockup no other element enters; the unit is the mark's
  own (x-height of the wordmark, or the stroke width ×2) [D].
- **Minimum size** — the width below which the mark breaks. State it: wordmark ≥ 1 in / 100 px
  wide; a mark ≥ 0.25 in / 16 px [D]. Test at that size, not at 800 px.
- **Versions** — full colour, one colour, **reversed** (on dark), and a **monochrome** that
  works at the minimum size. A mark that only works in colour or only large is unfinished [C].

## Construction — the moves that make a mark specific

- **Mine the subject's real shapes** (creative-divergence Step 1): the tool it uses, the
  thing it makes, the letter it starts with, the place it is from. Not "an abstract shape that
  conveys trust".
- **One idea.** A mark says one thing. The mark that is a letter *and* a bird *and* an arrow
  is three half-marks.
- **Optical, not geometric.** Circles overshoot the cap line; horizontals are thinner than
  verticals; the crossbar sits above the mathematical middle; a perfectly geometric mark looks
  wrong precisely because it is perfect. Correct by eye, then measure.
- **Stroke discipline.** One stroke weight in a line mark, or two in a fixed ratio (1 : 1.6).
  At the minimum size the stroke must still be ≥ 1 px on screen; in print ≥ 0.25 pt for
  offset, ≥ 0.5 pt for flexo or screen print, and whatever the embroiderer states [D].
- **Counter and gap sizes** ≥ the stroke width, or they fill at small sizes [D].
- **No gradients, no shadows, no effects in the primary mark** [D]. They fail in one colour,
  in embroidery and in a die-cut. A gradient may be a *version* for a specific screen surface.
- **The wordmark's type** — a chosen face with modified details beats a novel one. Customise:
  one terminal, the tail of the R or the Q, the width of one letter, the join between two.
  Convert to outlines; the delivered file must not depend on the font being installed [C] —
  `cgc outline --font "Archivo:wdth,wght@75,600" --text HARBOR --size 71
  --tracking 0.14 --wdth 75 --wght 600 --out wordmark.svg` lays the text out with the font's own
  kerning and writes one `<path>`; customise the paths from there.
- **Colour from the subject**, in the primary + one supporting, specified as Pantone for print
  and hex/OKLCH for screen, both in the sheet [D].

## Delivery

- **SVG** master, viewBox at the artwork's own units, no strokes converted to fills *lost* —
  deliver **both** a stroked editable and an outlined version [D]. No text elements; paths only.
- **PDF** (vector) for print vendors; **PNG @1×/@2×/@3×** on transparent for screen users who
  cannot handle SVG; **EPS only if a vendor asks** [N].
- **Favicons and app icons** are a set, not a resize: `favicon.svg` (with a dark-mode
  `prefers-color-scheme` rule inside — honoured by Chromium and Firefox, and by Safari only
  from Safari 26 in 2025, so the `.ico` and the touch icon are what older Safari shows),
  `favicon.ico` 16 + 32, `apple-touch-icon.png` 180, `icon-192.png` and `icon-512.png` (PWA /
  Android; maskable: keep the mark inside a centred circle of 80% diameter, and inside about
  61% for Android's adaptive layer) [D]. An app icon master is 1024 × 1024 with *no* rounded
  corners for iOS, Google Play and macOS 26 and later — the platform applies the mask [C];
  macOS 15 and earlier render the icon file literally and want the rounded rectangle drawn
  in, so ship a second `.icns` if you target them [N].
- **The brand sheet** with every mark: versions, clear space diagram, minimum sizes, colours in
  every space, the one-colour and reversed forms, and what NOT to do (stretch, recolour,
  outline, rotate, put on a busy photograph).

## Slop to recoil from

- **The monogram in a circle**, the swoosh, the overlapping-shapes gradient, the lowercase
  geometric sans wordmark in a tech blue. The gallery centroid.
- **A mark that only exists at 800 px.** It has never been seen at 16.
- **Three ideas in one symbol.**
- **A font, unmodified, as the wordmark** — that is a typesetting, not an identity.
- **Delivering a JPEG.** Or a PNG with a white background. Or an SVG with live text.
- **"Versatile, modern, minimal"** as the brief to yourself. Versatile means nothing was
  decided. Decide.

## Proof

Render the SVG at the minimum size and at the favicon sizes with
`cgc render mark.html --preset app-icon` (an HTML page that places the SVG
at each size on light and dark) and *look at the 16 px one*. Then `print-render` the sheet.
