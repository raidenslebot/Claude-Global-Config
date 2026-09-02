# Game & Engine Visual Excellence

Beautiful game visuals are not a rendering problem, they are a *response* problem: the screen must react to the player with more force, more life, and more follow-through than physics alone would give. A static sprite drawn perfectly is dead; the same sprite that squashes on landing, flashes white on a hit, and drags the camera a few pixels behind a kick is alive. This file is about that craft in code — SpriteBatch first, because that is the canvas you actually draw into when you mod Barotrauma (which ships a modified MonoGame fork and renders everything through `SpriteBatch`). Juice is the product, not the garnish. General easing theory lives in `motion-and-animation.md`; deep shader authoring lives in `shaders-and-gpu.md` — this file wires those into real engines.

---

## MonoGame / C# 2D rendering craft

### SpriteBatch: know exactly what `Begin` does

`SpriteBatch.Begin` sets the *entire* GPU state for every draw until `End`. The full signature is the one that matters — memorize it:

```csharp
spriteBatch.Begin(
    sortMode:        SpriteSortMode.Deferred,   // batches all draws into 1 submit, preserves call order
    blendState:      BlendState.AlphaBlend,     // default; premultiplied-alpha (content pipeline premultiplies)
    samplerState:    SamplerState.PointClamp,   // PIXEL ART = PointClamp. LinearClamp blurs it into mush
    depthStencilState: null,
    rasterizerState: null,
    effect:          null,                       // your custom .fx goes here
    transformMatrix: camera.View);               // world -> screen
```

**SpriteSortMode is a performance and correctness decision, not a default to ignore:**
- `Deferred` — one draw call for the whole batch, order = call order. Your default.
- `Immediate` — submits each `Draw` on the spot. The *only* mode where you can change `effect` parameters *between* draws inside one Begin/End (per-sprite flash amounts, per-sprite dissolve). Slow; use it deliberately.
- `Texture` — sorts by texture to minimize atlas swaps when you can't control call order.
- `BackToFront` / `FrontToBack` — sorts by `layerDepth` (the last float arg of `Draw`, 0..1). With `BackToFront`, higher depth draws first (further back). Pick ONE convention project-wide, e.g. 0 = foreground, 1 = background, and never fight it.

**Batching rule that governs your frame:** every state change (blend, sampler, effect, render target) forces a new batch. Draw all your additive glow in one Begin/End block, all your alpha sprites in another. Don't interleave. A thousand sprites in one batch is cheap; a hundred batches of ten is not.

**Additive glow — the single highest-value blend state for beauty:**

```csharp
spriteBatch.Begin(SpriteSortMode.Deferred, BlendState.Additive,
                  SamplerState.PointClamp, null, null, null, camera.View);
// fire, sparks, lasers, magic, muzzle flash, bloom-ish highlights:
spriteBatch.Draw(glowTex, pos, null, Color.White * intensity, rot, origin, scale,
                 SpriteEffects.None, 0f);
spriteBatch.End();
```

Additive means RGB accumulates and black is free (adds nothing), so soft radial-gradient textures stack into light. `Color.White * 0.5f` scales alpha *and* premultiplied RGB — that is your brightness knob. This one block is 80% of why particles read as "energy."

### Camera / transform matrix

Never move sprites to fake a camera — move the world with a matrix passed to `Begin`:

```csharp
public Matrix View =>
    Matrix.CreateTranslation(new Vector3(-Position, 0f)) *
    Matrix.CreateRotationZ(Rotation) *
    Matrix.CreateScale(Zoom, Zoom, 1f) *
    Matrix.CreateTranslation(new Vector3(viewport.Width * 0.5f, viewport.Height * 0.5f, 0f));
```

Screen shake, zoom-punch, and lerped follow all become "add to `Position`/`Zoom`," and every sprite, particle, and light inherits them for free.

### RenderTarget2D + custom Effect (post-processing)

Draw the scene to an off-screen target, then draw that target to the backbuffer *through* an `Effect` (.fx compiled by the content pipeline). This is how you get vignette, chromatic aberration, bloom, CRT, palette-swap over the whole frame:

```csharp
// once
_scene = new RenderTarget2D(GraphicsDevice, w, h, false, SurfaceFormat.Color, DepthFormat.None);

// draw
GraphicsDevice.SetRenderTarget(_scene);
GraphicsDevice.Clear(Color.Black);
DrawWorld(spriteBatch);              // normal Begin/End here
GraphicsDevice.SetRenderTarget(null);

_post.Parameters["ChromaticAmount"].SetValue(0.003f * camera.Trauma); // punch on hits
spriteBatch.Begin(effect: _post, samplerState: SamplerState.PointClamp);
spriteBatch.Draw(_scene, Vector2.Zero, Color.White);
spriteBatch.End();
```

Per-sprite (not full-screen) effects — e.g. a hit-flash shader on one enemy — need `SpriteSortMode.Immediate` so you can `SetValue` between draws, or a separate Begin/End per sprite. Barotrauma mods hook the draw path and can insert their own `Effect` and render target the same way. HLSL contents belong in `shaders-and-gpu.md`.

---

## Game feel / juice — the actual craft

The ethos: *"Juice it or lose it"* (Martin Jonasson & Petri Purho, Nordic Game 2012) — a game feels good when it over-responds to input. Every event below should be dt-based and layered; juice is cumulative.

### An easing helper you will use everywhere

`System.MathF` gives you float math without casts. Keep this next to your game code:

```csharp
public static class Ease {
    public static float Lerp(float a, float b, float t) => a + (b - a) * t;
    public static float OutCubic(float t) => 1f - MathF.Pow(1f - t, 3f);        // settle
    public static float InOutQuad(float t) => t < 0.5f ? 2f*t*t : 1f - MathF.Pow(-2f*t+2f, 2f)*0.5f;
    public static float OutBack(float t) {                                       // overshoot (pop-in)
        const float c1 = 1.70158f, c3 = c1 + 1f;
        return 1f + c3*MathF.Pow(t-1f, 3f) + c1*MathF.Pow(t-1f, 2f);
    }
    public static float OutElastic(float t) {                                    // springy, use sparingly
        if (t == 0f || t == 1f) return t;
        const float c4 = (2f*MathF.PI)/3f;
        return MathF.Pow(2f, -10f*t) * MathF.Sin((t*10f - 0.75f)*c4) + 1f;
    }
}
```

`OutBack` on spawn scale is the difference between a UI element that *appears* and one that *arrives*. (Full curve catalog: `motion-and-animation.md`.)

### Screen shake — a choice, not a default

**First decide whether to shake at all.** Shake is the most over-applied juice technique in games. It costs readability (players lose track of what they're aiming at), it triggers motion sickness in a real slice of your audience, and in a slow, tense, or contemplative game it actively fights the mood — Barotrauma's claustrophobic dread is not served by the same camera as a bullet-hell. Shake earns its place when an impact needs weight the animation alone can't sell. If you can't name what the shake is communicating, cut it and put the force into hit-stop, a flash, or a particle burst instead.

**If you do shake**, know the options and pick deliberately:

| approach | when it fits |
|---|---|
| **trauma-based** (below) | events of varying weight in the same game; you want small hits to barely register and big ones to slam |
| **noise/Perlin offset** | continuous ambience — an engine rumble, a collapsing structure — where the shake has no discrete "event" |
| **spring/impulse camera** (Unity's Cinemachine Impulse, or a hand-rolled damped spring) | directional force — you want the camera *pushed* away from an explosion, not vibrated in place |
| **none** | see above. Frequently correct. |

**Trauma** (Squirrel Eiserloh, *"Juicing Your Cameras With Math,"* GDC) is a strong default for the first case. Store a 0..1 trauma value, add to it on events, and derive shake as **trauma squared**. The squaring is the point and the only part that isn't taste: it makes response non-linear, so a light hit reads as a nudge while a heavy one reads as a slam, without you hand-authoring a magnitude per event type. A raw magnitude you decrement each frame decays linearly and tends to read mechanical by comparison.

```csharp
public sealed class Shake {
    public float Trauma;                         // 0..1
    float _t;
    readonly Random _r = new();

    // TUNE THESE BY FEEL. They are starting points, not values to ship.
    // What they mean, so you know which way to push them:
    //   Decay     - trauma units bled per second. Higher = snappier recovery.
    //   MaxAngle  - radians of camera roll at full trauma. Small values read as
    //               impact; large values read as a joke. Often 0 is right.
    //   MaxOffset - pixels of translation at full trauma. Scale this to your
    //               camera zoom and sprite size, or it means nothing.
    // A pixel-art game at 4x zoom and a 1080p sim want different numbers.
    // Expose them in a debug UI and drag them while the game runs; shake is
    // tuned by watching, never by reasoning about the constant.
    float _decay = 1.2f, _maxAngle = 0.15f, _maxOffset = 24f;

    public void Add(float amount) => Trauma = MathHelper.Clamp(Trauma + amount, 0f, 1f);

    public void Update(float dt) {
        _t += dt;
        Trauma = MathF.Max(0f, Trauma - _decay * dt); // linear trauma decay...
    }

    public (float angle, Vector2 offset) Sample() {
        float shake = Trauma * Trauma;               // ...but shake = trauma^2 (nonlinear feel)
        float n() => (float)(_r.NextDouble() * 2.0 - 1.0);
        return (_maxAngle * shake * n(),
                new Vector2(_maxOffset * shake * n(), _maxOffset * shake * n()));
    }
}
```

Feed `offset`/`angle` into the camera matrix. Trauma added per event is a design decision, not a formula — the only rule is that the *ordering* matches how the player is meant to rank those events, and that your heaviest event doesn't sit so far below 1.0 that the squaring never gets to do anything. Sanity-check by triggering the lightest and heaviest events back to back; if you can't feel the difference, your range is too narrow, and if the light one is distracting, it's too wide.

Swap `Random` for Perlin/simplex noise per axis when the jitter reads as cheap — noise gives smooth, correlated motion rather than per-frame static. That single change is usually the difference between "the camera is vibrating" and "something heavy just happened."

### Hit-stop (freeze frames)

The most underused juice. On a heavy impact, *stop time* for a few frames so the brain registers the collision, then resume. This is what makes melee feel like it connects:

```csharp
float _hitStop;                                  // seconds of remaining freeze
public void FreezeFor(float seconds) => _hitStop = MathF.Max(_hitStop, seconds);

// in Update(GameTime gt):
float dt = (float)gt.ElapsedGameTime.TotalSeconds;
if (_hitStop > 0f) { _hitStop -= dt; return; }   // skip gameplay update; keep drawing last frame
UpdateWorld(dt);
```

Typical values: 0.03–0.08s for a hit, up to ~0.15s for a kill. Combine with shake and a flash and a cheap hit becomes visceral.

### Squash & stretch on impact

Volume-preserving scale sells weight. On landing/impact, squash Y and stretch X, then ease back to (1,1):

```csharp
// on impact:
_squash = 0.4f;                                  // 0 = rest
// draw:
float s = _squash;                               // decayed each frame toward 0 via OutCubic timing
var scale = new Vector2(1f + s, 1f - s);         // wider + shorter; invert for a jump anticipation
spriteBatch.Draw(tex, pos, null, Color.White, 0f, origin, scale * baseScale, SpriteEffects.None, 0f);
```

Anticipation (a quick squash *before* a jump) and follow-through (overshoot then settle with `OutBack`) are the same tool aimed backward and forward in time.

### Color flash on hit + chromatic punch

Flash the sprite toward white for 1–2 frames — instant "I hit it" feedback. Cleanest with a tiny effect whose fragment does `lerp(texColor.rgb, flashColor.rgb, amount)`; plumb it per-sprite:

```csharp
_flash.Parameters["FlashColor"].SetValue(Color.White.ToVector4());
_flash.Parameters["FlashAmount"].SetValue(hurtTimer > 0f ? 0.85f : 0f);
spriteBatch.Begin(SpriteSortMode.Immediate, effect: _flash, samplerState: SamplerState.PointClamp);
```

Drive the full-screen chromatic-aberration `Effect` param off `Shake.Trauma` (see the render-target block above) so big hits smear the RGB channels for a frame or two. Restraint is the whole game — juice that never rests stops reading as impact.

---

## Particle systems in C#

Build a fixed pool (no per-frame allocation) with an emitter that reuses dead slots. Per-particle, lerp position, scale, alpha, and color across a normalized lifetime `t = Age/Life`:

```csharp
struct P { public Vector2 Pos, Vel; public float Age, Life, Rot, RotVel, S0, S1;
           public Color C0, C1; public bool Live; }

readonly P[] _pool = new P[1024];
readonly Random _r = new();

public void Emit(Vector2 at, int count) {
    for (int n = 0; n < count; n++)
        for (int i = 0; i < _pool.Length; i++)
            if (!_pool[i].Live) {
                double a = _r.NextDouble() * MathF.PI * 2.0;             // spray in a full circle (or a cone)
                float spd = 60f + (float)_r.NextDouble() * 140f;
                _pool[i] = new P {
                    Pos = at, Vel = new Vector2(MathF.Cos((float)a), MathF.Sin((float)a)) * spd,
                    Life = 0.4f + (float)_r.NextDouble() * 0.6f, Age = 0f,
                    Rot = 0f, RotVel = (float)(_r.NextDouble()*2-1)*6f,
                    S0 = 1.4f, S1 = 0f, C0 = Color.White, C1 = new Color(255, 120, 20), Live = true };
                break;
            }
}

public void Update(float dt) {
    for (int i = 0; i < _pool.Length; i++) {
        ref P p = ref _pool[i]; if (!p.Live) continue;
        p.Age += dt; if (p.Age >= p.Life) { p.Live = false; continue; }
        p.Vel *= MathF.Pow(0.5f, dt);           // drag; add gravity with p.Vel.Y += g*dt
        p.Pos += p.Vel * dt; p.Rot += p.RotVel * dt;
    }
}

public void Draw(SpriteBatch sb, Texture2D dot, Vector2 origin) {
    sb.Begin(SpriteSortMode.Deferred, BlendState.Additive, SamplerState.PointClamp);
    for (int i = 0; i < _pool.Length; i++) {
        ref P p = ref _pool[i]; if (!p.Live) continue;
        float t = p.Age / p.Life;
        float s = Ease.Lerp(p.S0, p.S1, t);
        Color c = Color.Lerp(p.C0, p.C1, t) * (1f - t);  // Additive (One/One) IGNORES alpha —
                                                 // premultiply the fade into RGB or it pops out
        sb.Draw(dot, p.Pos, null, c, p.Rot, origin, s, SpriteEffects.None, 0f);
    }
    sb.End();
}
```

**What makes particles beautiful:** fade to nothing at end of life (under `BlendState.Additive` that means multiplying the colour down, not lowering alpha — additive blending never reads the alpha channel) — a particle that *pops* out is the #1 tell of amateur work. Use additive for fire/sparks/magic, alpha-blend for smoke/dust. Give a hot bright core color that lerps to a cool dark rim (`White -> orange -> transparent`). Randomize every parameter within a range — uniform particles look mechanical. Prefer many small short-lived particles over few big ones. Add slight drag and a touch of gravity so motion arcs instead of flying straight.

---

## Tweening in C#

For a hand-rolled tween, the `Ease` helper above plus a timer is genuinely enough for most events — don't reach for a library to scale a button:

```csharp
class Tween {
    float _t, _dur; float _from, _to; Func<float,float> _ease; Action<float> _apply;
    public bool Done => _t >= _dur;
    public Tween(float from,float to,float dur,Func<float,float> ease,Action<float> apply)
        { _from=from; _to=to; _dur=dur; _ease=ease; _apply=apply; }
    public void Update(float dt){ _t=MathF.Min(_t+dt,_dur);
        _apply(Ease.Lerp(_from,_to, _ease(_t/_dur))); }
}
```

When you want chaining, `AutoReverse`, `RepeatForever`, and property-expression targeting without writing it, the real, current library is the tweening module of **MonoGame.Extended** (NuGet `MonoGame.Extended`, 5.4.0+ and 6.x as of mid-2026 — the separate `MonoGame.Extended.Tweening` package is deprecated at 3.8; the namespace is still `using MonoGame.Extended.Tweening;`). A `Tweener` field, then:

```csharp
_tweener.TweenTo(sprite, s => s.Scale, toValue: 1.3f, duration: 0.15f)
        .Easing(EasingFunctions.BackOut).AutoReverse();
_tweener.Update(dt);   // v5.4 adds Tween.OnUpdate and Tweener.ActiveTweens (alloc-free)
```

**DOTween is Unity-only** — it depends on Unity's `MonoBehaviour`/coroutine world and does not run in bare MonoGame. Do not try to pull it into a Barotrauma mod. Standalone easing-only libraries like *Pleasing* exist but MonoGame.Extended is the one worth standardizing on.

---

## Palette & lighting for 2D

- **Limited palette.** Pick 16–32 colors and hue-shift consistently: shadows drift toward blue/purple, highlights toward warm yellow — never just darken a color, rotate its hue. A tight palette reads as intentional; unlimited color reads as noise.
- **Dynamic 2D lights (the 2-pass classic).** Render the scene to one target. Render soft radial gradient "light" sprites *additively* to a second light target (each tinted per light). Then draw the scene through an effect that multiplies scene × light. Cheap, and it's the backbone of Barotrauma-style submarine gloom.
- **Normal maps for 2D.** Author a per-sprite normal map and, in an `Effect`, compute `N·L` per pixel from a passed light position/color to get real directional shading on flat sprites. Generate them with **Laigter** (free, actively maintained) or Sprite DLight.
- **Rim light** = detect edges facing the light (high `N·L` near silhouette) and add a bright accent; it separates a character from the background instantly.
- **Fake AO / contact shadows.** A soft dark ellipse multiplied under every object grounds it. Cheapest, highest-impact lighting trick in 2D.

---

## Unity (URP)

- **Post-processing = a `Volume` component + Volume Profile** with per-effect overrides: `Bloom`, `Vignette`, `ChromaticAberration`, `ColorAdjustments`, `Tonemapping`, `LensDistortion`, `MotionBlur`, `DepthOfField`. Bloom needs HDR enabled on the pipeline asset and emissive/over-1 pixels to glow. A Global volume for base grade + a scripted volume you crank on events.
- **Shader Graph** for materials; **VFX Graph** (GPU) for heavy particle counts, **Shuriken** (`ParticleSystem`) for gameplay particles.
- **Tweening: DOTween** (`transform.DOScale(1.2f, .15f).SetEase(Ease.OutBack)`, `DOShakePosition`, `DOTween.Sequence()`), or **PrimeTween** — a newer allocation-free alternative worth adopting on new projects.
- **Camera shake: Cinemachine Impulse** (`CinemachineImpulseSource.GenerateImpulse`) — trauma-quality shake without hand-rolling the matrix.
- **2D lighting: `Light2D`** (URP 2D Renderer) — Global / Spot (named Point before URP 11) / Freeform / Sprite light types, `ShadowCaster2D` for occlusion, sprite normal maps via the Sprite-Lit material.
- **Timeline + Animator** for scripted sequences and state-driven animation.

---

## Godot 4

- **Shading language.** `shader_type canvas_item;` with a `fragment()` function; read `TEXTURE`/`UV`, write `COLOR`. Screen reads use a `sampler2D` with `hint_screen_texture` (the old `SCREEN_TEXTURE` is gone in Godot 4).
- **Particles: `GPUParticles2D`** with a `ParticleProcessMaterial` (or a custom `shader_type particles;`). `CPUParticles2D` when you need it on the CPU or on low-end targets.
- **Tweening: `create_tween()`** — the idiomatic, no-dependency path:
  ```gdscript
  var tw := create_tween()
  tw.tween_property(sprite, "scale", Vector2(1.3, 1.3), 0.15) \
    .set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
  tw.set_parallel()   # or chain sequentially by default
  ```
- **Glow / bloom for 2D:** a `WorldEnvironment` node with an `Environment` resource, `glow_enabled = true` plus `glow_intensity`/`glow_bloom`/`glow_hdr_threshold`. In Godot 4.2+ you must enable **HDR 2D** (Project Settings → Rendering → Viewport → HDR 2D, `rendering/viewport/hdr_2d`; Forward+ and Mobile renderers only, not Compatibility) for over-1 colors to actually bloom.
- **2D lights:** `PointLight2D` / `DirectionalLight2D`, `CanvasModulate` for global tint, `LightOccluder2D` for shadows, and `CanvasTexture.normal_texture` for per-sprite normal mapping.

---

## Game slop to recoil from

The "programmer made this, nobody art-directed it" tells — and note that half of them are *over*-juicing, not under:

- **Everything shakes.** Shake on every hit, every pickup, every UI click. When everything shakes, nothing has weight, and the player just feels seasick. (See the shake section: often the answer is none.)
- **Bloom cranked to hide flat art.** Full-screen glow as a substitute for lighting or palette discipline. If turning bloom off makes the scene look bad, the scene *is* bad — fix the art, not the post stack.
- **White-flash everything, same duration.** One 0.1s pure-white flash on every entity regardless of size, material, or weight. A boss and a rat should not flash identically.
- **Particles that are just white circles fading out.** No color ramp over lifetime, no size curve, no rotation, no additive stacking. Real particle beauty is in the *lifetime curves*, not the count.
- **Linear lerp on every value.** Positions, scales, and colors sliding at constant speed. It reads mechanical instantly; see `motion-and-animation.md`.
- **Instant pop-in/pop-out.** Entities appearing and vanishing on a single frame with no scale, fade, or anticipation. Nothing in a living world teleports.
- **Full-saturation RGB with no palette.** `Color.Red`, `Color.Lime`, `Color.Blue` straight from the enum. Pull a constrained palette (Lospec) and tint everything through it.
- **UI bolted on in screen space** with a different visual language than the world — default font, pure white, no diegetic thought.

**Bottom line for the Barotrauma/MonoGame reality:** `SpriteBatch` + `BlendState.Additive` + `RenderTarget2D` is your whole toolbox, and it is enough. Layer trauma-based shake, hit-stop, squash & stretch, a white flash, and pooled additive particles on every meaningful event, ease every value change, and let nothing pop instantly to or from existence. That stack — not a fancier engine — is the gap between "sprites moving" and a game that feels good in the hand.
