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
      'and look at them at the size they will be seen — a favicon at 16px, a thumbnail at 168px, a slide from the back of the room.'
  }

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
    'THEN THE LOOP, which is mandatory and has no pass count: render it (`cgc render page.html --mobile`, ' +
    'or the print or garment render), look at the PNG, name the weakest thing, fix it and extrapolate the fix, gate it ' +
    '(`cgc lint page.html` — the fingerprint of AI-made design; a hook reports it on every screen file written; ' +
    'then `cgc audit page.html --mobile` — contrast on the real ground, faces that fell back, measure, tiny text, ' +
    'widows, sideways scroll, tap targets, focus, reduced motion, the palette by area — with no failure), ' +
    'render again — and fix and refine and improve and evolve and extrapolate in that loop until it achieves, at minimum, the ' +
    'equivalent of a passionate human professional\'s work in the field. The first render is never the one shown. The ' +
    'professional\'s questions that end the loop are in creative-divergence Step 4; the vocabulary with its parameters — ' +
    'faces, palettes, layout grammars, materials, motion laws — is visual-design-mastery/references/signature-moves.md. ' +
    'Choose a face or a palette by looking at it set, not by its name: `cgc specimen --display <face> --text <face> --palette <colours>`.' + routed

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }) + '\n'
  )
}

main()
// path is imported for parity with sibling hooks; no-op reference keeps linters quiet.
void path
