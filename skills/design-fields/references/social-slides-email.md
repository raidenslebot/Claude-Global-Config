# Social posts, stories, thumbnails, link previews, slides, email

Pictures delivered at exact pixel sizes into surfaces you do not control — cropped by a
platform, shrunk to a thumbnail, read on a phone in daylight, projected on a bad screen, or
mangled by Outlook. The design decision is made against *that* surface. **[C]** constraint ·
**[D]** strong default · **[N]** confirm with the platform's current spec — these move.

## The canvases

Render each with `node tools/screen-render.mjs post.html --preset <name>` for the exact pixels.

| Preset | Size | Notes |
|---|---|---|
| `ig-post` | 1080 × 1350 | 4:5 [D], the tallest feed image and the one that fills a phone; the square is 1080 × 1080 (`ig-square`) |
| `story` | 1080 × 1920 | 9:16 [C]; keep type 250 px from the top and 340 px from the bottom — the UI overlays those [D] |
| `x-post` | 1600 × 900 | 16:9 [D]; in the timeline it is small — one idea, big |
| `yt-thumb` | 1280 × 720 | 16:9, < 2 MB [C]; it is *chosen* at 168 px wide in a sidebar — test it at that size |
| `linkedin` | 1200 × 627 | ~1.91:1 [D] |
| `og` | 1200 × 630 | Open Graph link preview [D]; often cropped to a square on mobile, so the subject sits centred |
| `pinterest` | 1000 × 1500 | 2:3 [D] |
| `slide` | 1920 × 1080 | 16:9 [D]; title-safe inset 5% — projectors overscan and rooms have heads in the way |
| `app-icon` | 1024 × 1024 | the master; every platform masks it, keep the mark within the central 80% [C] |

## Social — one idea, read in a second, from a thumb's distance

- **The 2-second read is the whole design.** One line of type or one image, never both
  fighting. The caption carries the rest; the image carries the *stop*.
- **Type size on a post**: ≥ 40 px on a 1080 canvas for anything that must be read in the
  feed; ≥ 24 px for a secondary line [D]. Anything under 20 px is invisible at feed scale.
- **The series is the design.** One post is a fluke; a system of ten — same grid, same two
  faces, same rule for where the mark sits, one variable that changes — is a brand. Design
  the template and the variable, then make ten.
- **The move**: the ledger (numbers as the hero), the enormous word cropped by the edge, the
  duotone image with one line, the diagram with a single signal colour, the running caps
  line. `signature-moves.md` has the parameters.
- **Thumbnails** are read at 168 px: a face or a single object, ≤ 3 words, colour that is not
  the platform's (not YouTube red, not a white background that vanishes into the page) [D].
- **Stories**: vertical composition, the subject in the middle 60% of the height, one tap target
  if any [D].
- **Delivery**: PNG for type and flat colour, JPEG q85 for photographs, sRGB, no colour profile
  surprises; a 2× export is pointless — platforms recompress to their own size [D].

## Slides — a deck is a sequence, not a document

- **One idea per slide** [D]. If a slide needs a paragraph, it is a page; give them the page.
- **Type**: the room decides. 40 pt+ for the point of the slide, 24 pt minimum for anything
  else, nothing below 18 pt [D]. Presenter notes hold the rest.
- **The grid is the deck's spine**: one margin, one title position, one body region, held on
  every slide. The variation is *what* is in the region, never *where* the region is.
- **Sequence moves**: the build (one element per click, the same one moving), the recurring
  frame (a diagram that gains one part per slide), the black slide (a pause), the single
  number (20 vw, tabular), the full-bleed image with one line. Motion in a deck is a build,
  not a transition; transitions are off [D].
- **Charts on slides**: one series emphasised, the axis labelled once, the takeaway *as the
  title* ("Costs fell 40% after the gate"), never "Figure 3".
- **Format**: 16:9; HTML slides render exactly with `--preset slide`; PDF export at 1920 ×
  1080 via `print-render --trim 20x11.25in --bleed 0` for a deck that must travel [D].

## Email — designed for the worst client in the list

- **Canvas 600–640 px wide** [D], single column below 480 px, everything in nested tables
  [C] — flexbox and grid are not reliable across clients.
- **Web fonts do not load in Outlook desktop** (the Word rendering engine) and several
  others; the design must be *good in the fallback stack* — choose one and design in it
  (Georgia, Arial, Trebuchet, Verdana are the honest options) [C].
- **Images**: ≤ 1 MB total, 2× resolution at the slot size, `alt` text that reads as design
  because images are off by default in many clients [C]. Never type as an image.
- **Dark mode** inverts or partially inverts in some clients; test both, use a `<meta
  name="color-scheme" content="light dark">` and avoid pure white-on-black assumptions [D].
- **No background images** without the VML fallback; no video; no forms; no JS [C].
- **The move** here is restraint executed perfectly: one face at three sizes, one signal
  colour, generous line-height, a real hierarchy, and the one link that matters styled as a
  bulletproof button (a table cell with padding and a background) [D].
- **Proof**: `screen-render --preset email --full`, then a real send to two clients [N].

## Slop to recoil from

- **A photo with a quote over it** in a script face. The Pinterest centroid.
- **Title + three bullets on a gradient**, thirty times, with a stock photo of hands.
- **A slide that is a document** at 12 pt.
- **A newsletter that is a web page** — five columns, web fonts, a hero video.
- **A thumbnail with eight words** and an arrow.
- **The same post at every size** by scaling — the story crop cuts the headline.
