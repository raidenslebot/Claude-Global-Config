# Type for print — faces that are already on the machine, and how to bring better ones

The single fastest lift for any printed piece is the type, and the single most common reason a
rendered card looks "AI" is that it was set in the browser's default sans. The render pipeline
uses whatever the operating system has. That is a real constraint, so here is what is on each
OS that prints well, how to pair it, and how to add a proper face when the job deserves one.

**A rule before the tables:** one characterful face used with conviction beats a safe pair. Two
faces at most — one for display, one for text — and never two from the same category.

## Faces that ship with the OS and hold up on paper

| Role | Windows | macOS | Linux (common) |
|---|---|---|---|
| **Text serif** (7–11 pt, contact lines, body) | Sitka Text · Cambria · Constantia · Georgia | Iowan Old Style · Charter · Hoefler Text · Palatino | Charter (if present) · DejaVu Serif · Liberation Serif |
| **Display serif** (24 pt+, one word, a name) | Sitka Banner · Constantia italic · Palatino Linotype italic | Didot · Baskerville · Hoefler Text Black · Bodoni 72 | Liberation Serif Bold (weak — install one) |
| **Grotesk / sans** | Bahnschrift (a DIN; variable weight and width) · Segoe UI (avoid — the Windows UI face) | Helvetica Neue · Avenir Next · SF Pro (UI face — avoid) | DejaVu Sans · Liberation Sans (both generic — install one) |
| **Monospace** (a code brand, a receipt, a report) | Cascadia Mono · Consolas | SF Mono · Menlo | DejaVu Sans Mono · Liberation Mono |
| **Script / italic accent** | Constantia italic · Palatino italic | Snell Roundhand (sparingly) · Zapfino (never at text size) | — |

Mark each as a **starting point**: what ships varies by OS version. Check with the font list
before relying on one, and always give a fallback stack that degrades to a *similar* face, not
to the UI sans:

```css
font-family: "Sitka Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif;   /* text serif */
font-family: "Bahnschrift", "DIN Alternate", "Helvetica Neue", Arial, sans-serif;     /* grotesk   */
font-family: "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;                  /* mono      */
```

## Pairings that print

| Piece | Display | Text | Why it works |
|---|---|---|---|
| Letterpress card, studio, gallery | Palatino / Iowan Old Style italic at 40–90 pt | the same face, roman, 7.5–8 pt | one face, two cuts — restraint reads as craft |
| Engineering, tooling, technical | Bahnschrift condensed bold 24–64 pt, or Cascadia Mono at display size | Bahnschrift light 7.5 pt, or the mono | one family; the contrast is weight and size |
| Editorial flyer, festival, food | Constantia / Didot at 36 pt+ | Cambria / Charter 9–11 pt | high-contrast display over a sturdy text face |
| Poster, far read | Bahnschrift Bold or any grotesk with open counters at 150 pt+ | grotesk 12–14 pt for the near read | even stroke and open apertures survive distance; hairline serifs do not |
| Invitation, formal | Sitka Banner / Hoefler Text with small caps | the same, roman | true small caps and old-style figures — turn them on (`font-variant: small-caps; font-variant-numeric: oldstyle-nums`) |

## Setting it well — the details that read at six inches

- **Optical size.** A face at 66 pt wants tighter tracking (`letter-spacing: -0.02em` to
  `-0.04em`); the same face at 7.5 pt wants a touch looser (`+0.01em`). Never one value for both.
- **Real italics and true small caps**, not synthesised: `font-style: italic` on a face with an
  italic cut; `font-variant-caps: small-caps` only on a face that has them (Sitka, Hoefler,
  Constantia do; Georgia does not — it fakes them).
- **Figures.** `font-variant-numeric: tabular-nums` for phone numbers and tables;
  `oldstyle-nums` for figures inside running text.
- **Reversed type** (light on dark): up a size and a weight; white ink and foil spread more
  than reversed process ink — 8 pt is the floor, not 7.
- **Measure.** Body lines of 45–75 characters; contact lines are short by nature — align them to
  a grid and let the space do the work.
- **Hanging punctuation and true quotes.** `hanging-punctuation: first` where supported; curly
  quotes and a real apostrophe (’), never the typewriter kind.

## Bringing a proper face in

When the job deserves it — a brand with its own typeface, or a display face no OS ships —
install the font on the machine and reference it by family name; the renderer embeds it in the
PDF as a subset. Open-licence (OFL) families cover every category above and are free to embed in
print: install them from their source and keep the licence file with the project. The skill does
not fetch fonts for you — an install is the user's decision, and a font is a binary from
somewhere — but once installed it is a family name in a stylesheet, nothing more.

Do not `@import` a web font URL in a print file: the renderer is offline by design, the fetch
will silently fail, and the fallback sans is what prints.

**Check what you actually got.** After rendering, open the PNG proof and look at the type. If it
is the UI sans, the family name did not resolve — fix the name or the fallback stack before the
lint, because the lint checks sizes, not faces.
