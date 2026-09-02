# Review — the passes

Rendered with `cgc render email.html --preset email --full`; gated with
`cgc lint .` (clean) and `cgc audit email.html --viewport 640x1200`. The HTML is
8.9 KB, well under Gmail's 102 KB clip. Nothing here proves Outlook — only a send-test does, and
the file says so.

## Pass 1

The tide table carries the email, the waterline rule sits under the header, and with images off
the design is unchanged — which was the whole point of drawing every structural line as a table
row. **The audit failed it twice, and both were real:**

- **Contrast 4.09:1** — the tow-float orange on cream at 17 px, against the 4.5:1 floor. The
  first instinct was to darken the orange to `#b83c0d` (4.70:1). Following it further was better:
  the identity's own sheet says orange has **one use, the safety flags**, and a monthly water
  temperature is not a safety notice. So the accent came out altogether and the number is carried
  by size and weight instead. The contrast failure was the symptom; the system violation was the
  defect.
- **A tap target 20 px tall.** The padding was on the button's table cell, which looks like a
  button and is not one — in a mail client only the anchor's own box is the link, so the reader
  gets a 20 px strip inside a 48 px rectangle. The padding moved onto the anchor
  (`display:inline-block`), which is why the bulletproof-button pattern puts it there.

**Also fixed by eye:** the mark rendered as a quarter of itself. It had been exported with
`--trim 0.5x0.5in` from a 1 in artwork, so the renderer clipped rather than scaled. Re-exported at
`--trim 1x1in --png 96` — a 96 px file displayed at 48, crisp on a retina phone.

## Pass 2

No failures, no warnings. The palette reads as two colours: cream 95%, navy 5% — which for an
email that is mostly a table is exactly right.

The professional's questions, each a yes: the two-second read is "high water, October" and the
five Saturdays under it; the sentence — *the changing-room tide table, posted monthly, and
identical with images off* — describes no newsletter template; with another club's name the tide
table stops being the thing its members already read; the structure is the artifact, not a header
image and a paragraph; one face the reader already has, at three sizes, because web fonts do not
arrive; two colours; nothing under 13 px; one link, 48 px tall, with a real destination; a
preheader that says what the subject cannot; a dark-mode block that holds the two colours rather
than letting a client invert navy into mud; alt text on the only image; the HTML under 100 KB.

**Considered and not made:** a second link to the club's page, and the chalk-tally header from
direction 4. One link is the discipline; the tally is a picture, and a picture is off by default.
The loop ends here.
