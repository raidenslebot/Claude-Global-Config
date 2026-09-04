# Coldwater Branch — the timetable as a picture of the service

**The field.** A printed wall timetable for a rural branch line. Not a brand system, not a
campaign, not a screen. A public information sheet, read standing up, in bad light, by someone
who needs one number.

**Why this example exists.** This package shipped six reference designs across six fields in one
palette — the same cream ground in all six, the same burnt orange in five. The examples *are*
the taste, more than any prose about taste, and a reference set with one look teaches one look.
This piece exists to share no axis with the others: not the ground, not the accent, not the
faces, not the layout grammar, not the motion. `cgc distinct` is the check on that claim, and it
was written because nothing here could make it.

## The idea

**The shape of the line is the design.** A timetable is normally a grid of equal rows, which
says every station is the same distance from the next. They are not. Marsh Halt is nine minutes
out of Coldwater and Ardleigh Sands is seventy-six, and the long empty run across the fen between
Gaunt Bridge and Wraycombe is the part of the journey a passenger actually feels.

So the vertical axis is journey time, not row count: a station sits as far down the sheet as it
is far along the line. The sheet is a picture of the route, and reading a column downward is
watching the train go. The white space between two stations is the distance between them.

That is a structural decision, not a surface one. Take it out and the piece does not merely look
plainer, it stops saying anything.

## The decisions, and what they exclude

- **Ground: paper, cooled.** `oklch(0.97 0.008 150)` — a white with a breath of green in it, the
  colour of a mounted sheet under fluorescent light. Deliberately not the warm cream the other
  examples share; a cool ground makes the ink look like ink rather than like a brand colour.
- **Ink: a green-black.** `oklch(0.24 0.02 160)`. Black at a distance, alive up close, and it
  keeps the whole sheet in one hue family so the one colour that is not in that family reads as
  information rather than decoration.
- **One colour, and it is data.** A single red, used for exactly one thing: the service that does
  not run on Sundays. It is not an accent, it is a legend entry. If it appeared anywhere else it
  would be a lie.
- **Type does the work.** A condensed grotesque for station names, so long names set at one size
  without abbreviation; tabular, lining numerals for the times so every column aligns on the
  minute; small caps for the notes. No display face, because a timetable has no headline.
- **Grammar: a distance-scaled grid.** Rows are positioned by `grid-row` computed from minutes
  along the line, on a track of one minute each. Not flex, not a stack, not a card. The other examples here are placed or
  stacked compositions; this one is a coordinate system.
- **Motion: none, chosen.** It is a printed sheet. Stillness is the decision, and the piece is
  rendered to paper as well as screen.

## What would make it worse

- An accent colour for the header. The header is not important; the times are.
- Evenly spaced rows, "for legibility". That is the one change that removes the idea: it turns a
  picture of a route back into a list of departures.
- A second weight of red. The moment red means two things it means nothing.
- Rounded corners, a card, a shadow. There is no card. It is a sheet of paper.

## The gates

`cgc lint` (no fingerprint), `cgc techniques` (the medium is web + print; the piece should read
as entering several dimensions without collecting), `cgc audit --viewport` at the sheet size
(contrast on the real ground, the small print measured where it sits), `cgc print-lint --size a3`
because it is printed, and `cgc distinct` — which must find no shared axis with
harbor-swim-club or night-market. The last one is the reason this exists.

## The swap test

Could this sheet carry another railway's name and still be the same design? Change "Coldwater
Branch" to "Wrenford Loop" and the sheet is *not* the same, because the shape of it is this
line's shape: two stops close together at the start, a long empty run across the fen between
Gaunt Bridge and Wraycombe, a final hop to the sea. Another line has another silhouette. The
sheet is a portrait of one route, and swapping the subject rebuilds the composition.

The parts that *would* survive a swap are the parts that should: the ink, the paper, the figures,
the single red. That is a house style doing its job — a railway's sheets ought to look like each
other. What must not survive is the shape, and it does not.

The test it fails deliberately: put an accent colour on the masthead, or space the rows evenly,
and it swaps perfectly onto any line in the country. That is the version this is not.

## Committed

The distance-scaled sheet. Cool white stock, green-black ink, one signal crimson that means a
single fact, Archivo Narrow with IBM Plex Mono, and a grid whose rows are placed by minutes along
the line. Not chosen from alternatives on a mood board — chosen because the only interesting
thing about a four-train-a-day branch line is the shape of it, and every other decision here is
in service of showing that shape to someone standing in front of it.
