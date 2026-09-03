#!/usr/bin/env node
// techniques.mjs — what a piece reaches for, what it never tried, and which dimension of its
// own medium it left completely unexplored.
//
//   cgc techniques page.html
//   cgc techniques ./src --min 6
//   cgc techniques shader.frag --json
//   cgc techniques --media                 # every medium and every technique known
//
// THE SHAPE OF THE PROBLEM. The slop lint names what a piece should not have. That is only half:
// a page can carry no fingerprint at all — no purple gradient, no glass card, no centred hero —
// and still be built entirely from flexbox, a hex colour and a 300ms transition. It is not bad.
// It is CONVENTIONAL, and conventional is the ceiling almost all generated work sits at, because
// the model reaches for the capability it has seen most and what it has seen most is a decade old.
//
// TWO AXES, because a feature checklist alone is shallow and medium-bound.
//
//   1. MEDIUM. A shader, a Unity scene, a SwiftUI view, a terminal UI, a chart, a letterpress
//      card and a web page do not share a vocabulary, and a catalogue that only knows CSS calls
//      every non-web piece empty. Each medium here carries its own.
//
//   2. DIMENSION. Under the vocabularies sit eight questions that are the same in every medium:
//      what is it made of, how is it composed, how is it set, does it change over time, does it
//      have depth, does it answer the viewer, is any of it computed rather than authored, and is
//      it ever different. A piece using five techniques from one dimension is narrower than one
//      using three across three, and the dimension it never touched is the honest answer to
//      "what did this never try" — a question about the piece, not a feature to bolt on.
//
// NOTHING HERE IS HARDCODED IN THE SENSE THAT MATTERS: the registry is data, a medium is one
// object, and it is extended without touching this file by dropping JSON at
//   <cwd>/.cgc/techniques.json   or   <config root>/techniques.json
// of the form { "media": [ { id, label, detect, techniques: [ { id, dim, lift, re, what } ] } ] }
// with `detect` and `re` as regex source strings. Same-id entries merge over the shipped ones.
//
// Quantity is not quality, and a technique adopted for its own sake is decoration. But a piece
// that reaches for none of them was assembled rather than designed, and that is a fact about the
// file rather than a matter of taste.

import { readFileSync, statSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const EXTS = new Set([
  '.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.js', '.ts', '.mjs',
  '.svg', '.glsl', '.frag', '.vert', '.wgsl', '.shader', '.hlsl',
  '.swift', '.kt', '.dart', '.cs', '.gd', '.py', '.rs', '.go',
])

// The eight questions, asked of any medium. `ask` is what an unexplored dimension says to the
// author: a question about what the piece IS, which is the part a feature list cannot reach.
export const DIMENSIONS = {
  material: { label: 'material', ask: 'What is this made of? Colour, ink, texture, light, grain, weight. A piece with no material is a diagram of itself.' },
  structure: { label: 'structure', ask: 'How is it composed? Everything here sits in a stack or a plain grid. What happens if one element breaks its box, or the composition has a subject instead of a sequence?' },
  type: { label: 'type', ask: 'How is it set? Text here is sized, not typeset: no optical size, no real scale, none of the features the type designer drew.' },
  time: { label: 'time', ask: 'Does anything happen? Nothing changes, arrives, decays or resolves over time. Stillness is a legitimate decision, but it has to be a decision.' },
  depth: { label: 'depth', ask: 'Is anything behind anything? No layering, occlusion, parallax, meaningful shadow or third axis. Flat is worth choosing on purpose.' },
  response: { label: 'response', ask: 'Does it answer the viewer? Nothing reacts to input, focus, state, proximity or data. A surface that cannot be touched is a picture of an interface.' },
  generative: { label: 'generative', ask: 'Is any of it computed? Everything is authored by hand: no noise, no simulation, no procedural rule, nothing derived. One rule can make a thousand marks nobody had to draw.' },
  variation: { label: 'variation', ask: 'Is it ever different? This renders the same picture every time for everyone. Variation by data, state, instance, seed or time of day is the difference between a piece and a print of one.' },
}
export const DIMS = Object.keys(DIMENSIONS)

const T = (id, dim, lift, re, what) => ({ id, dim, lift, re, what })

// ── The media ────────────────────────────────────────────────────────────────────────────────
export const MEDIA = [
  {
    id: 'web', label: 'web / CSS',
    detect: /<style|<\/html>|className=|styled\.|@media\b|:root\s*\{|display\s*:\s*(?:flex|grid)|\.css\b|\.scss\b/i,
    techniques: [
      T('oklch', 'material', 3, /\boklch\(|\boklab\(/i, 'oklch — perceptually even lightness, so a ramp steps evenly and two hues at the same L really match. Hex cannot express this, which is why hand-picked palettes drift.'),
      T('relative-color', 'material', 3, /(?:rgb|hsl|oklch|oklab|lch|lab)\(\s*from\s+/i, 'relative colour syntax — derive every tint, border and state from one source colour instead of pasting a new hex per state.'),
      T('color-mix', 'material', 2, /color-mix\(/i, 'color-mix() — tints and borders mixed from the palette, so changing one token moves the whole system.'),
      T('wide-gamut', 'material', 2, /display-p3|color\(\s*display-p3|color-gamut/i, 'display-p3 — colours that do not exist in sRGB, on every modern screen.'),
      T('mask', 'material', 3, /(?:-webkit-)?mask-image\s*:|(?:-webkit-)?mask\s*:\s*(?:linear|radial|conic|url)|background-clip\s*:\s*text/i, 'gradient and image masks — an edge that is not a rectangle, type that fades into the page, a reveal that wipes. The alternative to wrapping it in another card.'),
      T('blend', 'material', 3, /mix-blend-mode\s*:|background-blend-mode\s*:/i, 'blend modes — ink that reacts to what is under it: multiply for print behaviour, difference for a headline that inverts across an image.'),
      T('layered-shadow', 'depth', 1, /box-shadow\s*:[^;{}]*?(?:\)|#[0-9a-f]{3,8})\s*,[^;{}]*?(?:\)|#[0-9a-f]{3,8})\s*,/i, 'layered shadows — four or five stacked at increasing blur, which is what light actually does. A single 20px blur is the giveaway.'),
      T('depth-stack', 'depth', 3, /perspective\s*:|transform-style\s*:\s*preserve-3d|translateZ\(|rotate[XY]\(/i, 'a real z axis — perspective and preserved 3D, so layers sit at different distances rather than being painted on one plane.'),
      T('backdrop', 'depth', 1, /backdrop-filter\s*:/i, 'backdrop-filter beyond the glass card — a legibility scrim, a sticky bar that stays readable over anything.'),
      T('svg-filter', 'generative', 3, /feTurbulence|feDisplacementMap|feColorMatrix|filter\s*:\s*url\(#/i, 'SVG filters — generated grain (feTurbulence), a warped edge (feDisplacementMap), a true duotone (feColorMatrix). Texture computed rather than a stock overlay.'),
      T('conic', 'generative', 2, /conic-gradient\(|repeating-(?:linear|radial|conic)-gradient\(/i, 'conic and repeating gradients — dials, halftones, stripes and moiré with no image asset.'),
      T('houdini-paint', 'generative', 3, /CSS\.paintWorklet|paint\(\s*[a-z-]+\s*\)/i, 'a paint worklet — a background drawn by your own code, parameterised by custom properties.'),
      T('clip-path', 'structure', 2, /clip-path\s*:\s*(?:polygon|path|circle|ellipse|inset)/i, 'clip-path — a section edge that is a diagonal, an arc or a drawn path.'),
      T('container-query', 'structure', 3, /@container|container-type\s*:/i, 'container queries — a component that responds to its OWN width. One component correct in a sidebar, a grid and a hero, with no variants.'),
      T('subgrid', 'structure', 2, /grid-template-(?:columns|rows)\s*:\s*subgrid/i, 'subgrid — cards whose titles, bodies and footers align across a row even with different content. The ragged card row is the commonest generated-layout defect.'),
      T('grid-overlap', 'structure', 3, /grid-(?:area|column|row)\s*:\s*1\s*\/\s*1\b|grid-(row|column)\s*:\s*(\d+)\s*[;}][\s\S]{0,400}?grid-\1\s*:\s*\2\s*[;}]|z-index[\s\S]{0,80}margin-(?:top|left|bottom|right)\s*:\s*-|position\s*:\s*absolute[\s\S]{0,240}?(?:left|right|top|bottom)\s*:\s*-\d{1,3}(?:\.\d+)?(?:%|(?:r?em|vw|vh|px)\b)/i, 'deliberate overlap — two elements sharing one grid cell, or a negative margin with z-index. The fastest way out of a column of rectangles: let something break its box.'),
      T('shape-outside', 'structure', 2, /shape-outside\s*:/i, 'shape-outside — text flowing around a real silhouette instead of a rectangle.'),
      T('anchor-position', 'structure', 3, /anchor-name\s*:|position-anchor\s*:|position-area\s*:/i, 'CSS anchor positioning — tooltips and menus tethered to an element with no JS and no library.'),
      T('variable-axes', 'type', 3, /font-variation-settings\s*:[^;}]*["'](?:opsz|slnt|wdth|GRAD|YOPQ|CASL|MONO|SOFT|WONK)["']/i, 'variable font axes past weight — optical size, width, slant, grade. One family becomes a typographic system; grade is how dark-mode text stops looking fat.'),
      T('optical-sizing', 'type', 2, /font-optical-sizing\s*:\s*auto/i, 'optical sizing — the display cut at display size and the text cut at reading size. The difference between typeset and merely scaled.'),
      T('opentype', 'type', 2, /font-feature-settings\s*:|font-variant-(?:numeric|ligatures|caps|alternates)\s*:/i, 'OpenType features — stylistic sets, discretionary ligatures, tabular or old-style figures, small caps. The character the type designer drew and nobody switches on.'),
      T('text-stroke', 'type', 2, /-webkit-text-stroke|paint-order\s*:\s*stroke|text-box(?:-trim|-edge)?\s*:/i, 'outlined type and text-box trim — a wordmark that is a shape, and headings spaced from the letterforms rather than the line box.'),
      T('fluid-type', 'type', 2, /font-size\s*:\s*clamp\(|--[\w-]*(?:step|size|type|text|font|scale)[\w-]*\s*:\s*clamp\(/i, 'fluid type with clamp() — a scale that interpolates instead of three breakpoints of guessed pixels.'),
      T('editorial-type', 'type', 2, /initial-letter\s*:|::first-letter|hanging-punctuation\s*:|writing-mode\s*:\s*(?:vertical|sideways)/i, 'drop caps, hanging punctuation, vertical running heads — editorial weight from one rule each.'),
      T('typed-property', 'time', 3, /@property\s+--/i, '@property — typed custom properties, the ONLY way to animate a gradient stop, an angle or a colour ramp. Unlocks motion CSS otherwise cannot do at all.'),
      T('scroll-driven', 'time', 3, /animation-timeline\s*:|scroll-timeline|view-timeline|animation-range\s*:/i, 'scroll-driven animation — animation-timeline: view(), tied to scroll by the compositor with no listener and no library.'),
      T('view-transition', 'time', 3, /view-transition-name\s*:|startViewTransition|::view-transition/i, 'View Transitions — an element that MORPHS between states or routes. Everything else crossfades; this is the difference people call native.'),
      T('starting-style', 'time', 2, /@starting-style|transition-behavior\s*:\s*allow-discrete/i, '@starting-style with allow-discrete — dialogs and popovers that animate in as well as out.'),
      T('offset-path', 'time', 2, /offset-path\s*:|offset-distance\s*:/i, 'offset-path — movement along a drawn curve instead of a straight tween.'),
      T('draw-on', 'time', 2, /stroke-dash(?:array|offset)/i, 'stroke-dashoffset — a line, signature or diagram that draws itself.'),
      T('stagger', 'time', 2, /stagger|animation-delay\s*:\s*calc\(|--(?:i|index)\s*\)\s*\*/i, 'a stagger — children 30–50ms apart so the eye is led to the last one, instead of everything arriving at once.'),
      T('reduced-motion', 'time', 1, /prefers-reduced-motion/i, 'prefers-reduced-motion — the floor for anything that moves, not a feature.'),
      T('spring', 'response', 2, /type\s*:\s*["']spring["']|stiffness\s*:|useSpring|damping\s*:/i, 'spring physics — for anything dragged, thrown or toggled, where a fixed duration is the wrong model.'),
      T('has', 'response', 2, /:has\(/i, ':has() — style a parent from its children: a form that knows it has an error, a card that knows it has an image.'),
      T('focus-visible', 'response', 2, /:focus-visible/i, 'a designed :focus-visible ring — the keyboard state is a surface most work never draws.'),
      T('pointer-reactive', 'response', 3, /--(?:mx|my|mouse|pointer)[-\w]*\s*:|onPointerMove|pointermove|setProperty\(\s*['"]--(?:x|y|mx|my)/i, 'a surface that tracks the pointer through a custom property — light that follows the cursor, a card that tilts, a mask that reveals.'),
      T('popover-dialog', 'response', 2, /\bpopover\b|<dialog|showModal\(/i, 'native popover and <dialog> — top layer, light dismiss and focus handling for free.'),
      T('scroll-snap', 'response', 1, /scroll-snap-(?:type|align)\s*:/i, 'scroll snap — a run of items that lands where it should, natively.'),
      T('selection-surfaces', 'response', 1, /::selection|caret-color\s*:|accent-color\s*:|cursor\s*:\s*url\(/i, '::selection, caret-color, accent-color, a custom cursor — the parts of the UI the browser owns, carrying your palette.'),
      T('data-driven-style', 'variation', 3, /setProperty\(\s*['"]--|style\.setProperty|style=\{\{[^}]*\$\{|attr\(/i, 'style driven by data or state — the piece differs per row, per value, per user, instead of rendering one fixed picture.'),
      T('theme-variation', 'variation', 1, /light-dark\(|color-scheme\s*:|prefers-color-scheme/i, 'light-dark() and colour scheme — the piece has more than one appearance.'),
    ],
  },
  {
    id: 'svg', label: 'SVG',
    detect: /<svg[\s>]|xmlns="http:\/\/www\.w3\.org\/2000\/svg"|\.svg\b/i,
    techniques: [
      T('svg-filter-primitive', 'generative', 3, /<feTurbulence|<feDisplacementMap|<feColorMatrix|<feComposite|<feMorphology/i, 'filter primitives — turbulence for grain, displacement for a torn edge, a colour matrix for duotone, morphology for chokes and spreads.'),
      T('pattern-fill', 'generative', 2, /<pattern[\s>]/i, 'a pattern fill — hatching, halftone or a tile drawn once and used as paint.'),
      T('gradient-transform', 'material', 2, /gradientTransform|<radialGradient|spreadMethod/i, 'transformed and radial gradients — light with a position and a direction rather than a flat wash.'),
      T('clip-mask', 'structure', 2, /<clipPath|<mask[\s>]|mask=|clip-path=/i, 'clipPath and mask — artwork cropped to a drawn shape or faded by a gradient.'),
      T('text-path', 'type', 3, /<textPath|startOffset/i, 'text on a path — type that follows a curve, the one typographic move the web cannot otherwise make.'),
      T('markers', 'structure', 1, /<marker[\s>]|marker-end=/i, 'markers — arrowheads and joints that follow the path automatically.'),
      T('path-anim', 'time', 3, /<animate[\s>]|<animateTransform|<animateMotion|pathLength=/i, 'SMIL or path animation — a shape becoming another shape, with no library.'),
      T('vector-effect', 'structure', 1, /vector-effect\s*[:=]/i, 'vector-effect: non-scaling-stroke — hairlines that stay hairlines at any zoom.'),
      T('symbol-use', 'variation', 2, /<symbol[\s>]|<use[\s>]/i, 'symbol and use — one definition instanced many times, each transformable.'),
      T('filter-lighting', 'depth', 3, /<feDiffuseLighting|<feSpecularLighting|<feDistantLight|<fePointLight/i, 'SVG lighting filters — a real light source over a bump map: embossed, engraved or lit vector art.'),
    ],
  },
  {
    id: 'canvas', label: 'canvas 2D',
    detect: /getContext\(\s*["']2d["']|new\s+Path2D|createImageData|putImageData/i,
    techniques: [
      T('composite-op', 'material', 3, /globalCompositeOperation/i, 'composite operations — lighter, multiply, destination-out. Additive light, knockouts and erasers instead of stacked opaque shapes.'),
      T('pixel-manipulation', 'generative', 3, /getImageData|putImageData|createImageData/i, 'working the pixels directly — dithering, palette mapping, feedback, displacement. What canvas can do that the DOM cannot.'),
      T('noise-field', 'generative', 3, /simplex|perlin|noise\d?D|\bfbm\b|value ?noise/i, 'a noise field — one function producing a thousand coherent marks nobody had to draw.'),
      T('particles', 'generative', 2, /particles?\b|emitter\b/i, 'a particle or agent system — emergent texture from a simple per-agent rule.'),
      T('physics-sim', 'response', 3, /velocity|acceleration|\bdamping\b|gravity/i, 'simulation — velocity, damping and forces, so movement is derived rather than keyframed.'),
      T('canvas-pattern', 'material', 2, /createPattern|createRadialGradient|createConicGradient/i, 'patterns and non-linear gradients as paint sources.'),
      T('offscreen', 'depth', 2, /OffscreenCanvas|drawImage\(\s*(?:canvas|buffer|off|this\.buf)/i, 'a second buffer — trails, feedback, blur passes and layering a single context cannot do.'),
      T('path2d', 'structure', 1, /new Path2D|isPointInPath/i, 'Path2D — reusable geometry, and real hit-testing on a drawn shape.'),
      T('seeded-random', 'variation', 3, /mulberry32|xorshift|\bseed\b|PRNG/i, 'a seeded generator — every render different, and any one of them reproducible. The difference between a piece and a print.'),
      T('dpr-aware', 'material', 1, /devicePixelRatio/i, 'devicePixelRatio scaling — otherwise every line is soft on the screens people own.'),
      T('canvas-type', 'type', 2, /measureText|textBaseline|fillText/i, 'type measured and placed rather than centred by eye — canvas gives you the metrics, so use them.'),
    ],
  },
  {
    id: 'shader', label: 'shader / GPU',
    detect: /gl_FragColor|gl_Position|@fragment\b|getContext\(\s*["']webgl|ShaderMaterial|\.frag\b|\.glsl\b|\.wgsl\b|\.hlsl\b|HLSLPROGRAM/i,
    techniques: [
      T('sdf', 'structure', 3, /\bsdf\b|signed ?distance|smoothstep\s*\([^)]*length/i, 'signed distance fields — resolution-independent shapes with exact edges, unions, subtractions and glow for free.'),
      T('raymarch', 'depth', 3, /raymarch|ray ?march|rayDirection|marchStep/i, 'raymarching — real volume and depth from a distance function, not a textured quad.'),
      T('fbm-noise', 'generative', 3, /\bfbm\b|fractal ?brownian|octaves/i, 'fbm — layered noise at halving amplitude. Cloud, marble, terrain and smoke all come from this one loop.'),
      T('domain-warp', 'generative', 3, /domain ?warp|noise\s*\(\s*p\s*\+\s*noise/i, 'domain warping — noise displacing the coordinates of noise. The step from procedural texture to something that looks made.'),
      T('dither', 'material', 3, /bayer|dither|blue ?noise/i, 'dithering — banding removed, or leaned into as a visible halftone. Almost nobody does either.'),
      T('chromatic', 'material', 2, /chromatic|aberration/i, 'chromatic aberration and per-channel sampling — a lens rather than a filter.'),
      T('post-chain', 'material', 2, /EffectComposer|RenderPass|Bloom|postprocessing|renderTarget|framebuffer/i, 'a post chain — bloom, grade and grain on the rendered image, which is where most of the look lives.'),
      T('instancing', 'structure', 3, /InstancedMesh|drawArraysInstanced|gl_InstanceID|instanceMatrix/i, 'instancing — thousands of objects at one draw call, each with its own transform.'),
      T('feedback', 'time', 3, /ping ?pong|previousFrame|feedback|swapBuffers/i, 'frame feedback — this frame reading the last one. Trails, fluid, reaction-diffusion, decay.'),
      T('gpgpu', 'generative', 3, /GPUComputationRenderer|compute ?shader|@compute\b|storageBuffer/i, 'GPGPU — simulation state living on the GPU, so a million particles is cheap.'),
      T('uniform-time', 'time', 1, /uniform\s+float\s+(?:u_)?time|iTime/i, 'time as a uniform — the minimum for anything that lives.'),
      T('lut-grade', 'material', 2, /\bLUT\b|colou?rGrade|ACESFilm|tonemap/i, 'a colour LUT or tonemap — the grade that makes rendered output look photographed rather than computed.'),
      T('mouse-uniform', 'response', 2, /uniform\s+vec2\s+(?:u_)?mouse|iMouse|uMouse/i, 'the pointer as a uniform — the surface answers the viewer instead of playing at them.'),
      T('seed-uniform', 'variation', 2, /uniform\s+float\s+(?:u_)?seed|hash\s*\(|rand\s*\(\s*vec2/i, 'a seed or hash — the same shader producing a different piece each run.'),
    ],
  },
  {
    id: 'three', label: '3D scene',
    detect: /from ['"]three|new THREE\.|@react-three\/fiber|BABYLON\./i,
    techniques: [
      T('custom-material', 'material', 3, /ShaderMaterial|onBeforeCompile|MeshTransmissionMaterial|CustomShaderMaterial/i, 'a custom or transmission material — the difference between a rendered object and a stock grey ball.'),
      T('env-lighting', 'material', 3, /Environment\b|PMREMGenerator|RGBELoader|envMap|HDRI/i, 'image-based lighting from an HDRI — the biggest single step from 3D demo to photographed.'),
      T('shadow-quality', 'depth', 2, /shadowMap|castShadow|ContactShadows|AccumulativeShadows/i, 'real contact shadows — an object standing on something rather than floating.'),
      T('post-3d', 'material', 2, /EffectComposer|Bloom|DepthOfField|SSAO|N8AO|ToneMapping/i, 'post-processing — depth of field, ambient occlusion, bloom, a tonemap.'),
      T('instanced-3d', 'structure', 3, /InstancedMesh|<Instances|instancedMesh/i, 'instancing — a field of thousands of objects at one draw call.'),
      T('scroll-camera', 'response', 3, /ScrollControls|useScroll|useFrame|lerp\(/i, 'a camera driven by scroll or pointer, damped — the viewer moves through the scene rather than watching it.'),
      T('morph-skin', 'time', 2, /morphTargetInfluences|SkinnedMesh|AnimationMixer/i, 'morph targets and skinned animation — geometry that deforms rather than transforms.'),
      T('procedural-geo', 'generative', 3, /BufferGeometry\(\)|setAttribute\(\s*['"]position|MarchingCubes|ParametricGeometry/i, 'geometry built in code — shape derived from a rule or from data rather than loaded.'),
      T('raycast-interaction', 'response', 2, /Raycaster|onPointerOver|useCursor/i, 'raycast interaction — the scene answers the pointer.'),
      T('seeded-scene', 'variation', 2, /\bseed\b|Math\.random\(\)/i, 'a seeded arrangement — different every load, reproducible on demand.'),
      T('scene-type', 'type', 2, /TextGeometry|troika|Text3D|<Text\b/i, 'type in the scene, set rather than pasted on a plane.'),
    ],
  },
  {
    id: 'native', label: 'native / mobile UI',
    detect: /import SwiftUI|struct\s+\w+\s*:\s*View\b|androidx\.compose|@Composable|package:flutter|StatelessWidget|StatefulWidget/i,
    techniques: [
      T('shared-element', 'time', 3, /matchedGeometryEffect|SharedTransitionLayout|Hero\s*\(|sharedElement/i, 'a shared-element transition — one element travelling between screens instead of two screens crossfading.'),
      T('custom-drawing', 'generative', 3, /Canvas\s*\{|CustomPainter|drawBehind\s*\{|drawIntoCanvas|Path\(\)/i, 'a custom drawing layer — the platform stops being a set of stock controls.'),
      T('shader-effect', 'material', 3, /visualEffect|colorEffect|distortionEffect|layerEffect|ShaderMask|RenderEffect|AGSL|SkSL/i, 'a shader effect on a live view — distortion, grain, gradient masking, applied to real UI.'),
      T('timeline-driven', 'time', 3, /TimelineView|PhaseAnimator|KeyframeAnimator|rememberInfiniteTransition|AnimationController/i, 'timeline and phase animation — a sequence with phases rather than one interpolation.'),
      T('spring-native', 'response', 2, /\.spring\(|SpringSpec|dampingFraction|CurvedAnimation|withAnimation/i, 'spring animation — the platform default is a duration; a spring is how the platform actually feels.'),
      T('gesture-driven', 'response', 3, /DragGesture|detectDragGestures|GestureDetector|onPanUpdate|\.gesture\(/i, 'gesture-driven motion — the animation follows the finger instead of playing at it.'),
      T('haptics', 'response', 2, /UIImpactFeedback|sensoryFeedback|HapticFeedback|Vibration/i, 'haptics — the one channel native has that the web does not.'),
      T('material-depth', 'depth', 2, /ultraThinMaterial|\.regularMaterial|blurRadius|BackdropFilter|tonalElevation|shadowRadius/i, 'real material and elevation — blur and tonal elevation the system computes.'),
      T('dynamic-type', 'type', 2, /dynamicTypeSize|MaterialTheme\.typography|textTheme|\.font\(\s*\./i, 'the type system with dynamic type — a scale that respects the reader’s own setting.'),
      T('adaptive-layout', 'structure', 2, /ViewThatFits|GeometryReader|BoxWithConstraints|LayoutBuilder|WindowSizeClass/i, 'layout that measures itself — one view correct on a phone, a fold and a tablet.'),
      T('data-bound-visual', 'variation', 2, /ForEach\s*\(|LazyColumn|ListView\.builder|items\s*\(/i, 'a visual bound to real data, so it differs per row rather than being a fixed mock.'),
      T('palette-native', 'material', 2, /LinearGradient|Brush\.|AngularGradient|MeshGradient|\.tint\(/i, 'gradients and tints as material rather than a flat fill.'),
    ],
  },
  {
    id: 'game', label: 'game / engine',
    detect: /UnityEngine|MonoBehaviour|SpriteBatch|using Godot|extends (?:Node|Sprite|CharacterBody)|_process\s*\(|GetNode/i,
    techniques: [
      T('juice-scale', 'time', 3, /squash|stretch|punch|localScale|DOPunch/i, 'squash and stretch on hit, land and pickup — the cheapest juice there is, and the most missed.'),
      T('screenshake', 'response', 2, /shake|trauma/i, 'screen shake driven by trauma that decays, not a fixed jitter.'),
      T('hitstop', 'time', 3, /hitstop|hit ?stop|freeze ?frame|timeScale|time_scale/i, 'hitstop — a few frames of frozen time on impact. The largest perceived-weight gain in any action game.'),
      T('easing-curves', 'time', 2, /AnimationCurve|Tween|SmoothStep|ease_|\bCurve\b/i, 'authored easing curves rather than linear lerps.'),
      T('particles-vfx', 'generative', 2, /ParticleSystem|GPUParticles|CPUParticles|Emitter/i, 'particles — dust on landing, sparks on impact, motes in the light.'),
      T('shader-material', 'material', 3, /\bShader\b|ShaderMaterial|Surface Shader|HLSLPROGRAM|CGPROGRAM/i, 'a custom shader — dissolve, outline, palette swap, water. Stock materials are the flat look.'),
      T('palette-lut', 'material', 2, /palette|\bLUT\b|ColorGrading|posterize/i, 'a palette or grade applied globally — the strongest single art-direction lever in a game.'),
      T('lighting-2d', 'depth', 3, /Light2D|normal ?map|PointLight2D|CanvasModulate/i, 'real lights and normal maps, even in 2D — depth on a sprite a flat tint cannot give.'),
      T('camera-feel', 'response', 3, /Cinemachine|look ?ahead|deadzone|camera[\s\S]{0,40}(?:lerp|smooth|damp)/i, 'a camera with lead, damping and a deadzone — most of what feels good is the camera.'),
      T('procedural-content', 'generative', 3, /\bnoise\b|Random\.(?:Range|value)|\bseed\b|GenerateLevel|wave ?function/i, 'procedural content — levels, textures or props derived from a rule and a seed.'),
      T('audio-reactive', 'response', 2, /AudioSource|PlayOneShot|AudioStreamPlayer|\bpitch\b/i, 'sound tied to the visual event, with pitch variation so it never repeats identically.'),
      T('instance-variation', 'variation', 2, /RandomRange|variant|shuffle|RandomChoice/i, 'variation per instance — the same prop never appearing twice identically.'),
      T('ui-type-game', 'type', 2, /TextMeshPro|TMP_|Label ?Settings|BitmapFont/i, 'game type set properly — TextMeshPro or a real bitmap font rather than the default label.'),
    ],
  },
  {
    id: 'tui', label: 'terminal / TUI',
    detect: /\[|\\x1b\[|\\033\[|\\u001b\[|blessed|ratatui|curses|from ['"]ink['"]|chalk\.|rich\.|termion|crossterm|tcell|bubbletea|lipgloss/i,
    techniques: [
      T('truecolor', 'material', 3, /[34]8;2;|truecolou?r|\bhex\(|setRgb|rgbToAnsi/i, '24-bit colour — the 16-colour palette is a constraint from 1985, not a style.'),
      T('box-drawing', 'structure', 2, /[─-╿]/u, 'box-drawing characters — real rules and frames instead of dashes and pipes.'),
      T('block-braille', 'generative', 3, /[▀-▟]|[⠀-⣿]/u, 'block and braille glyphs — a 2×4 pixel grid per cell, which is how a terminal draws a real chart or an image.'),
      T('gradient-text', 'material', 2, /gradient|interpolate[\s\S]{0,20}colou?r/i, 'a gradient across a run of text or a bar — colour as data, not decoration.'),
      T('sparkline', 'generative', 2, /sparkline|histogram|[▁-█]{3}/u, 'sparklines and inline histograms — data in the width of a word.'),
      T('alt-screen', 'structure', 2, /\?1049h|alternate ?screen|smcup|altScreen/i, 'the alternate screen — a full-screen application that leaves the scrollback intact on exit.'),
      T('frame-loop', 'time', 3, /cursor ?up|render ?loop|\b2J\b|clearLine|moveCursor|cursorTo|\bredraw\b|\[\d*A\b/i, 'redraw in place — a live view rather than a wall of appended lines.'),
      T('mouse-input', 'response', 2, /\?100[06]h|mouse ?event|enableMouse/i, 'mouse reporting — a TUI that can be clicked.'),
      T('width-aware', 'structure', 2, /stringWidth|wcwidth|unicode[_ ]?width/i, 'grapheme-aware width — the difference between a table that aligns and one that shears on emoji or CJK.'),
      T('degrade', 'variation', 2, /NO_COLOR|isTTY|supportsColor|\bTERM\b/i, 'degrading honestly with no TTY or no colour, instead of writing escapes into a log file.'),
      T('tui-type', 'type', 2, /figlet|banner|bold[\s\S]{0,20}dim|italic/i, 'weight and scale in a monospace grid — hierarchy without a second font.'),
    ],
  },
  {
    id: 'dataviz', label: 'data visualisation',
    detect: /from ['"]d3|d3\.(?:scale|select|axis)|chart\.js|new Chart\(|\bvega\b|observable ?plot|recharts|echarts/i,
    techniques: [
      T('perceptual-scale', 'material', 3, /interpolateLab|interpolateHcl|interpolateCubehelix|oklch|scaleSequential/i, 'colour interpolated in a perceptual space — the difference between a scale that reads as ordered and one with false bright bands.'),
      T('nonlinear-scale', 'structure', 3, /scaleLog|scaleSqrt|scalePow|scaleSymlog|scaleQuantile/i, 'a non-linear scale chosen because the data is non-linear, rather than linear by default.'),
      T('direct-labelling', 'type', 3, /append\(\s*['"]text|labelPosition|\.text\(/i, 'direct labelling on the marks — a legend is a lookup table the reader has to hold in their head.'),
      T('annotation-layer', 'type', 3, /annotation|callout|reference ?line|threshold/i, 'annotation — the chart says what it means instead of leaving the reader to find it.'),
      T('small-multiples', 'structure', 3, /facet|small ?multiple|trellis/i, 'small multiples — one shape repeated across a dimension. Almost always better than the dual-axis chart it replaces.'),
      T('bespoke-mark', 'generative', 3, /d3\.(?:arc|line|area|symbol|linkHorizontal)|customMark/i, 'a mark drawn for this data rather than a bar or a line picked from a menu.'),
      T('state-transition', 'time', 3, /\.transition\(\)|enter\(\)[\s\S]{0,200}?exit\(\)/i, 'transitions between data states — object constancy, so the reader can follow a value moving.'),
      T('interaction-detail', 'response', 2, /brush|\bzoom\b|tooltip|voronoi/i, 'brushing, zoom or a Voronoi hit layer — detail on demand rather than everything at once.'),
      T('uncertainty', 'material', 3, /confidence|error ?bar|interval|stddev|quantile/i, 'uncertainty drawn — an estimate presented as a point is a claim the data cannot support.'),
      T('data-driven-layout', 'variation', 2, /d3\.(?:force|hierarchy|treemap|pack|stack)/i, 'layout computed from the data — force, hierarchy, treemap or pack rather than a fixed frame.'),
      T('depth-encoding', 'depth', 2, /opacity[\s\S]{0,40}(?:scale|data)|z ?index[\s\S]{0,40}sort|overplot/i, 'layering that handles overplotting — sorted draw order or alpha that encodes density.'),
    ],
  },
  {
    id: 'print', label: 'print / physical',
    detect: /@page\s*\{[^}]*\bsize\s*:|\bbleed\b|pantone|\bcmyk\b|spot ?colou?r|letterpress|die-?cut/i,
    techniques: [
      T('spot-colour', 'material', 3, /pantone|spot ?colou?r|PMS ?\d|separation/i, 'a spot colour — a hue offset printing cannot mix, and the reason a piece looks printed rather than output.'),
      T('special-finish', 'material', 3, /foil|emboss|deboss|letterpress|spot ?(?:uv|varnish)|soft ?touch|edge ?paint/i, 'a finish — foil, deboss, spot varnish, painted edges. Boldness spent on the object rather than on the layout.'),
      T('stock-choice', 'material', 3, /\bgsm\b|\blb ?(?:cover|text)\b|uncoated|colorplan|duplex|\bstock\b/i, 'the stock as a design decision — weight, colour and texture carry more than any choice made on the page.'),
      T('die-cut', 'structure', 3, /die-?cut|perforat|score ?line|fold ?line|kiss ?cut/i, 'a die-cut, fold or perforation — the piece stops being a rectangle.'),
      T('overprint', 'material', 2, /overprint|knockout|trap(?:ping)?/i, 'overprint and trapping — two inks interacting, which is a look screens have to fake.'),
      T('halftone', 'generative', 2, /halftone|screen ?angle|\blpi\b|duotone|\briso\b/i, 'halftone, duotone or Riso separation — texture from the process itself.'),
      T('grid-print', 'structure', 2, /baseline ?grid|column ?grid|gutter|\bpica\b/i, 'a baseline grid in real units — the invisible structure that makes a page feel typeset.'),
      T('scale-jump', 'type', 3, /\d{2,3}\s*(?:pt|mm)\b[\s\S]{0,400}?\b[6-9](?:\.\d)?\s*pt\b/i, 'a real scale jump — display type against small text, which paper permits and screens rarely do.'),
      T('reverse-side', 'structure', 2, /\bverso\b|reverse ?side|back\.html|second ?page/i, 'the back of the piece as a designed surface, not a blank.'),
      T('variable-data', 'variation', 3, /variable ?data|\bVDP\b|per-?recipient|numbered ?edition/i, 'variable data — every copy different: a number, a name, a colourway.'),
    ],
  },
]

// ── Project extension ────────────────────────────────────────────────────────────────────────
function loadExtensions(cwd) {
  const roots = [
    join(cwd, '.cgc', 'techniques.json'),
    join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'techniques.json'),
  ]
  const media = []
  for (const p of roots) {
    if (!existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      for (const m of raw.media || []) {
        if (!m || !m.id || !Array.isArray(m.techniques)) continue
        media.push({
          id: String(m.id), label: String(m.label || m.id), source: p,
          detect: new RegExp(String(m.detect || 'a^'), 'i'),
          techniques: m.techniques.filter((t) => t && t.id && t.re).map((t) => T(
            String(t.id), DIMS.includes(t.dim) ? t.dim : 'material',
            [1, 2, 3].includes(t.lift) ? t.lift : 2, new RegExp(String(t.re), 'i'), String(t.what || t.id))),
        })
      }
    } catch { /* a broken extension file is ignored, never fatal */ }
  }
  return media
}

export function registry(cwd = process.cwd()) {
  const out = new Map(MEDIA.map((m) => [m.id, m]))
  for (const ext of loadExtensions(cwd)) {
    const base = out.get(ext.id)
    if (!base) { out.set(ext.id, ext); continue }
    const techniques = new Map(base.techniques.map((t) => [t.id, t]))
    for (const t of ext.techniques) techniques.set(t.id, t)
    out.set(ext.id, { ...base, label: ext.label || base.label, source: ext.source, techniques: [...techniques.values()] })
  }
  return [...out.values()]
}

// Flat view for callers that want every shipped technique regardless of medium.
export const TECHNIQUES = MEDIA.flatMap((m) => m.techniques.map((t) => ({ ...t, medium: m.id })))

export function measure(text, { ext = '', cwd = process.cwd() } = {}) {
  const reg = registry(cwd)
  const hay = ext ? `${text}\n${ext}` : text
  let media = reg.filter((m) => m.detect.test(hay))
  // A file in no recognised medium is still measured against the broadest vocabulary rather
  // than being called empty — silence would read as approval. Callers that must not give web
  // advice to a file that is not web read `detected`.
  const detected = media.length > 0
  if (!media.length) media = reg.filter((m) => m.id === 'web')

  const seen = new Map()
  for (const m of media) for (const t of m.techniques) if (!seen.has(t.id)) seen.set(t.id, { ...t, medium: m.id })
  const all = [...seen.values()]
  const used = all.filter((t) => t.re.test(text))
  const usedIds = new Set(used.map((t) => t.id))

  const byDim = Object.fromEntries(DIMS.map((d) => [d, used.filter((t) => t.dim === d).length]))
  // A dimension counts as untouched only if this piece's media can express it at all: asking a
  // stylesheet about frame feedback is not a finding, it is a category error.
  const available = new Set(all.map((t) => t.dim))
  const untouched = DIMS.filter((d) => available.has(d) && byDim[d] === 0)

  const n = used.length
  const verdict = n <= 1 ? 'assembled' : n <= 4 ? 'conventional' : n <= 8 ? 'considered' : 'ambitious'
  // Suggest into the thinnest dimensions first, highest lift next: widen what the piece does
  // rather than piling more of what it already does.
  const missing = all.filter((t) => !usedIds.has(t.id))
    .sort((a, b) => (byDim[a.dim] - byDim[b.dim]) || (b.lift - a.lift) || a.id.localeCompare(b.id))

  return {
    media: media.map((m) => ({ id: m.id, label: m.label })),
    detected, used, usedIds, byDim, untouched, count: n, pool: all.length, verdict, missing,
  }
}

function walk(p, out = []) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue
      walk(join(p, e), out)
    }
  } else if (EXTS.has(extname(p).toLowerCase())) out.push(p)
  return out
}

const HELP = `usage:
  cgc techniques <file|dir> [<file|dir>…] [--min <n>] [--all] [--json]
  cgc techniques --media

Detects the MEDIUM (web, SVG, canvas, shader, 3D, native, game, TUI, data-viz, print), measures
the piece against that medium's own vocabulary, and names the expressive DIMENSIONS it never
entered: material, structure, type, time, depth, response, generative, variation.

Verdicts: assembled (0–1 techniques), conventional (2–4), considered (5–8), ambitious (9+).
--min <n> exits 1 below that count. Quantity is not quality — a technique that could be removed
without the piece reading differently was decoration — but a piece that reaches for none of them
was assembled rather than designed.

Extend it without touching this tool: <cwd>/.cgc/techniques.json or <config root>/techniques.json,
of the form { "media": [ { "id", "label", "detect", "techniques": [ { "id", "dim", "lift", "re", "what" } ] } ] },
with detect and re as regex source strings. Same-id entries merge over the shipped ones.
`

export function main(argv = process.argv.slice(2)) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i]; else args[k] = true }
    else args._.push(a)
  }
  if (args.media) {
    for (const m of registry()) {
      console.log(`\n  \x1b[1m${m.label}\x1b[0m  (${m.id}, ${m.techniques.length} techniques${m.source ? ', extended by ' + m.source : ''})`)
      for (const t of m.techniques) console.log(`    \x1b[2m${t.dim.padEnd(11)}\x1b[0m ${t.what}`)
    }
    console.log('')
    return 0
  }
  if (args.help || !args._.length) { console.log(HELP); return args.help ? 0 : 1 }

  const files = []
  for (const p of args._) {
    try { walk(resolve(p), files) } catch { console.error(`techniques: no such file — ${p}`); return 1 }
  }
  if (!files.length) { console.error('techniques: nothing to read — no design or source files at those paths'); return 1 }

  let text = ''
  let exts = ''
  for (const f of files) { try { text += readFileSync(f, 'utf8') + '\n'; exts += extname(f) + '\n' } catch {} }
  const m = measure(text, { ext: exts })
  const min = args.min ? Number(args.min) : 0

  if (args.json) {
    console.log(JSON.stringify({
      files: files.length, media: m.media, detected: m.detected, count: m.count, pool: m.pool, verdict: m.verdict,
      byDimension: m.byDim, untouched: m.untouched.map((d) => ({ dim: d, ask: DIMENSIONS[d].ask })),
      used: m.used.map((t) => ({ id: t.id, dim: t.dim })),
      missing: m.missing.slice(0, 12).map((t) => ({ id: t.id, dim: t.dim, what: t.what })),
    }, null, 2))
    return m.count >= min ? 0 : 1
  }

  const colour = { assembled: '\x1b[31m', conventional: '\x1b[33m', considered: '\x1b[36m', ambitious: '\x1b[32m' }[m.verdict]
  console.log(`\n  ${files.length} file${files.length === 1 ? '' : 's'} · ${m.media.map((x) => x.label).join(' + ')} · ${colour}${m.verdict}\x1b[0m · ${m.count} of ${m.pool}`)
  console.log('  ' + DIMS.map((d) => `${d} ${m.byDim[d]}`).join(' · '))
  if (m.used.length) {
    console.log('\n  \x1b[1mreaches for\x1b[0m')
    for (const t of m.used) console.log(`    \x1b[2m${t.dim.padEnd(11)}\x1b[0m ${t.id}`)
  }
  if (m.untouched.length) {
    console.log('\n  \x1b[1mdimensions it never entered\x1b[0m — questions about the piece, not features to add')
    for (const d of m.untouched) console.log(`    \x1b[1m${d}\x1b[0m — ${DIMENSIONS[d].ask}`)
  }
  const suggest = m.missing.slice(0, args.all ? m.missing.length : 8)
  if (suggest.length) {
    console.log(`\n  \x1b[1mnever tried\x1b[0m${args.all ? '' : ` (${m.missing.length} absent; the ${suggest.length} that would widen it most)`}`)
    for (const t of suggest) console.log(`    \x1b[2m${t.dim.padEnd(11)}\x1b[0m ${t.what}`)
  }
  console.log(m.verdict === 'assembled'
    ? '\n  \x1b[31mThis was assembled, not designed.\x1b[0m Nothing here does anything a default cannot. Answer the dimension questions first — they change what the piece IS — then pick the technique that serves the answer.\n'
    : m.verdict === 'conventional'
      ? '\n  Correct and unremarkable, which is the ceiling rather than the floor. Take a dimension it never entered and decide whether that was a choice; if it was not, it is the largest single move available.\n'
      : '\n  Now check they are load-bearing: a technique that could be removed without the piece reading differently was decoration.\n')
  if (m.count < min) { console.error(`  \x1b[31mbelow the floor\x1b[0m: ${m.count} < ${min}`); return 1 }
  return 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) process.exit(main())
