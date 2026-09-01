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
    'open adopts that library\'s opinion. Decide the concept, then build it fast.'

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }) + '\n'
  )
}

main()
// path is imported for parity with sibling hooks; no-op reference keeps linters quiet.
void path
