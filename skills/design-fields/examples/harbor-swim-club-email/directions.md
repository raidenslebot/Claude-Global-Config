# Directions — Harbor Swim Club, the monthly email

Written before any markup. The subject is the club of the identity, tee, icon and deck examples;
the brief is the email that goes out on the first of each month. Email is the field where the
constraints, not the taste, decide the form — so the DNA table ends with what the medium takes
away.

## DNA — the club's world, minus what email cannot carry

| Ask | Answer |
|---|---|
| **Materials** | the tide table pinned to the changing-room door — the one artifact every member already reads monthly |
| **Motifs** | the waterline; the ring; the month as a list of Saturdays |
| **Palette from source** | navy on cream; the tow-float orange once |
| **Tempo** | monthly, the first of the month, read on a phone before dawn |
| **Vernacular** | "high water", "the wall", "nine degrees", "swim between the flags" |
| **Rules of the world** | the tide is the calendar; nothing is shouted |
| **What the medium takes away** | web fonts do not load in classic Outlook or Gmail [C]; images are off by default in Outlook desktop and many corporate clients [D]; flexbox and grid are ignored by the Word engine [D]; over ~102 KB Gmail clips the message [C]; there is no hover on a phone and no JavaScript anywhere |
| **What it leaves** | tables, background colours, borders, one link that must be a target, and type in a face the reader already has |

## Directions

1. **The tide table is the email.** *Cross-domain grammar,* and the only one that survives the
   medium: the month's high waters as an actual table — the thing members open the email for —
   with the identity's waterline as the rule under the header. Drawn in table cells and
   background colours, so **it is identical with images off**. *Swap test:* a pool club has no
   tide; a gym's newsletter has no artifact its members already read. **Survives.**
2. **The photo header.** A dawn shot of the harbour, the month's news beneath. *Swap test:* every
   newsletter ever sent, and with images off it is a grey box and a paragraph. **Fails twice.**
3. **One number.** "9°" at 90 px, one line, one link. *Extreme parameter.* *Swap test:* survives,
   and it is beautiful — but a monthly email that carries no tide table makes the member go and
   find the tide table. **Discarded: it is the design serving itself.**
4. **The chalk board.** The whiteboard tally as the header. *Material transplant.* *Swap test:*
   survives; but drawn in tables it is a picture, and a picture is off by default. **Runner-up,
   for the web page the email links to.**

## Committed

**Direction 1.** The email is the tide table, set the way the door version is, and it is the same
design whether or not a single image loads.

- **Canvas.** 640 px, one column, nested tables [D]; a single `<img>` — the mark — with real
  `alt`, and nothing structural depending on it. Under 100 KB of HTML [C].
- **Type.** **Georgia** for everything, with Times New Roman and a generic serif behind it: a
  face the reader already has, since web fonts do not arrive [C]. Sizes 15/17/28 px; the
  month at 28 px caps, tracked; nothing under 13 px.
- **The waterline.** A 3 px navy table row under the header, and a 1 px rule under each tide
  row. It is the identity's one variable, drawn in the only material email gives.
- **Colour.** Cream `#efe9dc` ground, navy `#1f2a44` ink, tow-float orange `#ff5a1f` on one
  thing: the temperature. Every colour is set on the cell as well as the wrapper, because a
  client that drops the outer background must not leave navy text on white-on-navy.
- **The link.** One: "Add the October swims to your calendar", as a bulletproof button — a
  table cell with padding and a background colour, not a styled `<a>` [C] — at 44 px tall so a
  thumb can hit it.
- **Dark mode.** `color-scheme: light dark` and a `@media (prefers-color-scheme: dark)` block
  that keeps the same two colours rather than letting a client invert the navy to a muddy blue.
- **The preheader.** The one line the inbox shows beside the subject: hidden in the body,
  saying what the subject cannot fit.

One sentence: *the changing-room tide table, posted monthly, and identical with images off.*
