# Review — the passes

Rendered with `cgc render post-N.html --preset ig-post` (1080 × 1350 exactly);
gated with `cgc lint .` and `cgc audit post-1.html --viewport 1080x1350`.

## Pass 1

**The board grammar carries to the feed:** the word, the stalls with hours where the prices go,
the running line. **Weakest thing:** the crop lost the whole T — at 640 px "NIGHT" showed as
"NIGH", which reads as a different word, not a cropped one. **Also:** the deal line orphaned
"last" onto a second line; the foot at 22 px would be 8 px on a phone in the feed; the lint
flagged Impact in the fallback stack; and the audit failed the fluorescent orange as text on
the paper — 2.4:1 for the times and the price, 2.6:1 for the word, against 3:1 for large text.
The poster's Riso ink fluoresces on paper; a screen cannot, and the number is the number.

**Changes.** The word to 580 px, so the crop lands in the T and the word still reads. The deal
to 38 px on one line. The foot to 26 px. Impact out of the stack. Two oranges: the word keeps
the fluorescent ink one step deeper (`#ef4a0f`, 3.1:1); the times and the price take the same
ink pressed harder (`#c8420f`, 4.1:1) — the "different hand" of the price board is a darker
hand, not a different colour.

## Pass 2

The T reads; the deal fits; the times pass. **Weakest thing:** the foot wrapped — at 26 px
with its tracking the running line broke into four ragged pieces, which is worse than small.

**Changes.** The foot to 24 px, tracking 0.1 em, `white-space: nowrap`; it fits with room.

## Pass 3

No failures, no warnings at 1080 × 1350; two saturated hues over 41% of the canvas — a colour
field, which a price board is. Posts 2 and 3 render from the same template with only the board
and the deal changed, and read as the same market.

The professional's questions, each a yes: the glance lands on the word and learns "night
market"; the sentence — *a stall's price board, cropped by the phone's edge, with this week's
stalls where the prices go* — is no template; with a gig's name the board grammar stops
making sense; the structure is the board and the crop, not a face and a colour; two faces;
three colours as two inks and a paper; everything on a left edge; copy in the market's words;
no motion, chosen; it is designed at the size it is seen; the series is one template and one
variable, which is what makes it a series.

**Considered and not made:** a drawn steam plume behind the word, as on the poster. In a feed
at a thumb's distance it would be texture over the one thing that has to read. The loop ends
here.

## Pass 4 — the ground the reader sees

The audit learned to measure a run that bleeds off the canvas. The word does exactly that, so
until now the biggest thing on the piece came back "could not be measured" — a warning that
looks like nothing and is a hole. Measured, it fails: **2.72:1**.

Pass 1 chose `#ef4a0f` because it read 3.1:1 *against the paper swatch*. But the paper under
this word is not the swatch. The grain layer sits over everything and the blue ghost multiplies
into it, and the ground the word actually stands on is `#e4dcca` — a hair darker, and the hair
is the whole margin. The declared number passed; the reader's number did not.

**Change.** The word's ink two steps deeper, `#d63f0b`: 3.36:1 where the word sits and 3.80:1
on bare paper, so it clears the bar on the ground it is actually printed on rather than on the
one named in the token. It is still the hot ink; the ghost, the crop and the board are
untouched. All three posts pass at 1080 × 1350 with no failures and no warnings.

The lesson generalises past this piece: a colour chosen against its swatch is a colour chosen
against a ground that does not exist anywhere on the page. Anything laid over it — grain, a
scrim, a blend, an opacity — moves the number, and only the pixels know by how much.
