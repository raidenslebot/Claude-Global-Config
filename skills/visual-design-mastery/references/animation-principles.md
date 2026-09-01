# Disney's 12 principles, for people who ship software

The 1930s Disney principles are the deepest available theory of *why motion reads as alive*.
They were derived for hand-drawn character animation, so some transfer to interfaces
completely, some transfer only to games, and a few do not transfer at all. Pretending all
twelve apply equally to a dropdown menu is how you get a bouncing, over-juiced UI.

**Read this after [`motion-and-animation.md`](motion-and-animation.md).** That file covers the
mechanics — easing, duration, orchestration, reduced-motion. This one covers the *why*, and the
vocabulary for saying what is wrong with motion that technically works but feels dead.

Every number here is a **starting point to tune by watching it run**, never a requirement.

## The transfer map — read this before the twelve

| Principle | UI / web | Game feel | Note |
|---|---|---|---|
| Timing | **core** | **core** | The single highest-leverage one. |
| Slow in & slow out | **core** | **core** | This is just easing. Non-negotiable in both. |
| Anticipation | useful | **core** | In UI, mostly on *user-initiated* actions only. |
| Follow through & overlap | useful | **core** | The difference between "moved" and "settled". |
| Staging | **core** | **core** | Hierarchy, restated as motion. |
| Arcs | useful | **core** | Rare in UI; nearly universal in games. |
| Secondary action | useful | **core** | The first thing cut when time is short. |
| Squash & stretch | situational | **core** | Wrong for most productivity UI. Right for playful UI. |
| Exaggeration | situational | **core** | Scales with how stylised the product is. |
| Appeal | **core** | **core** | Not a technique — an outcome. |
| Solid drawing | ✗ | partial | Volume/weight in 3D; meaningless for a 2D form. |
| Straight-ahead vs pose-to-pose | ✗ | ✗ | A *workflow* choice, not a property of the result. |

Two of the twelve are not output properties at all. Say so rather than inventing a UI analogue.

## The twelve

**1 · Timing.** How many frames a thing takes. Heavy things accelerate slowly and carry
momentum; light things snap. Timing alone communicates mass, and getting it wrong cannot be
rescued by any other principle. *UI:* exits faster than entrances — the user already decided.
*Games:* a boss telegraph is slow so it can be read; the strike is fast so it lands.

**2 · Slow in & slow out.** Real things accelerate and decelerate. Constant velocity reads as
mechanical instantly. This is easing, and it is the one principle with no legitimate exception
outside of deliberately robotic motion and continuous loops (a spinner, a marquee) where linear
is correct precisely *because* it has no beginning or end.

**3 · Anticipation.** A small counter-move before the main move: the wind-up before the pitch.
It tells the eye where to look before the payload arrives. *UI:* be careful — anticipation on a
*system*-initiated event just looks like lag. Reserve it for things the user triggered. *Games:*
essential; an attack with no wind-up is unreadable and feels unfair.

**4 · Follow through & overlapping action.** Nothing stops all at once. The body halts, the hair
keeps going. **Overlap** is the offset *during* motion; **follow through** is the settle *after*
it. Both come from the drag hierarchy — parts further from the root of motion lag more:

> root (hips / the card itself) → primary (limbs / the card's heading) → secondary (hands /
> body text) → tertiary (hair, cloth / the trailing chips and badges)

*UI:* this is exactly what a stagger is. Children lag the parent by a small offset — start
around 30–60ms and tune. *Games:* a cape, a ponytail, a weapon trail, a camera that arrives a
beat late. Drag scales with mass, flexibility, air resistance, and how loose the attachment is.

**5 · Staging.** Present one idea at a time, unmistakably. This is [hierarchy](../SKILL.md)
expressed through motion: if three things animate at once, the eye picks none of them. Move the
thing that matters and hold everything else still — stillness is what makes movement legible.

**6 · Arcs.** Almost nothing in nature travels in a straight line. Limbs pivot, thrown objects
parabola, heads trace curves. *UI:* mostly absent, and correctly so — a tooltip travelling in an
arc looks broken. The exception is anything with a physical metaphor: a dragged card returning,
a FAB expanding into a sheet. *Games:* near-universal. Straight-line motion is the tell of an
un-art-directed game.

**7 · Secondary action.** A supporting motion that enriches the main one without competing:
the whistle while walking. *UI:* the icon that rotates while the panel opens, the label that
fades a beat behind its container. *Games:* the shell casing, the dust puff, the recoil on the
camera. Rule: if the secondary action pulls attention *from* the primary, it has become a
competing primary — cut it or quiet it.

**8 · Squash & stretch.** Deformation under force, at **constant volume** — squash must widen,
stretch must narrow. Violate volume and the object reads as growing, not deforming. The
elasticity spectrum matters: rubber and cartoon characters deform hugely, faces and cloth
subtly, wood and metal almost imperceptibly — but *even rigid objects want 1–2%*, because
absolute rigidity is what reads as dead. *UI:* a button compressing slightly on press is
tactile; the same move on an enterprise data grid is childish. Judge by product voice.

**9 · Exaggeration.** Push past the literal to make the reading unambiguous. Realism is not the
goal; *believability* is. How far you push is a function of style — a physics sim and a
platformer want different amounts of the same technique. Under-exaggeration reads as timid far
more often than over-exaggeration reads as silly, but both exist.

**10 · Appeal.** Not a technique — the *result* when the other principles are working and the
design has a point of view. The animation equivalent of charisma. You cannot add appeal at the
end; it is what you get when timing, staging, and follow-through all agree.

**11 · Solid drawing.** Weight, volume, and anatomy that hold up from any angle. Meaningful in
3D and in character work; largely meaningless for a 2D form layout. Do not force an analogy.

**12 · Straight ahead vs pose-to-pose.** Draw frame by frame, or set keys and fill between.
This is a *workflow* choice with no observable trace in the finished product. In software the
analogue is procedural/physics-driven motion versus authored keyframes — a real engineering
decision, but not a design principle, and it is honest to say so.

## Slop to recoil from

- **Applying all twelve to everything.** The clearest sign someone read the list and stopped
  thinking. A settings toggle does not need anticipation, arcs, and secondary action.
- **Squash & stretch on serious software.** Bouncing, deforming elements in a financial
  dashboard or a medical tool read as unserious, not delightful.
- **Anticipation on system events.** A wind-up before a toast the user didn't trigger is
  indistinguishable from jank.
- **Follow-through with no damping.** Overshoot that oscillates three or four times reads as
  broken rather than physical. One overshoot and settle is almost always the whole effect.
- **Treating the principles as a checklist to satisfy** rather than a vocabulary for diagnosing
  motion that feels wrong. Their real value is naming the defect: "this has no follow through",
  "the staging is fighting itself", "the timing says light but the art says heavy."

## Going deeper

The full 144-skill treatment — the same twelve principles worked through twelve different
lenses (by domain, by UI element, by emotional outcome, by industry, by tool, by time scale,
by problem type) — lives on disk as a **Tier-3 reference library**, not as installed skills:

```
<your skill library>/animation-principles/skills/<group>/<topic>/SKILL.md
```

Find it by searching the library index rather than by a fixed path — the library lives wherever
this config was installed, which differs per machine:

```bash
grep -i "<topic>" <your library index>      # e.g. library/INDEX.md
```

Then read the specific file it names. The set is kept out
of session context deliberately: 144 skills that all trigger on the word "animation" would
thrash skill dispatch and cost ~6k tokens every session for content you need occasionally.
Especially worth pulling: `09-by-tool-framework/` (per-library specifics for GSAP, Framer
Motion, anime.js, Rive, After Effects) and `12-by-problem-type/` (motion sickness, timing
calibration, attention management) when diagnosing a concrete failure.
