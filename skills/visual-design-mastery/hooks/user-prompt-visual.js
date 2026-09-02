// UserPromptSubmit hook: put the visual-design-mastery mandate in front of the
// model whenever a prompt is about drawing something a human will look at — in
// ANY language, not just React.
//
// The existing user-prompt-ui-stack hook covers the React/Tailwind component
// libraries. This one is broader and language-agnostic: it fires on games,
// shaders, native UI, generative art, terminals, and data-viz too, and points
// at the skill that carries the per-stack craft.
//
// Deliberately conditional. A hook that fires on every prompt is noise; this one
// stays silent unless the prompt is actually about something visual.

const path = require('node:path')

// Broad visual-work intent across every medium. Kept as one regex so the check
// is a single pass; ordered roughly by how strongly each term implies visual work.
const VISUAL = new RegExp(
  [
    // general design / UI
    '\\bui\\b', 'user interface', '\\bux\\b', 'design', 'redesign', 'styl(e|ing)',
    'theme', 'palette', 'colou?r', 'typograph', '\\bfont\\b', 'layout', 'visual',
    'aesthetic', 'polish the look', 'make it (look|beautiful|pretty|nicer)', 'mock-?up',
    'landing page', 'dashboard', 'component', 'button', 'card', 'navbar', 'hero section',
    'frontend', 'front-end',
    // motion
    'animat', 'transition', '\\bmotion\\b', 'micro-?interaction', 'easing', 'tween',
    'parallax', 'scroll(-| )?(driven|trigger)', 'keyframe',
    // art / gpu
    '\\bart\\b', 'shader', '\\bglsl\\b', '\\bhlsl\\b', 'webgl', 'webgpu', 'three\\.?js',
    'particle', 'generative', 'procedural (art|visual)', 'creative coding', 'p5\\.?js',
    'processing sketch', 'raymarch', 'noise field', 'flow field',
    // games
    'sprite', 'spritebatch', 'monogame', '\\bunity\\b', '\\bgodot\\b', 'game feel',
    '\\bjuice\\b', 'screen ?shake', 'render(er|ing)? ', 'draw(ing)? (a|the|it|to)',
    'pixel art', 'tilemap',
    // native / mobile
    'swiftui', 'jetpack compose', '\\bflutter\\b', '\\bwinui\\b', '\\bwpf\\b',
    // dataviz / terminal
    '\\bchart\\b', 'graph', 'plot', 'data ?vis', 'visuali[sz]ation', '\\btui\\b',
    'terminal (ui|art|colou?r)', 'ascii art',
    // print and physical
    'business card', 'flyer', 'poster', 'brochure', 'postcard', 'sticker', 'packaging',
    'invitation', 'letterhead', 'menu design', 'print-?ready', '\\bbleed\\b', '\\bcmyk\\b',
    'pantone', 'letterpress', 'die-?cut',
    // apparel
    't-?shirt', '\\btee\\b', 'hoodie', 'sweatshirt', 'baseball cap', 'snapback', 'tote',
    '\\bmerch', 'jersey', 'screen ?print', '\\bdtg\\b', 'embroider', 'heat transfer',
    'apparel', 'garment',
    // the other fields
    '\\blogo\\b', 'wordmark', 'brand identity', 'favicon', 'app icon', 'icon set', '\\bicons?\\b',
    'illustration', 'diagram', 'infographic', 'social (post|media)', 'instagram', '\\bstory\\b',
    'thumbnail', 'youtube', 'open graph', '\\bog image', 'slide', '\\bdeck\\b', 'presentation',
    'email template', 'newsletter', 'packaging', 'label design', 'signage', 'wayfinding', 'banner',
    'book cover', 'album (art|cover)', '\\bpattern\\b', 'textile', 'motion graphics', 'title sequence',
  ].join('|'),
  'i'
)

// Fields with a canvas, minimums and a delivery format of their own — design-fields carries
// them. The failure mode is designing a logo at 800px, a slide as a document, an email as a
// web page.
const FIELDS = new RegExp(
  [
    '\\blogo\\b', 'wordmark', 'brand identity', 'favicon', 'app icon', 'icon set', 'illustration',
    'diagram', 'infographic', 'social (post|media)', 'instagram', '\\bstory\\b', 'thumbnail', 'youtube',
    'open graph', '\\bog image', 'slide', '\\bdeck\\b', 'presentation', 'email template', 'newsletter',
    'packaging', 'label design', 'signage', 'wayfinding', 'banner', 'book cover', 'album (art|cover)',
    'textile', 'motion graphics', 'title sequence',
  ].join('|'),
  'i'
)

// The physical media have their own technique skills and a real render pipeline; a prompt
// that matches here gets routed to them, because the failure mode is specific — a screen
// layout at card size, delivered as a paragraph or a screenshot, never as a print file.
const PHYSICAL = new RegExp(
  [
    'business card', 'flyer', 'poster', 'brochure', 'postcard', 'sticker', 'packaging',
    'invitation', 'letterhead', 'menu design', 'print-?ready', '\\bbleed\\b', '\\bcmyk\\b',
    'pantone', 'letterpress', 'die-?cut', 'print(ed|ing)? (piece|design|collateral)',
  ].join('|'),
  'i'
)
const APPAREL = new RegExp(
  [
    't-?shirt', '\\btee\\b', 'hoodie', 'sweatshirt', 'baseball cap', 'snapback', 'tote',
    '\\bmerch', 'jersey', 'screen ?print', '\\bdtg\\b', 'embroider', 'heat transfer',
    'apparel', 'garment',
  ].join('|'),
  'i'
)

// If the prompt is clearly about something NON-visual that happens to match a weak
// term (e.g. "chart of accounts", "button up the API contract"), the specific
// visual terms above still dominate; we accept a few false positives because a
// silent miss on real visual work is the worse failure.

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  let payload = {}
  try {
    payload = JSON.parse(readStdin() || '{}')
  } catch {
    return
  }
  const prompt = String(payload.prompt ?? '')
  if (!VISUAL.test(prompt)) return

  let physical = ''
  if (PHYSICAL.test(prompt) || APPAREL.test(prompt)) {
    const which = APPAREL.test(prompt) && !PHYSICAL.test(prompt) ? '`apparel-design`'
      : PHYSICAL.test(prompt) && !APPAREL.test(prompt) ? '`print-design`'
        : '`print-design` and `apparel-design`'
    physical =
      ' PHYSICAL MEDIA DETECTED — this is paper or fabric, not a screen. After the taste layer, load ' +
      which + ' and follow its pipeline: run `creative-divergence` first and WRITE IT DOWN as ' +
      'directions.md — the DNA table from the subject\'s real artifacts, three to five structurally ' +
      'different directions, the swap-test verdict on each, the one committed to — before the first ' +
      'line of markup (a protocol run in the head is the first idea polished); choose stock/finish or ' +
      'print method and placement BEFORE layout; ' +
      'author at physical size in in/mm/pt with bleed (never px); render with `node tools/print-render.mjs` ' +
      '(PDF at trim + bleed, PNG proof, or a true-scale garment mockup); gate with `node tools/print-lint.mjs` ' +
      '(type under 6pt, hairlines, rasters under 300dpi and a missing size FAIL); ship the spec or placement ' +
      'sheet with the file. A paragraph describing a card, or a screenshot of a web layout, is not a deliverable. ' +
      'Refuse the physical centroid: white card with the logo top-left; a poster that is a big flyer; a logo ' +
      'centred on the chest of a white tee.'
  } else if (FIELDS.test(prompt)) {
    physical =
      ' FIELD DETECTED — this is a logo, icon, illustration, diagram, social, slide, email, packaging or signage piece, ' +
      'not a page. After the taste layer, load `design-fields` and read its reference for the field BEFORE the first ' +
      'line of markup: the real canvas and units, the minimums, the delivery format, the moves that exist only in that ' +
      'field. Write directions.md first (DNA from the subject\'s real artifacts, three to five structurally different ' +
      'directions, the swap test on each). Render the exact pixels with `node tools/screen-render.mjs <file> --preset <field>` ' +
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
    'THEN THE LOOP, which is mandatory and has no pass count: render it (`node tools/screen-render.mjs page.html --mobile`, ' +
    'or the print or garment render), look at the PNG, name the weakest thing, fix it and extrapolate the fix, gate it ' +
    '(`node tools/slop-lint.mjs page.html` — the fingerprint of AI-made design; a hook reports it on every screen file written; ' +
    'then `node tools/page-audit.mjs page.html --mobile` — contrast on the real ground, faces that fell back, measure, tiny text, ' +
    'widows, sideways scroll, tap targets, focus, reduced motion, the palette by area — with no failure), ' +
    'render again — and fix and refine and improve and evolve and extrapolate in that loop until it achieves, at minimum, the ' +
    'equivalent of a passionate human professional\'s work in the field. The first render is never the one shown. The ' +
    'professional\'s questions that end the loop are in creative-divergence Step 4; the vocabulary with its parameters — ' +
    'faces, palettes, layout grammars, materials, motion laws — is visual-design-mastery/references/signature-moves.md. ' +
    'Choose a face or a palette by looking at it set, not by its name: `node tools/specimen.mjs --display <face> --text <face> --palette <colours>`.' + physical

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }) + '\n'
  )
}

main()
// path is imported for parity with sibling hooks; no-op reference keeps linters quiet.
void path
