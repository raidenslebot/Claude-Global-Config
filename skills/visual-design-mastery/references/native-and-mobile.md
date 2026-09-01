# Native & Mobile UI Mastery

Native UI earns its keep by feeling like it belongs to the device in your hand — motion that obeys the OS's physics, materials that refract the real wallpaper behind them, haptics that land on the same frame as the visual, and type that respects the size the user chose in Settings. The default templates hand you a flat, springless, accent-colored husk of the platform; mastery is using the *real* current API — springs with physical parameters, matched-geometry hero transitions, GPU layer transforms, the OS's own glass and vibrancy materials — to build something with a point of view that still moves the way the platform trained the user to expect. Defer to `motion-and-animation.md` for easing theory and timing curves; this file is about the exact modifiers and specs that make each framework sing in 2026.

---

## SwiftUI (iOS 26 / macOS 26 era)

**Animation model.** Two entry points: `withAnimation(_:)` for imperative state changes, and the value-scoped `.animation(_:value:)` modifier (never the deprecated implicit `.animation(_:)`). Always scope to a value so you don't animate unrelated changes.

```swift
withAnimation(.snappy(duration: 0.35, extraBounce: 0.1)) { isExpanded.toggle() }

card
  .scaleEffect(isPressed ? 0.96 : 1)
  .animation(.spring(response: 0.4, dampingFraction: 0.75), value: isPressed)
```

**Springs, done right.** Prefer the physical spring over duration curves for anything interactive. The modern initializer is `.spring(response:dampingFraction:blendDuration:)`; iOS 17+ also gives `.spring(duration:bounce:)` and the presets `.smooth`, `.snappy`, `.bouncy` — reach for those before hand-tuning. Response is the settling *time*, dampingFraction 1.0 is critically damped (no overshoot), ~0.7 gives a lively but controlled bounce. Never ship `.easeInOut(duration:)` for gestures — it feels like the web, not the OS.

**Hero transitions with `matchedGeometryEffect`.** The single highest-leverage SwiftUI move. One `@Namespace`, same `id` on source and destination, and SwiftUI interpolates frame, position, and size across the view swap.

```swift
@Namespace private var ns
// collapsed
Image(...).matchedGeometryEffect(id: "hero-\(item.id)", in: ns)
// expanded (in the same conditional tree)
Image(...).matchedGeometryEffect(id: "hero-\(item.id)", in: ns)
```

**Phase & keyframe animators (iOS 17+).** `PhaseAnimator` steps through discrete states on a trigger; `KeyframeAnimator` drives multiple tracks (scale, rotation, offset) on independent timelines — the right tool for a "success" celebration or attention nudge.

```swift
likeButton.phaseAnimator([1.0, 1.3, 1.0], trigger: likes) { view, scale in
  view.scaleEffect(scale)
} animation: { _ in .spring(bounce: 0.5) }
```

**Custom drawing: `Canvas` + `TimelineView`.** For particle systems, waveforms, or generative backgrounds, `Canvas` gives an immediate-mode GraphicsContext and `TimelineView(.animation)` gives a per-frame clock — no `AnimationController` bookkeeping.

```swift
TimelineView(.animation) { tl in
  Canvas { ctx, size in
    let t = tl.date.timeIntervalSinceReferenceDate
    ctx.fill(Path(ellipseIn: rect(for: t, size)), with: .color(.accentColor))
  }
}
```

**SF Symbols animation.** Never leave a symbol static when it changes meaning. `.symbolEffect(.bounce)`, `.pulse`, `.variableColor.iterative`, and the iOS 18 additions `.wiggle`, `.rotate`, `.breathe`. For state changes, `.contentTransition(.symbolEffect(.replace))` morphs one glyph into another. Use `.symbolEffect(_, value:)` to fire on data change.

```swift
Image(systemName: isRecording ? "stop.fill" : "mic.fill")
  .contentTransition(.symbolEffect(.replace))
  .symbolEffect(.breathe, isActive: isRecording)
```

**Materials, Liquid Glass, and visual effects.** Use system materials — `.regularMaterial`, `.ultraThinMaterial` — for anything floating over content; they refract and adapt to light/dark for free. iOS 26's Liquid Glass is a first-class dynamic material: `.glassEffect(_:in:)` on a floating control, wrapped in a `GlassEffectContainer` so nearby glass shapes blend and morph together, with `.glassEffectID(_:in:)` linking elements across states. System button styles `.glass` and `.glassProminent` give you the OS look instantly.

```swift
GlassEffectContainer(spacing: 20) {
  HStack {
    ForEach(actions) { a in
      Image(systemName: a.icon)
        .glassEffect(.regular.interactive())
        .glassEffectID(a.id, in: glassNS)
    }
  }
}
```

`.visualEffect { content, proxy in ... }` reads a view's own geometry (via the passed `GeometryProxy`) to drive effects without a `GeometryReader` wrapper — perfect for scroll-linked parallax and depth. Pair with `.scrollTransition` for entrance choreography as cells cross the viewport. Reach for `.blur(radius:)` only for genuine depth, never as a cheap scrim — a material reads better.

---

## Jetpack Compose (1.10 / Material 3 1.4, Dec '25)

**Implicit state animation.** `animateFloatAsState`, `animateColorAsState`, `animateDpAsState`, `animateOffsetAsState` — declare a target, Compose animates the delta. Feed them a spec.

```kotlin
val elevation by animateDpAsState(
  targetValue = if (pressed) 1.dp else 8.dp,
  animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium),
  label = "elevation"
)
```

**Specs.** `spring(dampingRatio, stiffness)` is the default choice — physical and interruptible. `tween(durationMillis, easing = FastOutSlowInEasing)` when you need an exact duration; `keyframes { 0.4f at 150 }` for multi-stop. With Material 3 Expressive, prefer the theme's spring *tokens* over hand-picked stiffness: `MaterialTheme.motionScheme.fastSpatialSpec()` and friends, set app-wide with `MotionScheme.expressive()` vs `.standard()`.

**Orchestration.** `updateTransition(state)` animates several properties off one state atomically. `AnimatedVisibility` handles enter/exit with composable transitions (`fadeIn() + slideInVertically()`, `expandIn()`, `scaleOut()`). `AnimatedContent` cross-fades between different content for a state. `Animatable` + `animateTo`/`snapTo` gives gesture-precise control inside a coroutine. `rememberInfiniteTransition` for looping ambient motion.

```kotlin
AnimatedContent(targetState = screen, transitionSpec = {
  (fadeIn() + slideInHorizontally { it / 4 }) togetherWith fadeOut()
}, label = "nav") { s -> ScreenBody(s) }
```

**GPU transforms.** `Modifier.graphicsLayer { }` is where performant animation lives — mutate `translationX`, `scaleX/Y`, `rotationZ`, `alpha`, `shadowElevation` in the lambda so work stays off the composition/layout phases and on the render thread. Use it, not `offset`/`padding`, for anything animating every frame.

```kotlin
Modifier.graphicsLayer {
  alpha = progress
  scaleX = 0.9f + 0.1f * progress; scaleY = scaleX
  rotationZ = (1f - progress) * -6f
}
```

**Shared elements (stable, Dec '25).** `SharedTransitionLayout` provides a `SharedTransitionScope`; tag matching composables with `Modifier.sharedElement(rememberSharedContentState(key), animatedVisibilityScope)` or `sharedBounds(...)` for container morphs. Tune with `SharedContentConfig` on `rememberSharedContentState`, and `Modifier.skipToLookaheadPosition()` to pin a final position.

**Custom drawing.** `Canvas { }` or `Modifier.drawBehind { }` for gradients, progress rings, and blobs — `drawBehind` avoids an extra layout node. `drawWithCache` when the geometry is stable across frames.

---

## Flutter (Impeller default, Material 3)

**Impeller is the renderer now** — default on iOS and Android — which is *why* you can lean on shaders and per-frame custom paint without the old Skia jank. `useMaterial3: true` is the default `ThemeData`; anything less is a legacy look.

**Implicit widgets first.** For 80% of UI motion, an `AnimatedFoo` is all you need — no controller, no `dispose`. `AnimatedContainer`, `AnimatedOpacity`, `AnimatedAlign`, `AnimatedPositioned`, `AnimatedSwitcher`, and the general-purpose `TweenAnimationBuilder`. Each takes a `duration` and `curve`.

```dart
AnimatedContainer(
  duration: const Duration(milliseconds: 350),
  curve: Curves.easeOutCubic,
  width: expanded ? 320 : 64,
  decoration: BoxDecoration(
    color: cs.surfaceContainerHigh,
    borderRadius: BorderRadius.circular(expanded ? 28 : 32),
  ),
);
```

**Explicit for choreography.** When you need coordinated, reversible, or gesture-driven motion: `AnimationController(vsync: this, duration: ...)` (with `SingleTickerProviderStateMixin`), one or more `Tween`s piped through `CurvedAnimation`, driving an `AnimatedBuilder`. Stagger tracks by wrapping each in an `Interval`.

```dart
final _slide = Tween(begin: const Offset(0, .2), end: Offset.zero).animate(
  CurvedAnimation(parent: _c, curve: const Interval(0.2, 1, curve: Curves.easeOutCubic)),
);
```

**The Curves catalog is a design decision.** `Curves.easeOutCubic` for most entrances, `Curves.easeInOutCubicEmphasized` for Material's expressive feel, `Curves.fastOutSlowIn` for standard Material, `Curves.decelerate` for things arriving, `Curves.elasticOut`/`bounceOut` sparingly for playful accents. Default `Curves.linear` is a bug, not a choice — never ship it for spatial motion.

**Hero transitions** are one widget: same `Hero(tag: id, child: ...)` on both routes and Flutter tweens the bounds across the Navigator push. Keep tags unique per screen pair.

**Custom drawing & shaders.** `CustomPainter` + `CustomPaint` for anything bespoke — override `paint` and a tight `shouldRepaint`. For GPU effects, author a GLSL `.frag`, declare it under `shaders:` in `pubspec.yaml`, and load via `FragmentProgram.fromAsset` → set uniforms → paint with the `FragmentShader`. Impeller compiles these ahead of time, so no first-run shader jank. The `flutter_animate` package is a legitimate shortcut for declarative effect chains (`.animate().fadeIn().slideY()`).

---

## The shared craft (this is what separates native from a webview)

**Respect the platform, keep a point of view.** Match navigation gestures, transition direction, and settling physics to the OS — an iOS back-swipe must feel like iOS — but own your color, type scale, spacing, and one signature motion. Blindly accepting Material's baseline purple or SwiftUI's `.blue` accent *is* the generic look.

**Haptics are interaction design, not garnish.** Fire them on the same frame as the visual confirmation. iOS: `UIImpactFeedbackGenerator`/`.sensoryFeedback(.impact, trigger:)` in SwiftUI. Android: `HapticFeedbackConstants.CONFIRM`/Compose `LocalHapticFeedback`. Flutter: `HapticFeedback.mediumImpact()`. Map weight to consequence — light for selection ticks, medium for commits, success/warning notification haptics for outcomes. Silence is also a choice; don't buzz on every scroll.

**Safe areas and the dynamic island.** Never hardcode top/bottom insets. SwiftUI respects safe areas by default — opt *out* deliberately with `.ignoresSafeArea()` only for backgrounds, and use `.safeAreaInset(edge:)` to add bars that push content. Compose: `Modifier.windowInsetsPadding(WindowInsets.safeDrawing)` / `.systemBarsPadding()`. Flutter: `SafeArea` or `MediaQuery.paddingOf(context)`.

**Dynamic Type / font scaling is non-negotiable.** Use semantic text styles (`.font(.body)`, `MaterialTheme.typography.bodyLarge`, `Theme.of(context).textTheme`) and *test at the largest accessibility size*. Fixed `.font(.system(size: 15))` breaks at AX5 and screams amateur. Cap growth only where layout truly can't flex.

**Dark mode at the token level.** Define semantic color roles once (surface, onSurface, surfaceContainer, primary, outline) that resolve per-scheme — SwiftUI asset catalog colors / `Color(uiColor:)`, Compose `ColorScheme` roles, Flutter `ColorScheme.fromSeed(... brightness:)`. Never `if isDark { .black } else { .white }` scattered through views; that's how you get the one screen that forgot to switch.

---

## Desktop, where polish still applies

- **WinUI 3 / Windows App SDK:** Mica and Acrylic backdrop materials (`BackdropMaterial`, `DesktopAcrylicBackdrop`), `ConnectedAnimationService` for hero transitions between pages, `ThemeShadow` for real elevation, `AnimatedIcon`. This is Fluent done natively — far beyond WPF's `Storyboard`/`DoubleAnimation` (still fine for line-of-business).
- **macOS:** SwiftUI shares everything above; drop to AppKit `NSVisualEffectView` for sidebar/titlebar vibrancy and Core Animation `CABasicAnimation`/`CAKeyframeAnimation` for layer-level work.
- **GTK4 / libadwaita:** style with CSS, animate via `AdwTimedAnimation`/`AdwSpringAnimation`, and adopt Adwaita's boxed-list and `AdwToastOverlay` idioms so the app feels GNOME-native.
- **Qt / QML:** `Behavior on <property> { NumberAnimation { easing.type: Easing.OutCubic } }` and `QPropertyAnimation` give declarative, easing-aware motion.

---

## The templated-app look to avoid

- **Untouched Material baseline purple** (`#6750A4`) with default Roboto and a single seed color — the "I ran `flutter create` and shipped it" tell. Reseed and rebuild the type scale.
- **SwiftUI's default `.blue` accent** on stock `NavigationStack`/`List` rows with SF Pro at one size and zero hierarchy.
- **Bounce-everything** with `.elasticOut`/high `extraBounce` on every element — motion should be mostly calm with rare, meaningful accents.
- **A centered spinner** as the only loading state. Use skeletons/`redacted(reason: .placeholder)` (SwiftUI) or shimmer that mirrors the real layout.
- **`easeInOut(duration:)` / `Curves.linear` on gestures**, which feel like a webpage, not a device — use springs.
- **No haptics, ignored safe areas, fixed font sizes, and hard-coded light-mode colors** — the four fastest ways to reveal a cross-platform wrapper pretending to be native.
- **Same layout everywhere:** honor each platform's navigation model (iOS tab/stack + swipe-back, Android nav + predictive back, adaptive panes on large screens) instead of shipping one phone layout stretched to a tablet.
