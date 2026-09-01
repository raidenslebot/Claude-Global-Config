# Motion & Animation — The Universal Core

Motion is the difference between a diagram and a living thing. Every animation is a tiny argument about physics and attention: it says *this came from here, this belongs together, this is now important*. Real objects have mass and never teleport, never move at constant speed, never start and stop instantly — so neither should your pixels. The fanatic's rule: **nothing snaps, nothing is linear (except things that spin forever), and every motion has a reason a human could feel even with their eyes closed.** If you can't say what a transition *means*, delete it. If you can, make it fast, curved, and choreographed. Motion is not decoration you add at the end; it is how the interface breathes.

---

## 1. Easing — the physics of feel

Linear motion is the #1 tell of amateur work. Real things accelerate and decelerate. Use these curves; paste them as CSS variables and never hand-wave "ease" again.

```css
:root {
  /* ENTER / settle — decelerate: fast in, gentle stop. Your default for things arriving. */
  --ease-out-quint:    cubic-bezier(0.22, 1, 0.36, 1);   /* premium, crisp */
  --ease-out-expo:     cubic-bezier(0.16, 1, 0.3, 1);    /* dramatic, luxurious */
  --ease-out-cubic:    cubic-bezier(0.33, 1, 0.68, 1);   /* safe workhorse */

  /* EXIT — accelerate: gentle start, fast leave. For things dismissing. */
  --ease-in-cubic:     cubic-bezier(0.32, 0, 0.67, 0);
  --ease-in-quint:     cubic-bezier(0.64, 0, 0.78, 0);

  /* MOVE / morph — symmetric, both ends eased. For A→B repositioning. */
  --ease-in-out-cubic: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-in-out-quint: cubic-bezier(0.83, 0, 0.17, 1);

  /* OVERSHOOT — playful pop past target then settle. Buttons, toggles, badges. */
  --ease-out-back:     cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Material 3 emphasized (its signature curve is two halves, not one bezier) */
  --m3-emph-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);   /* enter */
  --m3-emph-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);   /* exit */
  --m3-standard:        cubic-bezier(0.2, 0, 0, 1);
}
```

**Strong defaults — deviate when you can say why, not by accident:**
- **Enter with ease-out, exit with ease-in.** Things arriving decelerate into place; things leaving accelerate away. Symmetric `ease-in-out` on an entrance is the mediocre default — it feels sluggish because it starts slow.
- **`linear` only for continuous motion:** spinners, marquees, progress that maps to real time, infinite scrollers. Everywhere else linear feels robotic and dead.
- **Bare `ease` is almost always the wrong pick** (`cubic-bezier(0.25,0.1,0.25,1)`) — it's weak, symmetric, and the browser default everyone recognizes as "didn't think about it." Reaching for it deliberately is fine; landing on it because you didn't choose is the tell.
- **Overshoot (`back`) is a spice, not a sauce.** Great on a single hero toggle; nauseating on every list item.

Mediocre → beautiful:
```css
/* AI slop: symmetric, slow-starting, one duration for everything */
.card { transition: all 0.3s ease; }

/* Intentional: composited props only, enter curve, tuned duration */
.card { transition: transform 220ms var(--ease-out-quint), opacity 160ms linear; }
```

---

## 2. Timing — duration is a budget

| Motion | Duration | Notes |
|---|---|---|
| Micro (hover, press, toggle, checkbox) | **80–160ms** | Must feel instant. >200ms feels laggy. |
| Small entrance (tooltip, dropdown, chip) | **160–240ms** | |
| Standard entrance (card, modal, sheet) | **240–360ms** | The bread-and-butter range. |
| Large / full-screen (page, hero, dialog) | **360–500ms** | Bigger travel earns more time. |
| Complex orchestrated sequence | **500–800ms** total | Built from staggered shorter parts, not one long tween. |
| Ambient loop (breathing glow, float, gradient) | **3–8s**, `infinite` | Slow enough to feel alive, not distracting. |

**Iron law: exits are ~30% faster than entrances.** A modal enters in 300ms and leaves in 200ms. Why? Arriving content wants a graceful reveal; leaving content is already dismissed in the user's mind — lingering feels like lag. Distance scales duration: a 600px sheet travels longer than a 40px tooltip, but cap everything at ~500ms or the UI feels slow. When in doubt, make it faster — users almost never complain that an interface is too responsive.

---

## 3. Springs — when physics beats duration

A spring has no duration; it has *character*. Reach for springs on anything the user directly manipulates (drags, toggles, swipes) or anything that should feel physical and alive. Reach for duration+bezier on precise, orchestrated, timed sequences (page loads, onboarding steps).

Three knobs:
- **Stiffness** — pull toward target. Higher = snappier/faster. `120` gentle, `300` responsive, `500+` snappy.
- **Damping** — friction. Lower = more bounce/oscillation. `0` oscillates forever; high = no bounce.
- **Mass** — weight/inertia. Higher = slower, heavier, more overshoot. Leave at `1` unless simulating something big.

The relationship that matters: **bounce comes from damping being low relative to stiffness.** Want snappy-no-bounce? Raise damping with stiffness together.

Motion for React recipes (`import { motion } from "motion/react"`):

| Feel | stiffness | damping | mass | Use for |
|---|---|---|---|---|
| Crisp UI (default) | 400 | 32 | 1 | buttons, menus, most transitions |
| Snappy | 550 | 30 | 1 | toggles, quick reveals |
| Gentle | 170 | 26 | 1 | large panels, calm content |
| Bouncy / playful | 300 | 12 | 1 | success states, emoji, mascots |
| Heavy / weighty | 260 | 30 | 1.4 | big sheets, drawers |

```jsx
<motion.div
  initial={{ opacity: 0, y: 12, scale: 0.98 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: 8, scale: 0.98 }}
  transition={{ type: "spring", stiffness: 400, damping: 32 }}
/>
```
Motion also accepts a visual spring — `{ type: "spring", bounce: 0.25, duration: 0.5 }` — often easier to reason about: `bounce: 0` = no overshoot, `0.3` = lively. `react-spring` config presets for reference: `default {170,26}`, `gentle {120,14}`, `wobbly {180,12}`, `stiff {210,20}` (tension/friction).

---

## 4. Choreography — a sequence is a story

A pile of elements all animating at once (or worse, identically) reads as chaos. Stagger and orchestrate so the eye is *led*.

- **Stagger delay: 20–60ms between siblings.** `30–50ms` is the sweet spot for lists/grids. Below 20ms it's a blur; above 80ms it drags. Cap total sequence time — for a 30-item list, use a smaller per-item delay or animate only the visible ones.
- **Direction carries meaning.** Stagger top-to-bottom for a menu opening down; from the click origin for a radial/context menu; left-to-right for a timeline.
- **Orchestrate parent→child.** Container fades/expands first, then children stagger in after a `delayChildren`. The container sets the stage; children populate it.
- **Overlap, don't queue.** The next element should begin before the previous finishes (~40–60% through). Fully sequential tweens feel slow and mechanical.

```jsx
// Motion for React — parent orchestrates, children inherit the beat
const list = { animate: { transition: { delayChildren: 0.1, staggerChildren: 0.04 } } };
const item = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
```
```js
// Vanilla Motion — stagger() helper, 50ms apart, from the center
import { animate, stagger } from "motion";
animate(".item", { opacity: [0, 1], y: [12, 0] },
  { delay: stagger(0.05, { from: "center" }), duration: 0.4, ease: [0.22, 1, 0.36, 1] });
```

**Shared-element transitions** are the crown jewel: an element persists and *travels* between two states (thumbnail → full image, list row → detail page) instead of one fading out while another fades in. The eye tracks one continuous object, so the app feels spatially real.
- Web (same-doc): `document.startViewTransition(() => updateDOM())`, pair elements with matching `view-transition-name`.
- Web (cross-doc / MPA): `@view-transition { navigation: auto; }` in CSS — real page-to-page morphs, no framework.
- React: Motion's `layoutId="hero"` on both elements auto-runs a FLIP transition between them.

---

## 5. The 12 principles, reframed for interfaces

| Principle | In UI/interaction, concretely |
|---|---|
| Squash & stretch | Button scales to `0.96` on press; a dropped card squashes on landing. Conveys material and force. |
| Anticipation | Tiny wind-up before a big move — a sheet dips 4px before flying up; a like button pulls in before bursting. |
| Staging | One hero motion at a time. Don't animate five things competing for the eye. |
| Straight-ahead vs pose-to-pose | Physics/springs (emergent) vs keyframes/timelines (authored). Pick per shot. |
| Follow-through & overlap | Trailing elements settle after the leader; spring overshoot; stagger. Nothing stops all at once. |
| Slow in & slow out | Easing itself. The core. Never linear. |
| Arcs | Move along curves, not straight lines — shared-element transitions and FLIP should arc, feels organic. |
| Secondary action | Supporting motion: chevron rotates as an accordion opens; icon nudges as a toast slides in. |
| Timing | Duration + fps. The budgets in §2. |
| Exaggeration | Juice — push overshoot, scale, and color past "realistic" for feedback that *lands*. |
| Solid drawing | Depth that's consistent: shadow grows and offsets as elevation rises during the move. |
| Appeal | Personality and charm. A spring with a little bounce has more appeal than a clinical linear fade. |

---

## 6. Juice — the animation ideal

"Juice" (game-feel) is maximal feedback per input: the interface *responds* to everything, generously. Vlambeer's principle — *the same game feels dead or alive purely from juice.* Bring it to UI in moderation:
- **Press feedback everywhere:** scale `0.96` + subtle shadow collapse on `:active`. Instant, springy release.
- **Overshoot on success:** a completed toggle or added-to-cart pops to `1.08` then springs to `1`.
- **Particles & bursts** for meaningful wins (confetti on purchase, sparkles on a like) — rare, so they stay special.
- **Hit-stop / anticipation** for weighty actions: a 40–80ms freeze before a big state change reads as impact.
- **Color and glow flashes** on state change instead of a silent swap.
- **Everything eased, nothing instant.** Even an error shake uses a decaying spring, not a linear jitter.

The line: juice *rewards* action; it never *delays* it. If the juice makes the user wait, it's friction wearing a costume.

---

## 7. Performance — 60fps is the floor, 120 is the target

Frame budget: **60fps = 16.7ms/frame, 120fps (ProMotion/high-refresh) = 8.3ms.** Miss it and every principle above collapses into jank.

**Web — animate only `transform` and `opacity`.** These run on the compositor thread — no layout, no paint. Everything else risks thrashing.

| Cheap (composited) | Expensive (avoid animating) | Do instead |
|---|---|---|
| `transform: translate/scale/rotate` | `top/left/margin/width/height` | `transform` |
| `opacity` | `box-shadow` | animate opacity of a pseudo-element holding the shadow |
| `filter` (careful) | `background-color` on large areas | overlay a fading layer, or accept the cost on small elements |
|  | `clip` (legacy) | `clip-path` (composited-ish, far better) |

- **`will-change: transform` sparingly** — only just before an animation, remove after. It's a promise that costs memory; leaving it on everything backfires.
- **Avoid layout thrash:** batch DOM reads then writes; never read `offsetHeight` in a loop that also writes styles. Use `requestAnimationFrame`.
- **FLIP** for layout moves: measure First/Last positions, apply an Invert `transform`, then Play by transitioning it to identity — you animate a cheap transform instead of expensive layout props. Motion's `layout` prop does this for you.
- Prefer the **Web Animations API / Motion's hybrid engine** over `setInterval`; they can run off the main thread.

**Per-platform:**
- **SwiftUI:** animations are GPU-composited; use `.drawingGroup()` for heavy layered content; prefer transform-like modifiers.
- **Jetpack Compose:** animate inside `graphicsLayer {}` for alpha/scale/rotation (skips recomposition/relayout); avoid animating layout that re-measures every frame.
- **Flutter:** wrap animated subtrees in `RepaintBoundary`; drive with `Transform`/`Opacity`/`AnimatedBuilder` rather than rebuilding layout; watch the raster thread in DevTools.
- **Unity:** pool particle/tween objects, cache `Transform`, tween with DOTween instead of per-frame `Update` math; keep overdraw down.

---

## 8. Per-platform tools & snippets (2026, verified)

**Web / JS**
- **Motion** (`motion.dev`, npm `motion`) — the default. Tiny, hybrid WAAPI engine, springs, `animate`, `scroll`, `stagger`, `layout`. `import { animate, scroll, stagger } from "motion"`.
- **GSAP** (`gsap.com`) — **100% free including all plugins since April 2025** (SplitText, MorphSVG, DrawSVG, ScrollTrigger). Best for complex timelines, SVG morphing, text splitting, scroll scrubbing.
  ```js
  gsap.from(".card", { y: 24, opacity: 0, duration: 0.5, ease: "expo.out", stagger: 0.05 });
  ```
- **anime.js v4** (`animejs.com`, modular ESM) — lightweight, expressive.
  ```js
  import { animate, stagger } from "animejs";
  animate(".item", { translateY: [12, 0], opacity: [0, 1], delay: stagger(50), ease: "outExpo", duration: 400 });
  ```
- **Web Animations API** (no deps):
  ```js
  el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
    { duration: 400, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "both" });
  ```
- **CSS scroll-driven animations** (Chromium shipped, progressive-enhance elsewhere) — reveal on scroll with zero JS:
  ```css
  @keyframes reveal { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
  .section { animation: reveal linear both; animation-timeline: view(); animation-range: entry 0% cover 40%; }
  ```
- **View Transitions API** — shared-element / page morphs (see §4).

**React** — **Motion for React** (`import { motion, AnimatePresence } from "motion/react"`). `AnimatePresence` for exit animations, `layout`/`layoutId` for shared-element and auto-FLIP, `useReducedMotion()` built in.

**Game / C# (Unity)** — **DOTween**. Ease on every lerp — never `Vector3.Lerp` with linear `t`.
```csharp
transform.DOMoveY(2f, 0.4f).SetEase(Ease.OutBack);
transform.DOScale(1.08f, 0.09f).SetLoops(2, LoopType.Yoyo).SetEase(Ease.OutQuad); // press pop
// Hand-rolled ease-out cubic on a manual lerp:
float e = 1f - Mathf.Pow(1f - t, 3f);
```

**SwiftUI** — spring-first. iOS 17+ presets are excellent defaults.
```swift
withAnimation(.snappy) { isOpen.toggle() }              // crisp, minimal bounce
withAnimation(.bouncy) { showBadge = true }             // playful
withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) { offset = .zero }
```

**Jetpack Compose** — `animate*AsState` for value-driven, `spring()` specs, `updateTransition` for coordinated.
```kotlin
val scale by animateFloatAsState(
  targetValue = if (pressed) 0.96f else 1f,
  animationSpec = spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMedium)
)
```

**Flutter** — implicit widgets (`AnimatedContainer`, `AnimatedOpacity`) for simple; `AnimationController` + `CurvedAnimation` for control. Use Material 3's emphasized curve: `Curves.easeInOutCubicEmphasized`; also `Curves.fastOutSlowIn`, `Curves.easeOutBack`.
```dart
AnimatedContainer(duration: const Duration(milliseconds: 300),
  curve: Curves.easeOutCubic, /* ... */);
```

**Terminal / TUI** — motion is frame timing. Target 30–60fps (16–33ms/frame), redraw with `\r` or alternate-screen ANSI, and *ease your progress bars* too. Braille spinner at ~80ms/frame: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`. Reach for `rich`/`textual` (Python) or `ora`/`ink` (Node) before hand-rolling; keep CPU low by only redrawing changed cells.

---

## 9. When NOT to animate — restraint is taste

Animation is a cost the user pays in time and attention. Spend it deliberately.
- **Don't animate high-frequency, repeated actions** — every keystroke, every scroll tick, rapidly toggled filters. It compounds into lag and nausea.
- **Don't animate to hide slowness.** A 1s page transition doesn't make a slow load elegant; it makes a fast app feel slow. Keep transitions short so the app feels *quick*.
- **Don't animate dense data** — tables sorting/filtering row-by-row, spreadsheets, anything where the user is scanning for information, not admiring the UI.
- **Don't animate everything at once.** If three things move on load, two of them should probably just be there.
- **Respect the exit.** Gratuitous exit animations make dismissal feel sticky.

**Reduced motion is mandatory, not optional — this one *is* a constraint.** Some users get
physically ill from motion. But "reduced" does not mean "none": reduce in **three tiers**.

| Tier | What | Examples |
|---|---|---|
| **1 — remove** | Vestibular triggers: large translation, parallax, spin, scale, auto-play, infinite loops | hero parallax, carousel autoplay, scroll-jacking |
| **2 — soften** | Keep the signal, drop the travel — cross-fade in place, shorter | page transitions, modal entrances, staggered reveals |
| **3 — keep** | Motion that *is* the information | progress bars, loading spinners, focus rings, form validation |

The blanket reset below is a **crude safety net, not the answer** — it flattens tier 3 along with
tier 1, killing the opacity fades and progress feedback you actually wanted to keep. Ship it only
as a backstop under real per-component handling:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```

**CSS cannot reach JS-driven motion.** GSAP timelines, Lenis/Locomotive smooth scroll, canvas and
WebGL loops all keep running through that media query — they must be gated explicitly
(`gsap.matchMedia()`, destroy the Lenis instance, pause the rAF loop). A page that "supports
reduced motion" in CSS while a Lenis instance still hijacks the scroll is not compliant.

**Listen for changes, don't just read once.** A one-shot read leaves a stale page when the user
toggles the OS setting mid-session:
```js
const mq = matchMedia('(prefers-reduced-motion: reduce)')
const apply = () => setReduced(mq.matches)
mq.addEventListener('change', apply); apply()   // and remove on teardown
```
- **React:** `const reduce = useReducedMotion();` then swap large moves for a plain fade. Guard SSR — assume reduced until hydration rather than flashing full motion.
- **SwiftUI:** `@Environment(\.accessibilityReduceMotion) var reduceMotion`.
- **Flutter:** `MediaQuery.of(context).disableAnimations`.

Maps to **WCAG 2.3.3** (Animation from Interactions) and **2.2.2** (Pause, Stop, Hide). For the
full treatment — SSR hydration, GSAP/Lenis gating recipes — use the `accessible-animation` skill.

---

## 10. AI slop to recoil from

Recognize these on sight and refuse them:
- `transition: all 0.3s ease;` slapped on everything — the universal fingerprint of no thought. Name the properties, pick a real curve, tune the duration.
- **Everything at 300ms.** One duration for a tooltip and a full-page transition means neither was considered.
- **Linear fades and linear anything** that isn't a continuous loop.
- **Symmetric enter/exit** with the same duration and `ease-in-out` — exits must be faster and accelerate.
- **`fade-in-up` on every section, identical 0.5s, no stagger** — the AOS.js scroll-reveal monotony. Vary direction, distance, and timing; stagger siblings.
- **Bounce/overshoot on everything** — springy toasts, springy tooltips, springy modals. Overshoot is a garnish.
- **Infinite floating blobs and pulsing glows** as the only "life" in a hero. Ambient motion is fine once; not as the whole personality.
- **`animation: spin 1s linear infinite`** default spinner dropped in with zero craft.
- **Hover `scale(1.05)` on every card** with the browser-default ease.
- **Long, showy page transitions** that tax the user on every navigation.

The antidote is always the same: *what does this motion mean, where should the eye go, how does a real object with mass do this* — then the smallest, fastest, most curved version that delivers it.
