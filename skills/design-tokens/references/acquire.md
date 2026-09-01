# Acquire — getting real values out of something

Three paths, in fidelity order. All of them are local: browser pane, filesystem, no account.

---

## Path 1 — measure a live page

The highest-fidelity path available without Figma. You are reading `getComputedStyle` on every
rendered element, so you get what the browser actually painted, after the cascade, after
Tailwind, after the design system's own indirection collapsed.

### Step 0 — the cheap probe: does the site already publish its tokens?

Many real sites define a custom-property layer. If it exists, it is *authored* structure — far
better than anything you can cluster out of computed values. Check first; it takes one call.

```js
// mcp__Claude_Browser__javascript_tool
(() => {
  const out = {}, cs = getComputedStyle(document.documentElement);
  let blocked = 0;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules } catch (e) { blocked++; continue; }   // cross-origin sheet
    for (const r of rules) {
      if (!r.style) continue;
      for (const p of r.style) {
        if (!p.startsWith('--')) continue;
        if (/^--(csstools|tw|radix|chakra|mui|_)/.test(p)) continue;    // build-tool noise
        out[p] = cs.getPropertyValue(p).trim() || r.style.getPropertyValue(p).trim();
      }
    }
  }
  return { found: Object.keys(out).length, blockedSheets: blocked, vars: out };
})()
```

Verified against MDN: returns 153 properties including their real semantic layer
(`--color-background-page: light-dark(#fff,#18191b)`). Two things that snippet handles because
they actually happen:

- **Cross-origin stylesheets throw** on `.cssRules`. The `try` is not defensive padding.
- **Build tools inject junk** — PostCSS emitted 60+ `--csstools-light-dark-toggle-*` properties
  on that page. Filter them or your token set is 40% garbage.
- `light-dark(a, b)` comes back **unresolved** from the root, which is a gift: both themes in one
  read. Split it rather than measuring twice.

If this returns a real semantic layer, you are mostly done — take the names, and use the full
walk below only to fill gaps and confirm what actually renders.

### Step 1 — the full walk

```js
// mcp__Claude_Browser__javascript_tool  — tested; returns a compact ranked summary
(() => {
  const B = { fg:{}, bg:{}, font:{}, type:{}, weight:{}, space:{}, radius:{}, shadow:{}, dur:{}, ease:{} };
  const bump = (b,k,by=1) => { if (k && k!=='none' && k!=='normal') b[k] = (b[k]||0)+by; };
  const px = v => Math.round(parseFloat(v) || 0);
  const TRANSP = c => !c || c==='transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const effBg = el => {                                   // real background, not 'transparent'
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!TRANSP(c)) return c;
    }
    const root = getComputedStyle(document.documentElement).backgroundColor;
    return TRANSP(root) ? 'rgb(255, 255, 255)' : root;
  };
  const pairs = {};
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;            // not rendered
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || +s.opacity === 0) continue;
    const area = Math.round(r.width * r.height);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      bump(B.fg, s.color);
      bump(B.font, s.fontFamily.split(',')[0].replace(/["']/g,''));
      bump(B.type, `${px(s.fontSize)}/${px(s.lineHeight) || 'auto'}`);
      bump(B.weight, s.fontWeight);
      pairs[`${s.color}|${effBg(el)}|${px(s.fontSize)}|${s.fontWeight}`] =
        (pairs[`${s.color}|${effBg(el)}|${px(s.fontSize)}|${s.fontWeight}`] || 0) + 1;
    }
    if (!TRANSP(s.backgroundColor)) bump(B.bg, s.backgroundColor, Math.round(area/1000)+1);
    bump(B.radius, s.borderRadius);
    bump(B.shadow, s.boxShadow);
    for (const p of ['paddingTop','paddingLeft','marginBottom','rowGap','columnGap']) {
      const n = px(s[p]); if (n > 0 && n <= 256) bump(B.space, n);
    }
    bump(B.dur, s.transitionDuration);
    bump(B.ease, s.transitionTimingFunction);
  }
  const top = (b,n=12) => Object.entries(b).sort((a,c) => c[1]-a[1]).slice(0,n);
  return { elements: els.length, pairs: top(pairs, 12),
           ...Object.fromEntries(Object.entries(B).map(([k,v]) => [k, top(v)])) };
})()
```

Design notes, each of which exists because the naive version gets it wrong:

- **Backgrounds are area-weighted** (`area/1000`), foregrounds are count-weighted. A page
  background appears on one element and matters most; a body colour appears on 400 and matters
  most. Weighting both by count makes the page background rank last.
- **Only elements with a direct text node** contribute type and foreground colour. Without this,
  every wrapper `div` inherits and votes, and the counts become meaningless.
- **`effBg` walks ancestors** because `backgroundColor` is `rgba(0,0,0,0)` on most elements —
  including `<body>` on plenty of real sites. Contrast against `transparent` is nonsense.
- **Spacing is capped at 256px** so one hero's 400px margin doesn't enter the scale.
- Returns a **ranked top-N**, not raw data. The raw dump is tens of thousands of tokens and you
  do not need it.

### Step 2 — sweep, because one read is one state

The Browser pane emulates `prefers-color-scheme`, and it syncs to the app theme by default. This
means **you measure whichever theme happens to be active** — a real trap. MDN measured dark on
the first pass with no indication anything was wrong.

```
mcp__Claude_Browser__resize_window { colorScheme: "light" }   → run walk
mcp__Claude_Browser__resize_window { colorScheme: "dark"  }   → run walk
mcp__Claude_Browser__resize_window { preset: "mobile" }       → run walk (type/space differ)
mcp__Claude_Browser__resize_window { preset: "desktop" }      → reset when done
```

Reload after a scheme change if the page gates anything at load time. If the site has its own
theme toggle it may ignore the media query entirely — click the toggle instead and note that
you did.

Two or three routes beats one: a landing page, an app/dashboard route, and a form. Forms are
where the interesting tokens live (borders, focus rings, error states) and landing pages have
almost none of them.

### Step 3 — the states a static walk cannot see

`:hover`, `:focus-visible`, `:disabled`, `:invalid` never appear in a passive walk. Force them:

```js
// read a pseudo-class's declared styles from the stylesheets, without interacting
(() => {
  const want = /:(hover|focus-visible|active|disabled|invalid)\b/;
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      if (r.selectorText && want.test(r.selectorText)) hits.push([r.selectorText, r.style.cssText]);
    }
  }
  return hits.slice(0, 60);
})()
```

Or drive it: `computer { action: "hover", ref }` then re-read that element's computed style.
Slower, but it gives you the value the browser actually resolves rather than a declaration.

### Fallbacks

If the Browser pane is unavailable, `mcp__playwright__browser_evaluate` and
`mcp__claude-in-chrome__javascript_tool` run the identical snippets. Nothing above is
pane-specific except `resize_window`.

### What the walk misses

Closed shadow DOM (`querySelectorAll` does not cross it — recurse `el.shadowRoot` where open),
canvas/WebGL-rendered UI, cross-origin iframes, anything behind auth, anything below a route you
did not visit, and `::before`/`::after` content (pass a second argument to `getComputedStyle`
if pseudo-element colour matters).

---

## Path 2 — parse a token file

Formats you will meet, and what to do with each.

**W3C DTCG (`tokens.json`)** — the target format. Groups are nested objects; a token is any
object with `$value`. `$type` is inherited from the nearest ancestor that declares it. Aliases
are `"{group.token}"` strings and must be resolved before contrast checking.

```json
{ "color": { "$type": "color",
    "brand": { "primary": { "$value": "#533afd" } },
    "text":  { "link":    { "$value": "{color.brand.primary}" } } } }
```

Resolve aliases depth-first with a visited set — circular references exist in real exports and
will hang a naive resolver.

**Figma variables export** — a `variables`/`collections` shape with `modes`. Each mode is a
theme (Light/Dark/Brand-B). Values are `{r,g,b,a}` floats in **0–1, not 0–255**; multiply by 255
before anything else. `VARIABLE_ALIAS` entries point at another variable's id, not its name.
Keep the collection name as your token group and each mode as a theme block.

**Style Dictionary** — pre-DTCG: `value` not `$value`, `type` not `$type`. Same tree shape.
Rename on the way in.

**Tailwind config** — `theme.extend.colors` etc. Flat-ish and already scale-shaped. The catch is
that the config lists what is *available*, not what is *used*; a Tailwind config is a superset,
often by 10×. Cross-reference with a measurement pass or you will emit 200 unused tokens.

Common to all four: **exports contain far more primitives than the design uses.** Filter to what
appears in a semantic role or in your measurement, and drop the rest. Note what you dropped.

---

## Path 3 — sample an image

Lowest fidelity. Legitimate when it is all that exists — a mockup, a photo of a whiteboard, a
brand PDF page. Be explicit that this produces approximations.

1. **Read the image** with the Read tool and describe what you see: the surfaces, the text
   colours, the one accent, the radii, the apparent type pairing. Vision is good at *relative*
   judgements ("this is a warm off-white, not white") and unreliable at absolute hex.
2. **Zoom for anything that matters** — `computer { action: "zoom", region }` if it is on screen.
   Small swatches read wrong at page scale.
3. **Sample flat regions only.** A gradient, a shadowed edge, or anti-aliased text gives you a
   blend of two colours that exists nowhere in the design. Pick the middle of a large flat area.
4. **Never sample text colour from the glyphs.** Sub-pixel anti-aliasing means the pixels are
   mostly a blend with the background. Read the darkest core pixel and round toward it, or infer
   from the family (near-black text on white is almost always a tinted near-black, not `#000`).
5. **Convert and then round to a system.** Sampled values are noisy — snap them onto an even
   OKLCH lightness ramp rather than shipping the noise as if it were measured.

Output header must say so:

```css
/* Palette derived from a screenshot. Values are APPROXIMATE — sampled, not measured.
   Source: hero-mockup.png. Verify against the real artefact before shipping. */
```

If a URL for the same product exists, stop and use Path 1 instead. Sampling a screenshot of a
site you could have measured is a self-inflicted wound.

---

## After acquiring

Go to [`emit.md`](emit.md): cluster, convert to OKLCH, build the scales, run the contrast gate,
write the two output files.
