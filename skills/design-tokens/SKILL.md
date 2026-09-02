---
name: design-tokens
description: "Extract a site's actual tokens — colour, type, spacing — without Figma. Use when the user says \"pull the design system off this site\", \"extract tokens from this URL\", \"match the look of <site>\", \"I don't have Figma access\", \"turn this screenshot into a palette\", \"convert this tokens.json into CSS variables\", \"build an OKLCH ramp from these brand colours\", \"give me a spacing and type scale for this\", \"emit design tokens as custom properties\", or \"check this palette against WCAG contrast\". Covers measuring a live page with the Browser pane, parsing W3C DTCG / Figma-export JSON, and sampling an image — then normalising to OKLCH, deriving ramps and scales, verifying contrast, and emitting CSS custom properties plus tokens.json. Not for general styling decisions — visual-design-mastery owns those."
---

# Design tokens without Figma

This is the acquisition-and-emission layer: turn *something that already looks like a design*
into a token set you can build against, using nothing but the browser pane and the filesystem.
No Figma account, no API key, no MCP connector.

**It sits under `visual-design-mastery`.** That skill decides whether the resulting system is
any good — whether the neutrals have a hue, whether the accent is a decision or a default,
whether the type pairing has a point of view. This skill only makes sure the numbers you feed
it are *measured* rather than *invented*, and that they survive a contrast check.

Extraction is not design. A token file lifted off a site you admire is a starting position,
not a finished system. If the answer is "we now look exactly like Linear", you extracted
successfully and designed nothing.

## Pick the path

| You have | Path | Fidelity |
|---|---|---|
| A live URL | **Measure it** — [`references/acquire.md`](references/acquire.md#path-1--measure-a-live-page) | Real computed values. Highest. Use this whenever a URL exists. |
| A `tokens.json`, Figma variables export, Style Dictionary or Tailwind config | **Parse it** — [`references/acquire.md`](references/acquire.md#path-2--parse-a-token-file) | Authored intent, exact. But often incomplete and full of unused primitives. |
| Only a screenshot, mockup, or photo | **Sample it** — [`references/acquire.md`](references/acquire.md#path-3--sample-an-image) | **Approximate.** Say so out loud, every time. |
| Nothing but a description | You are designing, not extracting. Go to `visual-design-mastery`. | — |

When you have both a URL and a token file, read the token file for *names and structure* and
measure the page for *values*. The names tell you what the team calls things; the page tells
you what actually ships.

## The pipeline

```
acquire → cluster → normalise to OKLCH → build scales → VERIFY CONTRAST → emit
```

1. **Acquire.** [`references/acquire.md`](references/acquire.md). One pass is never enough on a
   live page: sweep light and dark, and at least one narrow viewport.
2. **Cluster.** Raw measurement gives you 60 colours and 30 spacing values, most of them noise
   (a 13px padding that appears twice is not a token). Frequency- and area-weight them, then
   collapse near-duplicates. Rules in [`references/emit.md`](references/emit.md#clustering).
3. **Normalise.** Everything becomes OKLCH. Not a style preference — see below.
4. **Build scales.** A ramp with even lightness steps, a type scale with a stated ratio, a
   spacing scale on one base unit, 3–4 radii, 3 shadow tiers.
5. **Verify contrast.** The gate. Nothing ships that fails it.
6. **Emit.** CSS custom properties *and* `tokens.json` (W3C DTCG). Both, always — the CSS is
   what you build with, the JSON is what survives to the next tool.

## Three kinds of claim — do not confuse them

Same taxonomy as `visual-design-mastery` principle 9, applied here:

**CONSTRAINTS — non-negotiable, verify them:**
- WCAG 1.4.3 contrast: body text **≥ 4.5:1**, large text (≥24px, or ≥18.66px at weight ≥700)
  **≥ 3:1**, against its *actual* rendered background. AAA is 7:1 / 4.5:1.
- WCAG 1.4.11: UI component boundaries and meaningful graphics **≥ 3:1**. Focus rings and input
  borders are in scope; a decorative hairline is not.
- OKLCH is perceptually uniform; HSL is not. Equal `L` steps in OKLCH *look* equal across hues;
  equal `L` steps in HSL do not — HSL yellow at L=50% is far brighter than HSL blue at L=50%.
  This is a colour-space fact, not taste. It is why the ramp is built in OKLCH.
- OKLCH's gamut is wider than sRGB. `oklch(0.7 0.3 145)` has no sRGB representation and will
  be clipped. Check before you ship a high-chroma value.
- Extracted hex is sRGB, 8-bit. Round-tripping it through OKLCH and back is lossy by ±1/255.
  Irrelevant for design, relevant if you are diffing against the source.

**STRONG DEFAULTS — right most of the time, stated with the reason:**
- Neutrals carry a small hue bias (chroma ~0.004–0.022 at one consistent hue) rather than being
  pure grey, because pure grey reads as unexamined and every real design system leans warm or
  cool. Deviate when the brand genuinely demands neutrality — and say why.
- Emit semantic tokens (`--surface`, `--text-muted`, `--border`) layered over primitives
  (`--n-500`), because dark mode then becomes one override block instead of a component rewrite.
- Derive hover/pressed/tint states with `color-mix()` or relative colour syntax rather than
  hand-picking them, so the palette stays internally coherent when the source changes.
- Prefer the source's own semantic names when parsing a token file; renaming them costs the
  team its vocabulary for no gain.

**NUMBERS — starting points, tune by looking at the result:**
- 9 lightness stops (50/100/200…900/950) is a common ramp size; 7 is plenty for most apps and
  15 is a component library. Count the distinct surfaces you actually need and pick.
- Type ratio 1.2 (dense UI), 1.25 (general UI), 1.333 (editorial). If the measured sizes fit
  none of these — and on real sites they usually don't — see the fitting note in
  [`references/emit.md`](references/emit.md#type-scale).
- 4px spacing base is the common one; 8px for spacious marketing, 2px if you measured a dense
  tool. Take it from what you measured, not from habit.
- Chroma usually peaks in the middle of a lightness ramp and falls off at both ends. How far it
  falls is a look, not a rule.

## The contrast gate

Run this before emitting anything, and run it on the **measured foreground/background pairs**,
not on colours in isolation. Isolated colours have no contrast; pairs do. The extraction snippet
in `acquire.md` already collects real pairs with their font size and weight, so the check is
against text that genuinely renders that way.

Script: [`references/emit.md`](references/emit.md#contrast-verification). Report every pair with
its ratio and its verdict.

Two honest notes:

- **Source-site failures are the source's bug — do not inherit them.** Real sites fail contrast
  constantly, especially on muted text and placeholder colours. When a measured pair fails, fix
  it in your emitted token (darken/lighten `L` until it passes, keeping `C` and `H`) and record
  that you deviated. Silently shipping a 3.1:1 body text because "that's what they use" is the
  single worst outcome of this skill.
- **A passing ratio is not a passing design.** 4.5:1 is a floor for legibility, not a target for
  hierarchy. Muted text at exactly 4.5:1 next to body text at 4.6:1 is compliant and unreadable
  as hierarchy.

## Worked examples already on disk

23 real design systems, measured — not described — live under the Tier-3 library:

Find them by searching the library index rather than by a fixed path — the library lives
wherever this config was installed, which differs per machine:

```bash
grep -i "designlang" <your library index>       # e.g. library/INDEX.md
```

Each hit's sibling `<site>-design-tokens.json` holds the real numbers; the `SKILL.md` beside it
is only a short summary. Read the JSON for structure, **not** for palette values — several of
those files use literal `#000000` / `#ffffff` neutral ramps, which is exactly the hueless
default this skill exists to avoid.

`<site>` is hyphenated: `cal-com  clerk-com  coinbase-com  duolingo-com  framer-com
loom-com  mintlify-com  netflix-com  perplexity-ai  planetscale-com  posthog-com  postman-com
railway-app  ramp-com  raycast-com  render-com  replit-com  resend-com  retool-com  sentry-io
supabase-com  v0-dev  webflow-com`.

Read these for the *shape* of a finished extraction. Two caveats, both load-bearing:

- Each `designlang/SKILL.md` is a ~26-line summary. The actual data is the sibling file
  `gallery/<site>/<site>-design-tokens.json` — full DTCG, with `primitive.*` and `semantic.*`
  layers. That is the file to imitate. `<site>-intent.json`, `-motion-tokens.json` and
  `-form-states.json` are there too, and the gallery has 38 site directories even though only
  23 are indexed here.
- **They are sRGB hex, not OKLCH.** Useful as structure, not as output. Convert before use, and
  expect their neutral ramps to contain literal `#000000` / `#ffffff` / dead greys — exactly the
  thing `web-and-css.md` names as slop. Do not copy that part.

## What this cannot recover — say so, don't paper over it

Measurement gives you the surface. It does not give you:

- **Intent.** Why the accent is that hue, which colour is "the brand" versus a one-off, what the
  system forbids. A `--color-brand-secondary` in an export may be a real role or a leftover.
- **Motion.** `transitionDuration` on a static page is whatever is idle — usually `0s`, as it was
  on every page tested. Hover/scroll/enter motion, spring physics, and orchestration are
  invisible to a computed-style walk. Go watch the page, or go to `motion-and-animation.md`.
- **Component logic.** States you cannot reach without interacting (`:disabled`, error, loading,
  empty), responsive breakpoints you did not sweep, and anything inside closed shadow DOM.
- **Which values are load-bearing.** Frequency tells you what is common, not what matters. A
  colour used once on the primary CTA outranks a grey used 400 times.
- **Anything below the fold you never scrolled to,** or behind auth, or in a route you did not
  visit. Extraction covers the pages you measured. Say which ones.

Screenshot sampling additionally cannot recover: exact values (JPEG artefacts and display
profiles shift hue), anything anti-aliased, text colour distinct from its halo, or any value not
visually present. Sampled palettes are approximations. Label them as such in the output header.

## Slop to recoil from

- **The 40-token dump.** Every computed value promoted to a token, including the 13px padding
  and the seven near-identical greys. A token set is a *reduction*. If it is not smaller than
  what you measured, you skipped the clustering step.
- **Hueless neutrals.** `#888`, `oklch(0.6 0 0)`, a ramp with `C: 0` at every stop. Named as slop
  in `web-and-css.md`; extracting them from a source that also has them is not an excuse.
- **Hex output.** Emitting `#533afd` when the whole point was perceptual uniformity. Convert.
- **Fake scales.** Labelling `12 14 16 20 24 32` a "1.25 modular scale" when the actual ratios
  are 1.167, 1.143, 1.25, 1.2, 1.333. Either fit a real ratio and state the rounding, or admit
  it is a measured set with no ratio. Do not lie in a comment.
- **Contrast checked on the palette instead of on pairs**, or checked on the light theme only
  and assumed to hold in dark. It does not.
- **Copying the source's mistakes with a straight face** — its failed contrast, its five shades
  of the same blue, its one `box-shadow` on everything.
- **`--color-primary-500` with no semantic layer.** Primitives alone force every component to
  know the palette, and dark mode becomes a rewrite.
- **Claiming measurement when you guessed.** A screenshot-derived palette presented in the same
  voice as a computed-style walk. Fidelity is part of the output.
- **Extracting a whole system for one component.** If the task was "make this button match",
  measure the button. The pipeline is not mandatory ceremony.
