# Harbour Swim Club — tide board

A live board for the clubhouse wall and the members' phones: what the tide is doing right now,
when it turns, and how cold the water is. The fifth piece in the Harbour Swim Club family, and
the first one in the system that **moves**, which is the whole reason it exists as an example.

---

## The DNA — from the club's real artifacts, not from "swimming websites"

Read off the identity already on disk (`harbor-swim-club-identity/`) and off the things a tidal
sea-swimming club actually has:

| Artifact | What it is made of |
|---|---|
| The tide staff bolted to the harbour wall | A painted vertical rule. Numerals in metres, an E-mark every half metre, and the water simply covering them. Nobody reads a number: they read *how far up it has got*. |
| The chalk board by the steps | Today's high and low, written by hand each morning, with the water temperature added at 7am and rubbed out at dusk. Condensed capitals because the board is narrow. |
| The tide table in the pocket | Tabular figures, four columns, no decoration. The one place precision matters. |
| The flags on the pole | Two colours only. The club spends colour on safety and nowhere else. |
| The water | Navy at depth, cream where it breaks. It is never still, and it never moves fast. |

**The identity's colour rule, honoured:** navy `#1f2a44` and cream `#efe9dc` carry everything;
tow-float orange is reserved for the safety flags and appears **nowhere on this board**. A tide
is not a warning. Withholding the third colour is the decision, not an omission.

---

## Directions

### 1. The staff — *the wall gauge, at reading height*

The page **is** the tide staff. A tall painted rule down the left, numerals in metres, and the
water at its real level right now. The readout sits beside it in the club's condensed capitals.
The water is the only thing that moves, and it moves because the sea does.

- **Motion argument:** the level is the datum. It rises to the current height on load and then
  breathes with a swell of about half a percent — the amount a real harbour moves in a calm.
- **Risk:** a vertical bar is close to a progress meter. Beaten by making it a *painted object*
  with E-marks and submerged numerals rather than a rounded track.

### 2. The curve — *twelve hours of tide, drawn*

The semidiurnal curve across the full width, drawn on with `stroke-dashoffset`, a travelling
marker on `offset-path` at now, high and low labelled where they fall.

- **Motion argument:** the draw-on is the shape of the day; the marker is the moment.
- **Rejected as the hero:** it explains the tide beautifully and answers "is it in or out?"
  slowly. On a phone at the top of the steps, the answer has to arrive in one look. Kept as the
  secondary panel, small, under the readout.

### 3. The porthole — *the page as water*

Content floats in a full-bleed body of water, swelling behind everything, seen through a mask.

- **Rejected.** It is the best-looking of the four and the motion means nothing: the swell is
  the same whether the tide is in or out. Decoration that has learnt to look like intent, which
  is exactly what this package exists to refuse.

### 4. The board — *departures, for water*

A list: HIGH 04:12 · LOW 10:30 · HIGH 16:41. Condensed, monospaced, on cream.

- **Rejected as the centroid.** Correct, legible, and it could be any timetable for any club in
  any town. Nothing on it is tidal except the words. Its one good idea — tabular figures in a
  strict four-column rhythm — is taken into direction 1's readout.

---

## The swap test

Swap the club's name for another club's, and swap the harbour for another harbour:

- **1 survives, and only just as itself** — the numerals, the E-marks and the level are this
  harbour's on this afternoon. Change the harbour and the whole picture changes, because the
  picture *is* the data. That is the test passing in the strongest way it can.
- **2 survives** but reads as a chart of any tide anywhere; it is a diagram, not a place.
- **3 does not survive.** Swap anything and it is unchanged, which means it was never about the
  club at all.
- **4 does not survive.** It is a timetable with a different logo on it.

## Committed

**Direction 1, the staff, with direction 2 kept small underneath it.** Boldness is spent in one
place — the water — and everything else is quiet: two colours, one condensed face, tabular
figures, no rules that are not painted on a real gauge.

**What the motion has to earn.** The rise is the only large movement and it happens once, on
arrival, over about 1.4 s with a hard deceleration, because water finding its level slows as it
gets there. The swell after it is half a percent and seven seconds long: present if you watch,
invisible if you glance. Under `prefers-reduced-motion` the water is simply *at* its level, with
no rise and no swell, and the board loses nothing — which is the test of whether the motion was
decoration. It is not: it is the datum arriving.

**What is deliberately absent:** orange, a card, a shadow, a rounded corner, a gradient that is
not water, and any animation on anything that is not the sea.
