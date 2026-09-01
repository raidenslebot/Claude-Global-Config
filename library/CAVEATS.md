# Known defects in the installed skills

These 12 skills are installed and resident. They are worth having, but they ship real errors.
Everything below was **verified directly** — against the live npm registry, or by reading the
file on disk — not taken on an agent's word. Correct these on sight; do not paste the noted
snippets as-is.

Regenerate the version rows with `npm view <pkg> version` — they rot.

## Blocking — will fail if pasted

**`react-three-fiber` — the `useThree` example does not compile.** `SKILL.md` declares `size`
twice inside one function body:

```jsx
const { camera, gl, scene, size, viewport } = useThree()
const size = useThree((state) => state.size)   // SyntaxError: already declared
```

Keep one. Use the selective-subscription form (`useThree(s => s.size)`) when you only want to
re-render on that slice.

**`react-three-fiber` — the pinned versions peer-conflict with React 19.** It pins
`@react-three/fiber ^8.18.8` and `three ^0.172.0`. Live: **R3F 9.7.0**, **three 0.185.1**. R3F 9
*is* the React 19 line, so a fresh `npm create vite` React app installs React 19 and the pinned
R3F 8 conflicts. Install `@react-three/fiber@^9` and `three@^0.185` and ignore the starter pins.

**`ascii-animation` — `getImageContext()` is not a real API.** SKILL.md line 68 says to
"read pixels with `getImageContext().getImageData`". It is
`canvas.getContext('2d').getImageData(x, y, w, h)`. The code block below the prose does it
correctly; only the prose is wrong.

## Wrong content

**`ascii-animation` — the two luminance ramps run in opposite directions.** Listed under one
"dark to light" heading, but ` .:-=+*#%@` is sparse→dense (high luminance → `@`) while the
70-char Bourke ramp as pasted starts `$@B%8&WM#` — dense→sparse. Using the Bourke ramp with the
short ramp's indexing inverts the image. Pick one direction and verify against a known gradient.

**`threejs-webgl` — "use power-of-two dimensions (512, 1024, 2048)" is a WebGL 1 relic.** three.js
dropped the WebGL 1 renderer in r163; WebGL2 handles NPOT textures with mipmaps and `REPEAT`. The
real 2026 constraint is KTX2/Basis block compression, not power-of-two.

**`gsap-web` / `svg-animation` — GSAP's plugins went free in 3.13, not 3.12.** (April 2025, under
Webflow.) Matters because `gsap-web`'s own `SplitText.create()` call is 3.13-only — on 3.12
SplitText was Club-licensed *and* the static factory did not exist. Live gsap is **3.15.0**;
just use current.

**`web3d-integration-patterns` ships only `SKILL.md`** — no `references/`, `scripts/`, or
`assets/`. Any pointer it makes to a reference file is a dead link.

**`lottie-animation` contradicts itself** — it steers new work to the dotLottie/WASM runtime, then
recommends `@lottiefiles/lottie-interactivity` for interactivity, which is a lottie-web-era
companion. Pick one runtime and stay in it.

**`page-transition-animation` — the `FrozenRouter` fix imports a private Next.js internal**
(`next/dist/shared/lib/app-router-context.shared-runtime`). That path has already moved once and
will break on a minor upgrade. Prefer the View Transitions API where you can.

**`micro-interaction` — `motion/react` is a subpath of the separate `motion` package**, not
something an installed `framer-motion@11` exposes. Also `@starting-style` / `allow-discrete` is
Baseline *including* Firefox 129+, not "Chrome/Edge/Safari".

**`micro-interaction` — its easing/duration/spring block is a coarser duplicate** of
`visual-design-mastery/references/motion-and-animation.md`. Its 3 curves are strict subsets of the
existing 10 (its "entrance" is `--ease-out-expo`; its "overshoot" is `--ease-out-back`). **The
existing reference wins.** Use `micro-interaction` for its component recipes only.

**`60fps-animation` — its completion gate is taste dressed as law.** "No purple Layout or green
Paint band per frame" is pass/fail on a legitimately tunable call: frame 1 always paints, and a
small element animating `background-color` paints and is fine. Keep the recipes; treat the gate as
"profile it and be able to name why any Paint is there."

## Tier-3 rot (not installed — check before pulling)

Verified against live npm on 2026-08-31:

| Skill | Documents | Live | Note |
|---|---|---|---|
| `animejs` | v3 default import | **4.5.0** | v4 is named-exports-only; `import anime from 'animejs'` fails |
| `locomotive-scroll` | v4 API | **5.0.1** | v5 is a Lenis-based rewrite; the whole skill's API is gone |
| `babylonjs-engine` | 7.x | **9.23.0** | two majors stale |
| `scroll-reveal-libraries` | `npm i aos@next` | **2.3.4** | `next` is a 2018 beta; no release in 7 years |
| `motion-framer` | "Motion is the smaller successor to Framer Motion" | both **13.1.1** | inverted — `motion` *wraps* `framer-motion`, same codebase and version |
| `modern-web-design` | lists FID as a Core Web Vital | — | FID was retired March 2024, replaced by INP |

**The advertised "27+ agents" across claudedesignskills are inert.** Its `agents/*.md` files start
with `# Title`, not YAML frontmatter — no `name:`, no `description:` — so Claude Code never
registers them as subagents. Treat them as prose documents.
