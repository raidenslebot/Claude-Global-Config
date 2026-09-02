# Shaders & GPU Visuals

A shader is a tiny function that runs once per pixel, in parallel, millions of times a frame — and that constraint is the whole art. You are not drawing shapes into a buffer; you are answering one question, "given this coordinate and this time, what color?", with pure math. Master that mindset and you unlock the effects nothing else can touch: infinite generative backgrounds that never repeat, volumetric clouds and fire raymarched out of thin air, dissolves and hit-flashes that give a game *juice*, chromatic aberration and bloom that make a UI feel cinematic. This is the highest ceiling in visual craft. Everything below is real, current, and copy-pasteable — no pseudo-code. When you want to verify or go deeper, the three temples are **ShaderToy** (shadertoy.com), **The Book of Shaders** (thebookofshaders.com), and **Inigo Quilez** (iquilezles.org). Reference general easing curves from the sibling `motion-and-animation.md`; here the motion comes from `sin`, `fract`, and noise.

## The fragment-shader mindset

You get a coordinate, you return a color. No loops over pixels, no state between them. Think in **fields**: every pixel evaluates the same continuous function of position.

**UV space is your canvas.** Normalize pixel coordinates to `0..1`, but for anything geometric, use the *aspect-corrected centered* idiom — this is the single most important line in the toolkit:

```glsl
// origin at center, y in [-1,1], x scaled by aspect ratio. Circles stay round.
vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
```

Never reach for `if/else` to branch pixels when a `smoothstep` or `mix` will do — GPUs hate divergent branches, and the math reads cleaner anyway. Opinion: 90% of "how do I draw X" questions are really "what function is zero on X", i.e. an SDF.

## The classic toolkit — memorize these six

| Function | What it does | Use it for |
|---|---|---|
| `mix(a,b,t)` | linear blend | every crossfade, every gradient |
| `smoothstep(e0,e1,x)` | Hermite ramp `0→1` | **anti-aliased edges**, soft masks |
| `clamp(x,0.,1.)` / `saturate` | fence a value | keep colors legal |
| `fract(x)` | wrap to `[0,1)` | tiling, stripes, pseudo-random |
| `length(p)` / `dot(p,p)` | distance | radial fields, circles |
| `step(edge,x)` | hard `0/1` | masks (aliased — prefer smoothstep) |

**Anti-aliasing an edge** is just smoothstep against the pixel derivative:

```glsl
float d = length(uv) - 0.5;              // SDF of a circle
float aa = fwidth(d);                    // ~1px in field units
float mask = smoothstep(aa, -aa, d);     // crisp at any zoom
```

**Inigo Quilez's cosine palette** — the fastest route to gorgeous color. One line replaces a gradient editor. `a` = mid, `b` = amplitude, `c` = frequency, `d` = phase:

```glsl
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318530718 * (c * t + d));
}
// Classic rainbow-ish default; tweak d per channel for signature looks:
vec3 col = palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.33, 0.67));
```

Sample values live at iquilezles.org/articles/palettes. Change `d` to `vec3(0.0,0.1,0.2)` for warm sunsets, `vec3(0.3,0.2,0.2)` for teal-and-orange. This is your go-to for generative art color.

## Signed distance fields — crisp shapes at any resolution

An SDF returns the signed distance to a surface: negative inside, zero on the edge, positive outside. Because it's continuous, you get free anti-aliasing, outlines, glow, and smooth boolean blends. IQ's 2D SDF gallery (iquilezles.org/articles/distfunctions2d) is the canonical list.

```glsl
float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {                    // b = half-extents
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Smooth union — the magic that makes metaballs and organic blobs. k = blend radius.
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
```

Outline + fill + glow from a single distance, for free:

```glsl
float d = sdBox(uv, vec2(0.3, 0.2));
vec3 col = mix(vec3(0.9), bg, smoothstep(0.0, fwidth(d), d));   // fill
col += vec3(0.2,0.6,1.0) * 0.02 / max(abs(d), 1e-3);           // neon glow (1/d falloff)
```

## Noise & fbm — the engine of everything organic

Constant colors are dead; nature is noisy. Value noise interpolates a hash grid; stacking octaves (fbm) gives clouds, terrain, smoke, marble. For production use a texture-based or GPU simplex (`snoise`) for speed and no directional artifacts, but this hash-value noise is the teaching classic and runs anywhere:

```glsl
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);            // smoothstep (cubic Hermite); Perlin's smootherstep is 6f^5-15f^4+10f^3
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

float fbm(vec2 p) {                              // fractal Brownian motion
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(1.6, 1.2, -1.2, 1.6);        // rotate+scale each octave, kills axis bias
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = rot * p; a *= 0.5; }
    return v;
}
```

**Domain warping** — feed fbm into itself — is IQ's trick for that liquid, marbled, "how is this even possible" look (iquilezles.org/articles/warp):

```glsl
vec2 q = vec2(fbm(uv), fbm(uv + vec2(5.2, 1.3)));
float f = fbm(uv + 4.0 * q + iTime * 0.1);       // animate by drifting the sample point
```

## What shaders unlock that nothing else can

- **Raymarched / volumetric scenes** — 3D from a single quad, no meshes (below).
- **Generative backgrounds** — infinite, non-repeating, ~30 lines, zero assets.
- **Dissolves** — threshold a noise texture against a `t` uniform, `discard` below it, tint the burning edge.
- **Glow / bloom** — bright-pass + blur + add (post section).
- **Chromatic aberration & lens distortion** — sample R/G/B at offset UVs.
- **Water, fire, energy shields** — scrolling fbm + Fresnel + additive blending.
- **Post-processing** — the entire cinematic grade lives in one fullscreen pass.

**Raymarching**, distilled: march a ray through an SDF scene, step by the distance you're allowed to move (sphere tracing). This 3D sphere fits in a fragment shader:

```glsl
float map(vec3 p) { return length(p) - 1.0; }    // SDF of the whole scene

float raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);
        if (d < 0.001 || t > 20.0) break;        // hit, or escaped
        t += d;                                  // safe to step this far
    }
    return t;
}

vec3 calcNormal(vec3 p) {                        // gradient of the field = surface normal
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                          map(p + e.yxy) - map(p - e.yxy),
                          map(p + e.yyx) - map(p - e.yyx)));
}
```

Swap `map` for `smin` of several primitives, add `map += 0.1*fbm(p)` for surface detail, and you have clouds, terrain, or melting metal.

## The web path — real current APIs

**ShaderToy conventions** (learn them; the whole community speaks this): entry point is `mainImage`, not `main`. Uniforms are provided for you: `iResolution` (viewport px), `iTime` (seconds), `iTimeDelta`, `iFrame`, `iMouse` (xy = pos, zw = click), `iChannel0..3` (input textures/buffers).

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
    vec3 col = palette(length(uv) - iTime * 0.2, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67));
    fragColor = vec4(col, 1.0);
}
```

**Three.js / react-three-fiber** is the production path for the web. Wire a fullscreen effect with a plane and a `ShaderMaterial`; drive `uTime` from the render loop. In r3f, drei's `shaderMaterial` + `extend` is the idiom — update uniforms through a **ref inside `useFrame`**, never through React state (state re-renders; refs don't):

```jsx
import * as THREE from 'three'
import { shaderMaterial } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { useRef } from 'react'

const WaveMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(0.2, 0.4, 1.0) },   // uniforms become auto-typed props
  /* glsl */ `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  /* glsl */ `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
    void main() { gl_FragColor = vec4(uColor * (0.5 + 0.5 * sin(uTime + vUv.x * 10.0)), 1.0); }`
)
extend({ WaveMaterial })

function Backdrop() {
  const ref = useRef()
  useFrame((_, dt) => { ref.current.uTime += dt })       // per-frame, no re-render
  return <mesh><planeGeometry args={[2, 2]} /><waveMaterial ref={ref} /></mesh>
}
```

For post-processing on the web, use `@react-three/postprocessing` (the `EffectComposer` with `Bloom`, `ChromaticAberration`, `Vignette`, `Noise` effects) rather than hand-rolling passes. Note WebGL2 GLSL is `#version 300 es` (`in/out`, `texture()` not `texture2D()`); Three.js prepends this for you.

**Raw WebGL2 / WebGPU.** Reach for raw WebGL2 only when you want zero dependencies: compile vertex+fragment, draw a single full-screen triangle (bigger than the screen — cheaper than a quad, no diagonal seam), set uniforms via `gl.uniform*`. **WebGPU** (Chrome/Edge since 113, broad in 2025–26) is the modern target: shaders are **WGSL**, work is a render or compute pipeline, uniforms travel in bind groups. A minimal WGSL fragment stage:

```wgsl
struct U { res: vec2f, time: f32 };
@group(0) @binding(0) var<uniform> u: U;

@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let uv = fragCoord.xy / u.res;
    return vec4f(uv, 0.5 + 0.5 * sin(u.time), 1.0);
}
```

WGSL gives you compute shaders — particles, simulation, GPU sorting — that WebGL never could. Opinion: start on WebGPU for anything new and heavy; keep a WebGL2 fallback for Safari before 26, for Firefox on the platforms and versions where WebGPU is still partial, and for older Android GPUs — check `navigator.gpu` at runtime rather than assuming.

## The game path — HLSL & engine shading languages

**MonoGame (HLSL `.fx`).** `SpriteBatch` binds your texture to sampler `s0` and passes vertex color in `COLOR0`, UV in `TEXCOORD0`. Compile through the Content Pipeline with the cross-platform shader-model macro, then `spriteBatch.Begin(effect: fx)`:

```hlsl
#if OPENGL
    #define PS_SHADERMODEL ps_3_0
#else
    #define PS_SHADERMODEL ps_4_0_level_9_1
#endif

sampler2D SpriteTex : register(s0);
float4 FlashColor;
float  FlashAmount;                              // 0 = normal, 1 = full white flash

float4 MainPS(float2 uv : TEXCOORD0, float4 color : COLOR0) : SV_TARGET {
    float4 tex = tex2D(SpriteTex, uv) * color;
    return lerp(tex, FlashColor * tex.a, FlashAmount);   // hit-flash, preserves alpha
}

technique SpriteFlash { pass P0 { PixelShader = compile PS_SHADERMODEL MainPS(); } }
```

```csharp
flash.Parameters["FlashColor"].SetValue(Color.White.ToVector4());
flash.Parameters["FlashAmount"].SetValue(0.8f);
spriteBatch.Begin(effect: flash);               // whole batch flashes; or render one sprite per batch
```

**Unity (URP).** Two front doors: **Shader Graph** (node-based, best for artists and fast iteration — a Time node into a Tiling/Noise into Emission gets you glowing energy in minutes) or hand-written **HLSL** in an URP `Unlit` shader with `HLSLPROGRAM ... #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"`. For screen-wide effects use a **Full Screen Pass Renderer Feature** (URP 14+) driving a Fullscreen Shader Graph. Sprite hit-flash = a `lerp` to flash color in the fragment/output, same math as above.

**Godot 4 (shading language).** Its own GLSL-like dialect. 2D shaders are `shader_type canvas_item`; `TEXTURE`+`UV` are the sprite, `COLOR` is your output. Note the Godot-4 changes: color uniforms use `: source_color` (was `hint_color`), and reading the framebuffer uses `: hint_screen_texture` with `SCREEN_UV` (the old `SCREEN_TEXTURE` was removed).

```glsl
shader_type canvas_item;
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec4  flash_color : source_color = vec4(1.0);

void fragment() {
    vec4 tex = texture(TEXTURE, UV);
    COLOR = vec4(mix(tex.rgb, flash_color.rgb, flash * tex.a), tex.a);
}
```

Dissolve (drop a noise texture in, animate `amount` 0→1): `float n = texture(noise, UV).r; if (n < amount) discard;` then tint pixels where `n < amount + 0.05` for a glowing burn edge. A **full-screen** post effect is the same shader on a `ColorRect` covering the viewport, sampling `hint_screen_texture`.

## Post-processing — the cinematic layer

Real games and sites earn their polish here. Run these as fullscreen passes, in order, on the rendered frame. Keep them *subtle* — the amateur tell is cranking every slider.

```glsl
// Chromatic aberration — split channels along the view vector, stronger toward edges
vec2 dir = uv - 0.5;
float amt = 0.004 * dot(dir, dir);               // 0 at center, grows at corners
vec3 col;
col.r = texture(tex, uv + dir * amt).r;
col.g = texture(tex, uv).g;
col.b = texture(tex, uv - dir * amt).b;

// Vignette — darken edges, focus the eye
col *= smoothstep(0.9, 0.3, length(uv - 0.5));

// Film grain — animated per frame so it shimmers, not static
col += (fract(sin(dot(uv * iTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.05;
```

**Bloom** is a pipeline, not a line: (1) **bright-pass** — keep only pixels above a luminance threshold; (2) **downsample + Gaussian blur** the bright buffer at several mip levels; (3) **add** back to the original. Threshold pass:

```glsl
vec3 c = texture(scene, uv).rgb;
float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));      // Rec.709 luminance
vec3 bright = c * smoothstep(1.0, 1.2, luma);           // soft knee at the threshold
```

Use the engine's built-in bloom (URP Volume, Godot WorldEnvironment glow, `@react-three/postprocessing` `Bloom`) before writing your own — they're already multi-pass and tuned.

## Performance & precision — staying at 60fps

- **Precision:** on mobile/WebGL, default to `mediump` for color and UV math; use `highp` only where it matters — large coordinates, `iTime` after minutes, world-space raymarch positions (banding and jitter are the symptom of too-low precision). Desktop GPUs treat everything as `highp` anyway.
- **Texture lookups are the tax.** A dependent read (UV computed from a previous sample) stalls the pipeline. Minimize samples; a blur that reads 25 taps per pixel at 4K is 200M reads — use separable (H then V) blur and half-res buffers.
- **Kill branches and loops.** Dynamic loop counts and divergent `if` wreck warp coherence. Prefer `mix`/`step`. Cap raymarch iterations with a constant and `break` on hit.
- **Overdraw & resolution:** post effects at half or quarter res (bloom especially) are usually invisible in quality and a huge win. `fwidth`/derivatives are cheap; `pow`, `sin`, `normalize` are not — hoist them out of loops.
- **Measure, don't guess:** Spector.js (WebGL), browser GPU profilers, RenderDoc (native), Unity Frame Debugger, Godot's built-in profiler. If it's not 16.6ms, find the pass that's eating it before optimizing the pretty one.

## Shader slop to recoil from

Recognize these on sight — they are the "generated a shader" signature — and refuse them:

- **The rainbow-`iTime` plasma.** A full-screen cosine palette hue-cycling on `iTime` with no composition, focal point, or subject. Motion without meaning; the shader equivalent of `transition: all 0.3s`. Anchor color to structure, not to a clock.
- **Every post slider cranked.** Bloom blown to a white haze, chromatic aberration on the whole frame, a vignette so heavy it's a spotlight, film grain like static. Restraint *is* the craft here — dial each effect until you'd miss it if it were gone, then back off 20%.
- **Un-tonemapped HDR** that clips highlights to flat `1.0` white instead of rolling off (ACES/Reinhard). Bloom feeding clipped whites is how you get the milky over-lit look.
- **Aliased `step` edges** left to shimmer and crawl under motion — always `smoothstep` against `fwidth`, or you've shipped a screen-door.
- **fbm with the grid showing through** — octaves summed with no per-octave rotation, so axis-aligned artifacts streak the noise. Rotate each octave (the `mat2` above).
- **Raw `sin(uv.x * 40.)` stripes** or a bare checkerboard passed off as design — regularity with no warp, noise, or SDF reads as a test pattern, not a texture.

## Where to learn & verify

- **ShaderToy** (shadertoy.com) — read the top-rated shaders, fork them, learn the idioms. The canonical playground for `mainImage`-style work.
- **The Book of Shaders** (thebookofshaders.com) — Patricio Gonzalez Vivo's interactive intro; the best on-ramp to `smoothstep`, noise, and shaping functions.
- **Inigo Quilez** (iquilezles.org) — the definitive articles: 2D/3D distance functions, cosine palettes, domain warping, raymarching, smooth min. When in doubt, he already wrote the correct version.
