# Icons, illustration systems, diagrams, infographics

These are drawn, and drawing has rules the screen does not enforce. **[C]** constraint ·
**[D]** strong default · **[N]** confirm.

## Icon sets — a system, or nothing

An icon set is one drawing rule applied thirty times. The rule is what makes it a set; the
subject of each icon is almost irrelevant.

- **Grid: 24 px, live area 20 px** (2 px padding on every side) [D]. Sizes 16 / 20 / 24 / 32 /
  48 are *redrawn*, not scaled: at 16 px the stroke stays 1.5–2 px and detail is removed [C].
- **Stroke: 2 px** (the Lucide/Feather convention) or 1.5 px for a lighter set; **one weight in
  the whole set** [D]. `stroke-linecap="round" stroke-linejoin="round"` or square — pick one,
  never mix [D].
- **Corner radius: 2 px** on a 24 grid, consistent [D]. Terminals aligned to the pixel grid so
  1 px strokes render crisp: coordinates at .5 for odd strokes, integers for even [C].
- **Optical sizing.** A circle and a square of the same box are not the same size to the eye;
  the circle is drawn ~1 px larger, the triangle larger still. Keylines (circle 20, square 18,
  landscape 20 × 16, portrait 16 × 20) are the correction [D].
- **Metaphor discipline.** One metaphor per concept across the set (a trash can *or* an X for
  delete, not both). Test the icon without its label; if it needs the label, it is decoration.
- **SVG hygiene** [C]: `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor"`, no
  transforms, no groups, no ids, no embedded styles, paths merged where possible, decimals ≤ 2.
  `currentColor` is what lets one file serve every theme.
- **Delivery**: individual SVGs named `kebab-case.svg`, a sprite (`<symbol>`), and a contact
  sheet rendering every icon at 16 and 24 on light and dark [D].

**The move that makes a set specific:** one drawing rule the subject supplies — a chamfer
instead of a radius for a machine-tool company, a single broken stroke for a music label, a
consistent 30° cut. Change one rule and the set is yours; change none and it is Feather.

## Illustration systems

An illustration *system* is a set of constraints that make ten drawings look like one hand.

- **Line weights: two or three in a fixed ratio** (1 : 2 : 3.5) [D], never freehand variety.
- **Palette: 4–6 colours** including one neutral and one signal [D]; fills flat or one texture
  (grain, hatch) applied the same way everywhere.
- **Perspective: one** — flat, isometric (30°), or one-point — for the whole set [D].
- **Level of detail: fixed** — decide what is drawn (hands: mittens or fingers?) and hold it.
- **The subject's world supplies the vocabulary**: its objects, its tools, its architecture.
  Not people-at-laptops.
- **Format**: SVG with named layers; raster exports @2×; a sheet showing the rule set (weights,
  palette, perspective, three sample drawings) so the next drawing matches.

## Diagrams and infographics — the truth, laid out

- **A diagram is an argument.** Decide the one relationship it shows (flow, hierarchy,
  comparison, part-of-whole, change over time) and choose the grammar that shows it: a flow
  reads left-to-right or top-to-bottom, never both; a hierarchy is a tree; a comparison is
  aligned rows. Mixing grammars is how a diagram becomes a poster of boxes.
- **Alignment is the whole craft.** Boxes on a grid, connectors orthogonal or all-curved, equal
  gaps, one arrowhead style. A diagram with sloppy alignment reads as sloppy thinking [D].
- **Type in a diagram**: one size for labels, one for the title, tabular figures; ≥ 11 px on
  screen, ≥ 7 pt on paper [C].
- **Infographics lie easily.** Areas scale with the value, not the radius; a truncated axis is
  declared; icons-as-units are the same size; the source is cited on the piece [C].
- **Colour means one thing** in a diagram — a category, a state, or an emphasis, never all
  three. Two greys and one signal is usually the whole palette.
- **Format**: SVG (Mermaid renders natively in artifacts and is fine for structure; hand-drawn
  SVG for anything that must be beautiful), and a PNG @2× for wherever SVG cannot go.

## Slop to recoil from

- **Feather with the corners rounded** and called "a custom set".
- **Corporate Memphis** — giant-limbed flat people in purple and coral.
- **Gradients, glows and drop shadows on a flowchart.**
- **An infographic with pie charts of two values**, a rainbow legend, and 3D bars.
- **Isometric everything**, when nothing about the subject is spatial.
- **Icons that need their labels.**

## Proof

A contact sheet HTML rendering the set or the drawings at every delivered size, on light and
dark → `node tools/screen-render.mjs sheet.html --mobile`. Look at the smallest size first.
