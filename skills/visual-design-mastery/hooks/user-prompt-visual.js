// UserPromptSubmit hook: put the visual-design-mastery mandate in front of the model whenever
// a prompt is about drawing something a human will look at — in ANY language, not just React —
// and route paper, fabric and the other fields to their own skills.
//
// Deliberately conditional, and deliberately careful about it: a hook that fires on "between
// the two functions" (tween), "increasing the timeout" (easing), "GraphQL" (graph), "discard"
// (card) or "pipe it through tee" (tee) gets deleted within a day, and then it fires on nothing.
// So a term fires on its own only when it cannot be part of an ordinary sentence about code;
// a word that is visual in a design sentence and ordinary everywhere else fires only beside a
// word that says the prompt is about something seen.

const path = require('node:path')

const rx = (terms) => new RegExp(terms.join('|'), 'i')

// Fires alone. Every generic word is anchored to a whole word.
const STRONG = rx([
  // general design / UI
  'user interface', '\\bux\\b', '\\bui\\b', '\\bdesign\\b', 'redesign', '\\bstyl(e|ing)\\b', '\\btheme\\b', '\\bpalette\\b',
  'colou?r scheme', 'typograph', '\\bfonts?\\b', '\\blayout\\b', '\\baesthetic', 'polish the look',
  'make it (look|beautiful|pretty|nicer)', 'mock-?ups?', 'landing page', 'dashboard', 'hero section', 'front-?end', 'navbar',
  // motion
  'animat', 'micro-?interaction', 'parallax', 'scroll(-| )?(driven|trigger)', 'keyframe',
  'fades? (in|out)', 'slides? (in|out|up|down)', '\\bmodals?\\b', '\\btooltips?\\b', '\\bdrawer\\b', '\\baccordion\\b',
  '\\bspinners?\\b', 'loading (indicator|animation)', 'page transitions?',
  // art / gpu
  'shader', '\\bglsl\\b', '\\bhlsl\\b', 'webgl', 'webgpu', 'three\\.?js', 'particle (system|effect)', 'creative coding',
  'p5\\.?js', 'processing sketch', 'raymarch', 'noise field', 'flow field', 'generative (art|visual|design)',
  // games
  'spritebatch', 'monogame', '\\bgodot\\b', 'game feel', '\\bjuice\\b', 'screen ?shake', 'pixel art', 'tilemap', '\\bsprites?\\b',
  // native / mobile
  'swiftui', 'jetpack compose', '\\bflutter\\b', '\\bwinui\\b', '\\bwpf\\b',
  // dataviz / terminal
  '\\bcharts?\\b(?! of accounts)', 'data ?vis', 'visuali[sz]ation', '\\btui\\b', 'terminal (ui|art|colou?r)', 'ascii art',
  // print
  'business card', '\\bflyers?\\b', '\\bposters?\\b', 'brochure', 'postcard', '\\bstickers?\\b', 'letterhead', 'menu design',
  'print-?ready', '\\bbleed\\b', '\\bcmyk\\b', 'pantone', 'letterpress', 'die-?cut',
  // apparel
  't-?shirts?', 'tee shirt', 'hoodie', 'sweatshirt', 'baseball cap', 'snapback', 'tote bag', '\\bmerch\\b', 'screen ?print',
  '\\bdtg\\b', 'embroider', 'heat transfer', 'apparel', 'garment',
  // the other fields
  '\\blogos?\\b', 'wordmark', 'brand identity', 'favicon', 'app icon', 'icon set', 'infographic', 'social (post|media)',
  'instagram', 'thumbnail', 'youtube', 'open graph', '\\bog image', 'slide deck', 'pitch deck', 'presentation',
  'email template', 'newsletter design', 'label design', 'signage', 'wayfinding', 'book cover', 'album (art|cover)',
  'motion graphics', 'title sequence',
])

// Fires only with CONTEXT: visual in a design sentence, ordinary everywhere else.
const WEAK = rx([
  '\\bvisuals?\\b(?! studio)', '\\bgraphs?\\b', '\\bcards?\\b', '\\bbuttons?\\b', '\\bcomponents?\\b', '\\bplots?\\b',
  '\\btransitions?\\b', '\\btween\\b', '\\beasing\\b', '\\bmotion\\b', '\\bart\\b', '\\bdraw(ing)? (a|the|it|to)\\b',
  '\\brender(er|ing)?\\b', '\\bpatterns?\\b', '\\bslides?\\b', '\\bicons?\\b', '\\billustrations?\\b', '\\bdiagrams?\\b',
  '\\bstory\\b', '\\bstories\\b', '\\bpackaging\\b', '\\binvitations?\\b', '\\bbanners?\\b', '\\btee\\b', '\\bjersey\\b',
  '\\bmenu\\b', '\\bmaps?\\b', '\\btextile\\b', '\\bunity\\b', '\\bcolou?rs?\\b', '\\bsketch\\b',
])
// The company a weak word needs.
const CONTEXT = rx([
  '\\bvisual\\b(?! studio)', '\\blook\\b', '\\bbeautiful\\b', '\\bpretty\\b', '\\bstyle[ds]?\\b', '\\blayout\\b', '\\bbrand(ing)?\\b',
  '\\bartwork\\b', '\\bgraphics?\\b', 'mock-?up', '\\bdraw\\b', '\\banimat', '\\bui\\b', '\\bux\\b', '\\bscreen\\b',
  '\\bprint', '\\blogo', '\\bicon', '\\bfont', 'typograph', '\\bcolou?r', '\\bpalette\\b', '\\btheme\\b', '\\baesthetic',
  '\\bhero\\b', '\\bdeck\\b', '\\bpresentation\\b', '\\binstagram\\b', '\\bsocial\\b', '\\bmerch\\b', '\\bshirt', '\\bgarment',
  '\\bposter', '\\bpage\\b', '\\bdesign',
  // How motion feels. A prompt can ask for better motion without naming a single design noun:
  // "make this transition feel better" is the request, and these are the words that carry it.
  // "feel free" is the one ordinary phrase in the set, so it is excluded by name.
  '\\bfeels?\\b(?! free)', '\\bsmooth', '\\bsnappy\\b', '\\bsluggish\\b', '\\bchoppy\\b', '\\bjank', '\\bstutter',
  '\\bbouncy?\\b', '\\bfades?\\b', '\\bhover\\b', '\\bease\\b', '\\bspring\\b', '\\bentrance\\b',
])

// Anything that moves. Only consulted once the prompt is already visual, so it can be broad.
const MOTION = rx([
  'animat', '\\btransitions?\\b', '\\bmotion\\b', '\\beasing\\b', '\\btween\\b', 'keyframe', 'micro-?interaction',
  'parallax', 'scroll(-| )?(driven|trigger)', '\\bhover\\b', '\\bgsap\\b', 'framer-?motion', '\\blottie\\b',
  '\\bsluggish\\b', '\\bsnappy\\b', '\\bchoppy\\b', '\\bjank', '\\bstutter', '\\bbouncy?\\b', '\\bspinners?\\b',
  '\\bspring\\b', 'fade (in|out)', 'slide (in|out|up|down)', 'page transition', 'loading (spinner|animation)',
])

// Paper. The failure mode is a screen layout at card size, delivered as a paragraph.
const PHYSICAL = rx([
  'business card', '\\bflyers?\\b', '\\bposters?\\b', 'brochure', 'postcard', '\\bstickers?\\b', 'letterhead', 'menu design',
  'print-?ready', '\\bbleed\\b', '\\bcmyk\\b', 'pantone', 'letterpress', 'die-?cut', 'print(ed|ing)? (piece|design|collateral)',
])
// Packaging has its own field reference; it routes to design-fields, not to paper.
const PHYSICAL_WEAK = rx(['\\binvitations?\\b', '\\bmenu\\b'])
// Fabric.
const APPAREL = rx([
  't-?shirts?', 'tee shirt', 'hoodie', 'sweatshirt', 'baseball cap', 'snapback', 'tote bag', '\\bmerch\\b', 'screen ?print',
  '\\bdtg\\b', 'embroider', 'heat transfer', 'apparel', 'garment',
])
const APPAREL_WEAK = rx(['\\btee\\b', '\\bjersey\\b'])
// The fields with a canvas, minimums and a delivery format of their own.
const FIELDS = rx([
  '\\blogos?\\b', 'wordmark', 'brand identity', 'favicon', 'app icon', 'icon set', 'infographic', 'social (post|media)',
  'instagram', 'thumbnail', 'youtube', 'open graph', '\\bog image', 'slide deck', 'pitch deck', 'presentation',
  'email template', 'newsletter design', 'label design', 'signage', 'wayfinding', 'book cover', 'album (art|cover)',
  'motion graphics', 'title sequence', '(instagram|social|ig)\\s+stor(y|ies)',
])
const FIELDS_WEAK = rx(['\\billustrations?\\b', '\\bdiagrams?\\b', '\\bicons?\\b', '\\bslides?\\b', '\\bbanners?\\b', '\\bpackaging\\b', '\\btextile\\b'])

function readStdin() {
  try { return require('node:fs').readFileSync(0, 'utf8') } catch { return '' }
}

function main() {
  let payload = {}
  try { payload = JSON.parse(readStdin() || '{}') || {} } catch { return }
  const prompt = String(payload.prompt ?? '')
  const ctx = CONTEXT.test(prompt)
  const visual = STRONG.test(prompt) || (WEAK.test(prompt) && ctx)
  if (!visual) return

  const physical = PHYSICAL.test(prompt) || (PHYSICAL_WEAK.test(prompt) && ctx)
  const apparel = APPAREL.test(prompt) || (APPAREL_WEAK.test(prompt) && ctx)
  const field = FIELDS.test(prompt) || (FIELDS_WEAK.test(prompt) && ctx)
  const motion = MOTION.test(prompt)

  let routed = ''
  if (physical || apparel) {
    const which = apparel && !physical ? '`apparel-design`' : physical && !apparel ? '`print-design`' : '`print-design` and `apparel-design`'
    routed =
      ' PHYSICAL MEDIA DETECTED — this is paper or fabric, not a screen. After the taste layer, load ' +
      which + ' and follow its pipeline: run `creative-divergence` first and WRITE IT DOWN as ' +
      'directions.md — the DNA table from the subject\'s real artifacts, three to five structurally ' +
      'different directions, the swap-test verdict on each, the one committed to — before the first ' +
      'line of markup (a protocol run in the head is the first idea polished); choose stock/finish or ' +
      'print method and placement BEFORE layout; ' +
      'author at physical size in in/mm/pt with bleed (never px); render with `cgc print` ' +
      '(PDF at trim + bleed, PNG proof, or a true-scale garment mockup); gate with `cgc print-lint` ' +
      '(type under 6pt, hairlines, rasters under 300dpi and a missing size FAIL); ship the spec or placement ' +
      'sheet with the file. A paragraph describing a card, or a screenshot of a web layout, is not a deliverable. ' +
      'Refuse the physical centroid: white card with the logo top-left; a poster that is a big flyer; a logo ' +
      'centred on the chest of a white tee.'
  } else if (field) {
    routed =
      ' FIELD DETECTED — this is a logo, icon, illustration, diagram, social, slide, email, packaging or signage piece, ' +
      'not a page. After the taste layer, load `design-fields` and read its reference for the field BEFORE the first ' +
      'line of markup: the real canvas and units, the minimums, the delivery format, the moves that exist only in that ' +
      'field. Write directions.md first (DNA from the subject\'s real artifacts, three to five structurally different ' +
      'directions, the swap test on each). Render the exact pixels with `cgc render <file> --preset <field>` ' +
      'and look at them at the size they will be seen — a favicon at 16px, a thumbnail at 168px, a slide from the back of the room. ' +
      'An icon SET is judged as a SET, not as icons: `cgc icons ./icons --size 16` derives the grid, stroke weight, caps and ' +
      'joins from the majority and names every icon that disagrees, plus live text, an embedded bitmap, a colour pinned instead ' +
      'of currentColor, traced off-grid coordinates, and a stroke that renders under one pixel at the size it is really used. ' +
      'A wordmark ships as outlines rather than live text: `cgc outline --font <file> --text <words>` writes it as one SVG path ' +
      'with the font\'s own kerning, so the artwork depends on no font being installed anywhere.'
  }

  const moved = !motion ? '' :
    ' MOTION DETECTED — you cannot review this by reading it. The defect that matters most in ' +
    'animation is invisible in a diff: it never ran, because the class was not applied, the trigger ' +
    'did not fire, the element was out of view, or the library did not load — and it ships described ' +
    'as "subtle". So WATCH IT: `cgc motion <file> --duration <ms>` steps the page under a virtual ' +
    'clock (performance.now, Date.now and requestAnimationFrame are replaced before the page\'s own ' +
    'scripts run, and CSS animations, transitions and Web Animations are scrubbed by currentTime, so ' +
    'CSS, GSAP, Motion and any rAF loop advance deterministically), photographs every frame, and writes ' +
    'a contact sheet with the change under each frame and the measured curve against the straight line. ' +
    'LOOK AT THE SHEET, then fix the weakest frame and capture again — the same loop, no pass count. ' +
    'Use --trigger hover:<selector>, --trigger click:<selector> or --trigger scroll for interaction and ' +
    'scroll-driven work. It reports from the pixels whether anything moved, the easing the frames ' +
    'actually show, where the motion settles, whether one frame carries the whole change, and whether ' +
    'it still animates under prefers-reduced-motion. The craft — easing curves with their bezier values, ' +
    'duration budgets by kind, springs, choreography and stagger, the per-platform snippets, and when ' +
    'NOT to animate — is visual-design-mastery/references/motion-and-animation.md; the moves with their ' +
    'numbers are signature-moves.md (Motion). Non-negotiable: nothing linear except what spins forever, ' +
    'exits at about 60% of the entrance, one motion law per piece, and reduced motion collapses it.'

  const context =
    'VISUAL WORK DETECTED — load the `visual-design-mastery` skill before writing any ' +
    'code that draws something a human will look at, in ANY language. It carries a ' +
    'universal design/animation creed plus per-stack references (web/CSS, shaders/GPU, ' +
    'games/MonoGame/Unity/Godot, native/SwiftUI/Compose/Flutter, generative/TUI/data-viz). ' +
    'Non-negotiables: intention over defaults; spend boldness in ONE place and keep the ' +
    'rest quiet; motion carries meaning and obeys real easing (exits faster than ' +
    'entrances); decide what a two-second glance should learn and build hierarchy around ' +
    'it; refuse the templated "AI-made-this" look. "Fine" is the enemy — make one decision ' +
    'only this project would make. For React/Tailwind, also use the ui-design-stack ' +
    'component libraries as the component layer under this taste layer. ' +
    'IF LOOKING DISTINCTIVE IS THE GOAL (hero, landing page, game UI, brand surface, art ' +
    'direction), load `creative-divergence` FIRST and run its protocol, or the ' +
    '`design-divergence` workflow for the full agent fan-out. The taste layer judges ' +
    'whether a design is good; it does not generate one. Polishing your first idea only ' +
    'polishes the average, and reaching for a component library while the concept is still ' +
    'open adopts that library\'s opinion. Decide the concept, then build it fast. ' +
    'Do NOT pause for clarifying questions or offer a menu of directions: run the divergence ' +
    'protocol yourself, commit to one, state any assumption in a line, and show the finished ' +
    'thing — this overrides any skill that mandates asking first. ' +
    'THEN THE LOOP, which is mandatory and has no pass count. `cgc check <file>` runs every gate that ' +
    'applies to the file in one command and prints one verdict — use it after every pass. In full: render it ' +
    '(`cgc render page.html --mobile`, ' +
    'or the print or garment render), look at the PNG, name the weakest thing, fix it and extrapolate the fix, gate it ' +
    '(`cgc lint page.html` — the fingerprint of AI-made design; a hook reports it on every screen file written; ' +
    'then `cgc audit page.html --mobile` — contrast on the real ground, faces that fell back, measure, tiny text, ' +
    'widows, sideways scroll, tap targets, focus, reduced motion, the palette by area — with no failure), ' +
    'render again — and fix and refine and improve and evolve and extrapolate in that loop until it achieves, at minimum, the ' +
    'equivalent of a passionate human professional\'s work in the field. The first render is never the one shown. The ' +
    'professional\'s questions that end the loop are in creative-divergence Step 4; the vocabulary with its parameters — ' +
    'faces, palettes, layout grammars, materials, motion laws — is visual-design-mastery/references/signature-moves.md. ' +
    'AND THE OTHER DIRECTION: the lint says what is wrong with a piece, never what it never tried. ' +
    'A page with no fingerprint at all can still be built entirely from flexbox, border-radius, a hex ' +
    'colour and a 300ms transition — correct, and unremarkable, which is the ceiling almost all ' +
    'generated work sits at because the model reaches for what it has seen most and that is 2015 CSS. ' +
    '`cgc techniques <file>` detects the medium (web, SVG, canvas, shader, 3D, native, game, terminal, ' +
    'data-viz, print), measures the piece against that medium\'s own vocabulary, and reports what it never ' +
    'tried: oklch and relative colour so a palette derives instead of being pasted, @property (the ONLY ' +
    'way to animate a gradient), variable font axes past weight, optical sizing, text-box trim, container ' +
    'queries, subgrid, deliberate grid overlap, gradient masks instead of another card, blend modes, ' +
    'generated grain from feTurbulence, scroll-driven animation with no library, View Transitions, ' +
    '@starting-style, anchor positioning, display-p3. Verdicts: assembled (0–1), conventional (2–4), ' +
    'considered (5–8), ambitious (9+), reported by a hook on every substantial design file in whichever ' +
    'medium it recognises. Pick the ONE OR TWO the idea actually requires and let them change ' +
    'the STRUCTURE, not the surface — a technique that could be removed without the piece reading ' +
    'differently was decoration. The recipes with real parameters are in ' +
    'visual-design-mastery/references/advanced-techniques.md. ' +
    'Choose a face or a palette by looking at it set, not by its name: `cgc specimen --display <face> --text <face> --palette <colours>`.' + routed + moved

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }) + '\n'
  )
}

main()
// path is imported for parity with sibling hooks; no-op reference keeps linters quiet.
void path
