# Normalise, verify, emit

Input: a ranked measurement (or a parsed token file). Output: a CSS custom-property block and a
DTCG `tokens.json`, with a contrast report you can point at.

---

## Clustering

Measurement gives noise. Tokenisation is reduction. The job here is to throw most of it away.

**Colours.** Convert everything to OKLCH first, then merge any two colours whose ΔL < 0.02 *and*
ΔC < 0.01 *and* ΔH < 4° — that difference is below the threshold of noticing on screen and is
almost always two people typing slightly different hex for the same intent. Keep the
higher-weighted member. Then bucket what remains:

- **Neutrals**: C < 0.03. These become the ramp.
- **Accents**: C ≥ 0.03. Group by hue within ±20°. Most real systems have one or two hue
  families plus a status set (red/amber/green). If you end up with six unrelated accent hues,
  you are looking at ads, third-party embeds, or a marketing page — re-measure a real app route.

**Spacing.** Find the base: the greatest common divisor of the values that appear ≥3 times,
clamped to 2/4/8. Snap everything to multiples of it and drop values that appear once.

**Radii, shadows, durations.** Keep 3–4 radii, 3 shadow tiers, 2–3 durations. If you measured
one radius on everything, that is information — the source has no radius hierarchy. Do not
invent one silently, but do flag it as a place to improve.

**Weight beats count for backgrounds** (area-weighted), count wins for text. Already handled by
the acquisition snippet.

### Worked example — real measured output

From the MDN CSS reference page, dark theme, 4914 elements:

```
type:   16/28 (82)  16/24 (30)  32/40 (6)  16/32 (4)  20/30 (3)  32/48 (1)
space:  16(12) 4(11) 8(8) 2(7) 12(4) 13(4) 24(3) 32(3) 40(3) 3(2) 11(2)
radius: 0px (207)  4px (6)
weight: 400 (121)  700 (3)  600 (2)
```

What a careful reader takes from that:

- Base body size **16px**, line-height **28px** (1.75) for prose and **24px** (1.5) for UI. Two
  line-heights by role, not one — that is a real design decision worth keeping.
- Distinct sizes are 16, 20, 32. Ratios 1.25 then 1.6. **That is not a modular scale.** Honest
  move: adopt 1.25 and emit 16 / 20 / 25 / 31, noting you rounded 32→31 (or kept 32 and stated
  the scale is 1.25 with one deliberate break). Do not label the measured set "1.25" and move on.
- Spacing base is **4** (13 and 11 are single-use noise; 2 and 3 are hairlines, not spacing).
- **radius 0 on 207 of 213 elements** — this system is deliberately square. Copying it and then
  adding `rounded-2xl` everywhere throws away the one distinctive thing you measured.
- Two font families only, one weight doing 96% of the work. Sparse by design.

---

## OKLCH conversion

Verified: `#ff0000` → `oklch(0.6280 0.2577 29.2)`, `#ffffff` → `L 1.0`, `#767676` on white →
`4.54:1` (the known WCAG AA boundary grey).

```js
const srgbToLin = c => c <= 0.04045 ? c/12.92 : Math.pow((c + 0.055)/1.055, 2.4);
const linToSrgb = c => c <= 0.0031308 ? c*12.92 : 1.055*Math.pow(c, 1/2.4) - 0.055;

function rgbToOklch([r, g, b]) {                       // r,g,b in 0..255
  const R = srgbToLin(r/255), G = srgbToLin(g/255), B = srgbToLin(b/255);
  const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B);
  const m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B);
  const s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
  const L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
  const A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
  const Bb = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
  const C = Math.hypot(A, Bb);
  let H = Math.atan2(Bb, A) * 180/Math.PI; if (H < 0) H += 360;
  return [L, C, C < 1e-4 ? 0 : H];                     // hue is meaningless at zero chroma
}

function oklchToRgb([L, C, H]) {
  const h = H * Math.PI/180, A = C*Math.cos(h), Bb = C*Math.sin(h);
  const l = (L + 0.3963377774*A + 0.2158037573*Bb)**3;
  const m = (L - 0.1055613458*A - 0.0638541728*Bb)**3;
  const s = (L - 0.0894841775*A - 1.2914855480*Bb)**3;
  const R = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const G = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const B = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  return [R, G, B].map(v => Math.round(Math.min(1, Math.max(0, linToSrgb(v))) * 255));
}

// sRGB gamut check — OKLCH is wider than sRGB and will clip silently otherwise
const inGamut = ([L,C,H]) => {
  const h = H*Math.PI/180, A = C*Math.cos(h), Bb = C*Math.sin(h);
  const l=(L+0.3963377774*A+0.2158037573*Bb)**3, m=(L-0.1055613458*A-0.0638541728*Bb)**3,
        s=(L-0.0894841775*A-1.2914855480*Bb)**3;
  return [ 4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s]
         .every(v => v >= -1e-4 && v <= 1 + 1e-4);
};
```

Parsing what the browser hands you: computed colours arrive as `rgb(r, g, b)` or
`rgba(r, g, b, a)`. `c.match(/[\d.]+/g).map(Number)` covers both; keep the alpha separately —
translucent borders (`oklch(1 0 0 / 0.10)`) are a legitimate token and must not be flattened.

---

## Building the ramp

Take the dominant neutral hue from your clustered neutrals (the chroma-weighted mean hue, not
the mean of all of them — near-grey colours have unstable hue). Then generate stops at even
lightness, holding H fixed and letting C ride a small curve.

```js
// L stops: even in OKLCH means even to the eye. Chroma peaks mid-ramp.
const STOPS = [50,100,200,300,400,500,600,700,800,900,950];
const L_AT  = [0.985,0.960,0.920,0.870,0.760,0.640,0.540,0.440,0.330,0.240,0.160];
const ramp = (hue, cMax = 0.022) => STOPS.map((s, i) => {
  const t = 1 - Math.abs((i/(STOPS.length-1)) - 0.5)*2;      // 0 at ends, 1 mid
  return [`--n-${s}`, [L_AT[i], +(cMax*(0.3 + 0.7*t)).toFixed(4), hue]];
});
```

`L_AT` and `cMax` are **numbers to tune, not requirements** — they set the order of magnitude.
Look at the ramp rendered as swatches and adjust. `cMax` around 0.02 is a barely-there tint;
0.04 is visibly coloured; 0 is the hueless slop `web-and-css.md` names.

For accents, keep the measured `H` exactly (it is the brand), keep `C` if it is in gamut, and
generate hover/pressed by moving `L` only:

```css
--accent:        oklch(0.68 0.17 30);
--accent-hover:  oklch(from var(--accent) calc(l - 0.06) c h);
--accent-wash:   color-mix(in oklch, var(--accent) 12%, var(--surface));
```

Deriving beats hand-picking: change the source hue once and every state follows.

---

## Type scale

Find the base from the measurement: the size with the highest text-node count (16px on almost
every site). Then decide, honestly:

- The measured sizes fit a ratio within ~3% → adopt it, emit the clean scale, note the rounding.
- They do not (the usual case) → either impose a ratio and state that you are *redesigning* the
  scale to cover the measured range, or emit the measured set and say plainly that the source
  has no scale. Both are fine. Pretending is not.

```css
/* 1.25 from a 16px base, fluid. State the ratio in the comment — it is the design. */
--step--1: clamp(0.80rem, 0.77rem + 0.15vw, 0.875rem);
--step-0:  clamp(1.00rem, 0.95rem + 0.25vw, 1.125rem);
--step-1:  clamp(1.25rem, 1.16rem + 0.45vw, 1.44rem);
--step-2:  clamp(1.56rem, 1.40rem + 0.80vw, 1.95rem);
--step-3:  clamp(1.95rem, 1.68rem + 1.35vw, 2.62rem);
```

Carry line-height as a **role**, not a single number, if the measurement showed two (MDN: 1.75
prose / 1.5 UI). That distinction is worth more than a fourth type size.

---

## Spacing, radii, shadows

```css
--space-1: 0.25rem;  --space-2: 0.5rem;  --space-3: 0.75rem;  --space-4: 1rem;
--space-6: 1.5rem;   --space-8: 2rem;    --space-12: 3rem;    --space-16: 4rem;

--radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 14px;  --radius-full: 999px;
```

Radius is a hierarchy signal — if you measured variation, keep it. If you measured `0` on
everything (MDN did), emit `--radius-sm: 0` and let the squareness be the system.

Shadows: never pure black, never one layer. Tint with the neutral hue and stack 2–3 so the
falloff reads as light rather than as blur.

```css
--shadow-1: 0 1px 2px oklch(0.24 0.022 260 / .06);
--shadow-2: 0 1px 2px oklch(0.24 0.022 260 / .05),
            0 4px 8px oklch(0.24 0.022 260 / .06);
--shadow-3: 0 1px 2px oklch(0.24 0.022 260 / .05),
            0 4px 8px oklch(0.24 0.022 260 / .06),
            0 12px 24px oklch(0.24 0.022 260 / .08);
```

---

## Contrast verification

**The gate. Run it before emitting.** Input is the measured `pairs` array — real foreground,
real effective background, real size and weight.

```js
const relLum = ([r,g,b]) =>
  0.2126*srgbToLin(r/255) + 0.7152*srgbToLin(g/255) + 0.0722*srgbToLin(b/255);
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x,y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// WCAG 1.4.3: large = >=24px, or >=18.66px at weight >=700
const check = (fg, bg, px, weight) => {
  const large = px >= 24 || (px >= 18.66 && +weight >= 700);
  const r = contrast(fg, bg);
  return { ratio: +r.toFixed(2),
           AA:  r >= (large ? 3 : 4.5),
           AAA: r >= (large ? 4.5 : 7),
           large };
};
```

Also check, because they are constraints too and get forgotten:

- Focus ring vs both the surface it sits on **and** the component it outlines — 3:1 each.
- Input borders, toggle tracks, chart series against their plot background — 3:1 (WCAG 1.4.11).
- Every pair **in both themes.** A ratio that passes in light routinely fails in dark; the
  lightness relationship inverts, the chroma does not.

### Fixing a failure

Move `L` and leave `C`/`H` alone, so the hue identity survives:

```js
function fixL(fgOklch, bgRgb, target = 4.5) {
  const dark = relLum(oklchToRgb(fgOklch)) < relLum(bgRgb);
  let [L, C, H] = fgOklch;
  for (let i = 0; i < 60; i++) {
    if (contrast(oklchToRgb([L,C,H]), bgRgb) >= target) return [+L.toFixed(4), C, H];
    L += dark ? -0.01 : 0.01;
    if (L < 0 || L > 1) break;
  }
  return null;   // unreachable at this chroma — reduce C, or change the background
}
```

`fixL` measures contrast on the **sRGB-clipped** rendering, so its result can be out of gamut
even when it "passes" — `[0.51, 0.2, 190]` clips to `rgb(0,133,127)` and the ratio you verified
belongs to the clipped colour, not the token. Always run `inGamut` on the result and reduce `C`
until it is in gamut, then re-check.

If `fixL` returns `null`, the honest answer is that the accent cannot carry text at that
chroma on that surface. Use it as a **fill** with a darkened variant for text — a saturated
brand colour that fails as body text on white is normal, not a defect in the brand.

Report the deviations. "Muted text darkened from L 0.68 → 0.61 to reach 4.5:1 on `--surface`"
is a line the user needs to see; a silently corrected token is a silently broken match.

---

## Output — both files, always

### `tokens.css`

```css
/* Extracted from https://example.com — measured 2026-09-01, light + dark, desktop + 390px.
   Method: computed-style walk (getComputedStyle over 4914 rendered elements).
   Deviations from source: --text-muted darkened to reach WCAG AA (source ships 3.1:1). */
:root {
  /* primitives */
  --n-50:  oklch(0.985 0.004 262);
  --n-500: oklch(0.640 0.018 262);
  --n-950: oklch(0.160 0.022 262);
  --brand: oklch(0.521 0.268 277);

  /* semantic — components reference these, never the primitives */
  --surface:        var(--n-50);
  --surface-raised: oklch(1 0 0);
  --text:           var(--n-950);
  --text-muted:     var(--n-600);
  --border:         var(--n-300);
  --accent:         var(--brand);
}
:root[data-theme="dark"] { --surface: var(--n-950); --text: var(--n-100);
                           --border: oklch(1 0 0 / 0.10); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --surface: var(--n-950); --text: var(--n-100);
                                    --border: oklch(1 0 0 / 0.10); }
}
```

The two-layer split (primitive → semantic) and the both-directions dark-mode blocks are the
pattern `web-and-css.md` mandates; do not re-derive them differently here.

### `tokens.json` (W3C DTCG)

```json
{
  "$description": "Measured from https://example.com on 2026-09-01 via computed-style walk.",
  "color": {
    "$type": "color",
    "neutral": { "500": { "$value": "oklch(0.64 0.018 262)" } },
    "brand":   { "base": { "$value": "oklch(0.521 0.268 277)" } },
    "semantic": {
      "surface": { "$value": "{color.neutral.50}" },
      "text":    { "$value": "{color.neutral.950}",
                   "$extensions": { "contrast": { "on": "surface", "ratio": 17.2, "wcag": "AAA" } } }
    }
  },
  "dimension": {
    "$type": "dimension",
    "space": { "4": { "$value": "1rem" } },
    "radius": { "sm": { "$value": "4px" } }
  },
  "typography": {
    "$type": "typography",
    "body": { "$value": { "fontFamily": "Inter", "fontSize": "1rem",
                          "fontWeight": 400, "lineHeight": 1.75 } }
  }
}
```

Put the contrast results in `$extensions` rather than a separate report file — they travel with
the token and the next person does not have to re-derive them.

### The report

Alongside the files, say in prose: which URL/routes/themes/viewports were measured, the method
and therefore the fidelity, how many raw values collapsed into how many tokens, every contrast
deviation, and what could not be recovered (motion, states, intent). One paragraph. Without it,
the token file makes claims it cannot support.
