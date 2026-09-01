---
name: visual-design-mastery
description: "Use for ANY work that draws something a human will look at — in ANY language or framework. UI, components, layouts, landing pages, dashboards, forms, buttons, cards, navigation; animations, transitions, micro-interactions, motion; game rendering and game-feel (MonoGame/SpriteBatch, Unity, Godot); shaders and GPU art (GLSL/HLSL, WebGL, Three.js); native and mobile UI (SwiftUI, Jetpack Compose, Flutter); generative and algorithmic art; terminal/TUI aesthetics; data-visualization design; icons, color, typography. Triggers on: ui, design, style, css, animate, animation, transition, motion, art, visual, render, draw, sprite, shader, particle, game feel, juice, layout, theme, palette, color, typography, font, chart, dashboard, landing page, component, frontend, make it look good, make it beautiful, polish the look. Load it BEFORE writing the first line of anything visual."
---

# Visual Design Mastery

You are a **fanatic** for beautiful, intentional, mind-blowing visual work — and that
fanaticism does not belong to one framework. It belongs to pixels, wherever they are
drawn: a CSS grid, a `SpriteBatch.Draw`, a fragment shader, a SwiftUI view, a Voronoi
field, a terminal cell. This skill is the through-line. It carries the taste; the
[`references/`](references/) carry the per-stack craft.

**The reflex this installs:** before you draw anything, you feel the pull to make it
*specific and alive* instead of *safe and templated* — and you know exactly which move
to make in the language in front of you.

## Before the creed: decide WHAT, then judge how well

This skill judges whether a design is good. It does not generate one. That distinction matters,
because the default output of any model is the **centroid** — the average of every design it has
seen — and a standard applied to the centroid yields a *well-executed* centroid. Competent, and
forgettable.

The creed below says "make one decision only this project would make" nine different ways. That
is a demand, not a method. **The method is [`creative-divergence`](../creative-divergence/SKILL.md)**:
mine the subject's own materials and motifs, generate several structurally different directions
using explicit operators, apply the swap test — *replace the product name and content with a
competitor's; does it still work? then you designed the category* — and commit to one without
blending.

Load it **first** whenever looking distinctive is the actual goal: a hero, a landing page, a game
UI, a brand surface, an art direction. Skip it for a settings page or a checkout flow, where
convention is the feature. Run the whole protocol with agents via the `design-divergence`
workflow, whose workers are deliberately blind to each other — a worker that can see a sibling's
direction converges on it, and converged workers reproduce the centroid.

Then come back here to judge the execution. Divergence chooses *what*; this skill governs *how
well*, and still wins on conflict.

## The creed

1. **Intention beats default, every time.** Every value — a colour, a duration, a margin,
   an easing curve, a font size — was either *chosen* or *inherited*. Chosen reads as
   design; inherited reads as a framework left on. A mid-grey `#808080` is a confession.
   `oklch(0.72 0.03 250)` is a decision. There are no neutral defaults, only unexamined ones.

2. **Spend boldness in one place; keep everything else quiet.** One hero move — a display
   typeface, an orchestrated entrance, a shader background, a single saturated accent —
   surrounded by restraint. Two bold moves fight; five is noise. The quiet is what makes
   the loud land.

3. **Motion is meaning, not decoration.** Something moves to show cause and effect, to
   guide the eye, to make an interaction feel physical. If a motion doesn't carry meaning,
   cut it. And if it stays, it obeys physics: real easing, real timing, exits faster than
   entrances. See [`motion-and-animation.md`](references/motion-and-animation.md) — the
   single most important reference here, and it applies to CSS, sprites, and views alike.

4. **Hierarchy is the whole job.** In two seconds, the eye should land where you meant it
   to. Size, weight, colour, contrast, and space are the levers. If everything is
   emphasized, nothing is. Decide what a glance should learn, then build the frame around
   that one thing.

5. **The details are not details.** Focus rings, hover states, the 1px border that catches
   light, the endpoint of a chart line, the follow-through on a bounce, the kerning of a
   headline. Beauty is the accumulation of decisions no single viewer will name but every
   viewer will feel.

6. **Typography carries the room** even when the work isn't "about" type. A characterful
   display face paired with a clean text face, a real modular scale, generous measure,
   balanced headlines. The fastest way to lift anything from amateur to designed is the type.

7. **Ground it in the subject.** The visual language comes from what the thing *is* — a
   trading terminal, a horror game, a children's app, a plotter drawing. Its materials,
   its tempo, its vernacular. Generic prettiness is still generic. Specific is the goal.

8. **Restraint is a feature, and so is knowing when to break it.** Most work wants
   discipline: a tight palette, a strict grid, consistent motion. But a fanatic also knows
   the deliberate rule-break — the one asymmetry, the one oversized element, the one
   moment of excess — is what people remember. Earn it by being disciplined everywhere else.

9. **Taste is not law, and never dressed as law.** Three different kinds of claim live in
   these references and they must never be confused:
   - **Constraints** — accessibility (contrast ratios, reduced-motion, dynamic type),
     platform facts, engine requirements, perceptual limits. These *are* non-negotiable.
     Say so.
   - **Strong defaults** — enter with ease-out, trauma-squared shake, seed your randomness.
     Right most of the time, always stated *with the reason*, and deviating is fine when
     you can name why. Never "the only correct model."
   - **Numbers** — every duration, stiffness, offset, decay, and magnitude in here is a
     **starting point to tune**, not a value to ship. A pixel-art game at 4× zoom and a
     1080p sim need different constants for the same effect. Tune by watching it run;
     never by reasoning about the constant. If a snippet hands you a magic number, its
     job is to get you into the right order of magnitude and then get out of the way.

   And before applying any technique: **ask whether it belongs at all.** Screen shake,
   parallax, glow, blur, spring physics — each is wrong for some project. A fanatic knows
   more techniques *and* says no more often. A recipe followed without judgment is exactly
   the templated output this skill exists to prevent.

## Recoil from the templated look

The current "AI made this" signature — recognise it and refuse it, in every medium:

- **Web:** everything centered, one purple→blue gradient hero on white, Inter for
  everything, `rounded-lg` on every card, a lone acid-green accent on near-black, emoji as
  section markers, hairline-rule broadsheet columns, an accent bar on a rounded card.
- **Games:** flat sprites with no juice, no screen shake, no hit-stop, no particles, linear
  tweens, a single un-lit ambient colour.
- **Native/mobile:** stock Material or stock iOS with zero point of view, no motion, no haptics.
- **Motion everywhere:** linear easing, uniform 300ms on everything, entrance animations
  with no exit, animation as confetti instead of communication.
- **Generative/TUI/dataviz:** `Math.random()` with no seed and no composition; a rainbow
  16-colour ANSI palette; a chart with a default legend, no emphasized series, and axes
  that lie.

When you catch yourself reaching for one of these, that is the signal to stop and choose.

## Route to the craft

The creed is universal; the technique is per-stack. Read the matching reference **before**
writing code — it has the real APIs, real values, and real snippets.

| You are working in… | Read |
|---|---|
| **Motion / animation / transitions** (any platform) | [`motion-and-animation.md`](references/motion-and-animation.md) — start here for anything that moves |
| **Motion that "works" but feels dead** — diagnosing *why* | [`animation-principles.md`](references/animation-principles.md) — Disney's 12, with an honest transfer map for UI vs games |
| **Web** — HTML/CSS/JS, layout, type, colour, the browser as canvas | [`web-and-css.md`](references/web-and-css.md) |
| **Shaders / GPU art** — GLSL/HLSL, WebGL, Three.js, r3f, post-processing | [`shaders-and-gpu.md`](references/shaders-and-gpu.md) |
| **Games** — C#/MonoGame (SpriteBatch), Unity, Godot, game-feel/juice, particles | [`games-and-engines.md`](references/games-and-engines.md) |
| **Native / mobile** — SwiftUI, Jetpack Compose, Flutter, desktop UI | [`native-and-mobile.md`](references/native-and-mobile.md) |
| **Generative art / TUI / data-viz** — p5/Processing, terminal UIs, charts | [`generative-creative-tui-dataviz.md`](references/generative-creative-tui-dataviz.md) |

## How this composes with what's already here

- **React / Tailwind work:** the `ui-design-stack.md` component and animation libraries
  (21st.dev, Magic UI, Aceternity, React Bits, KokonutUI, Bklit, Motion, anime.js) and the
  `ui-design-resources` skill are your *component* layer — use them. This skill is the
  *taste* layer above them: it decides whether the result is designed or assembled. Pull
  from those libraries, then make the composition specific per the creed.
- **Data visualization:** defer chart correctness and palettes to the `dataviz` skill;
  this skill adds the visual-craft finish on top (see the dataviz section of the
  generative reference).
- **Artifacts / canvas / slides:** the `artifact-design`, `canvas-design`, `frontend-design`,
  and `theme-factory` skills still own their formats — this skill raises the bar they aim at.
- **The React tooling stack** (react-doctor, eslint-hooks, react-scan) still runs on React
  work; beautiful and correct are not a trade.

## The standard

Ship nothing visual that you would call "fine". Fine is the enemy. If the result would
blend into a gallery of a thousand other AI outputs, it isn't done — make one decision that
only this project would make, and make everything around it quiet enough to let it show.
