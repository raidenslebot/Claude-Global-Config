// PostToolUse hook: motion that was never watched. The slop hook catches the templated LOOK;
// this catches the templated MOVE — and the move is where the work is thinnest, because the
// model can read a diff but has never seen the page in time. It reports the tells that are
// visible in the source, then names the one command that shows the rest: cgc motion, which
// steps the page under a virtual clock and photographs every frame.
//
// It reports; it never vetoes. Silent on files that do not animate. Exit 0 always.

// A reader that hangs up raises EPIPE asynchronously on the socket, where a try/catch around
// main() cannot reach it. This hook exits 0 always, and that has to survive a closed pipe.
process.stdout.on('error', () => {})

const fs = require('node:fs')
const path = require('node:path')

const EXTS = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.js', '.ts'])

// Does this file animate at all? Declarative, Web Animations, or any of the libraries.
const ANIMATES = /@keyframes\b|\btransition\s*:|\banimation\s*:|\.animate\s*\(|requestAnimationFrame|\bgsap\s*\.|ScrollTrigger|from\s+["']motion|framer-motion|useSpring|@keyframes|animate=\{/

const LAYOUT = /(?<![-\w])(width|height|top|left|right|bottom|margin(?:-\w+)?|padding(?:-\w+)?)(?![-\w])/

const lineOf = (text, index) => text.slice(0, index).split('\n').length

function findings(text) {
  const out = []
  const add = (id, index, note) => out.push({ id, line: lineOf(text, index), note })

  // A straight line is the absence of a decision. linear-gradient and the linear() easing
  // function are not that, so both are excluded.
  for (const m of text.matchAll(/(?:transition|animation)(?:-timing-function)?\s*:[^;{}]{0,200}?\blinear\b(?!-gradient|\s*\()/g)) {
    // The rule this declaration sits in, roughly: enough to see its neighbours.
    const rule = text.slice(Math.max(0, m.index - 240), m.index + 240)
    if (/animation-timeline\s*:|scroll-timeline|view-timeline|\binfinite\b/.test(rule)) continue
    add('linear', m.index, 'linear easing — nothing in the physical world starts and stops at full speed. cubic-bezier(.2,.8,.2,1) for something arriving, cubic-bezier(.4,0,1,1) for something leaving. The honest uses are a marquee, a spinner, and a scroll-driven animation whose easing comes from the scroll itself.')
    break
  }
  for (const m of text.matchAll(/transition\s*:\s*all\b/g)) {
    add('transition-all', m.index, 'transition: all animates every property that ever changes, including ones you never chose, and costs the compositor a re-check on each. Name the properties.')
    break
  }
  // The browser default is the centroid of motion: it is what you get for not deciding.
  for (const m of text.matchAll(/transition\s*:[^;{}]{0,200}?\d*\.?\d+m?s\s+ease\s*(?:[;}]|$)/g)) {
    add('default-ease', m.index, 'the bare `ease` keyword is the browser default — cubic-bezier(.25,.1,.25,1), the curve of not having chosen. Pick one and mean it.')
    break
  }
  for (const m of text.matchAll(/(?:transition|animation)(?:-duration)?\s*:[^;{}]{0,200}?(\d{4,})ms|(?:transition|animation)(?:-duration)?\s*:[^;{}]{0,200}?(\d*\.?\d+)s\b/g)) {
    const ms = m[1] ? +m[1] : Math.round(+m[2] * 1000)
    if (ms >= 1200 && ms <= 120000 && !/infinite/.test(text.slice(Math.max(0, m.index - 20), m.index + 90))) {
      add('slow', m.index, `${ms} ms of motion is long enough to be waited on. Anything the viewer triggered should be finished inside 400 ms; the long timeline belongs to something they chose to watch.`)
      break
    }
  }
  for (const m of text.matchAll(/transition(?:-property)?\s*:\s*([^;{}]+)/g)) {
    if (LAYOUT.test(m[1]) && !/transform|opacity/.test(m[1])) {
      add('layout-animation', m.index, `animating ${m[1].trim().split(/[\s,]+/).filter((w) => LAYOUT.test(w)).join(', ')} runs layout on every frame and cannot be composited — it is the usual cause of motion that feels cheap on a real device. Move it to transform and opacity.`)
      break
    }
  }
  if (/@keyframes/.test(text) || /\btransition\s*:/.test(text)) {
    if (!/prefers-reduced-motion/.test(text)) {
      add('no-reduced-motion', text.search(/@keyframes|\btransition\s*:/), 'this file animates and never mentions prefers-reduced-motion. For a viewer with a vestibular disorder that is not a preference being ignored, it is symptoms. Collapse the movement to an opacity change, or to nothing.')
    }
  }
  return out
}

function main() {
  let payload
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!/^(Write|Edit|MultiEdit)$/.test(String(payload.tool_name || ''))) return
  const file = String(payload.tool_input?.file_path || '')
  if (!file || !EXTS.has(path.extname(file).toLowerCase())) return
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  if (!ANIMATES.test(text)) return

  const found = findings(text)
  const name = path.basename(file)
  const list = found.map((f) => `${f.id} (L${f.line}) — ${f.note}`).join(' ')
  const context = (found.length
    ? `MOTION in ${name}: ${list} `
    : `MOTION in ${name}. `)
    + `You have not seen this move. Reading a duration is not watching an animation: run \`cgc motion "${file}" --duration <ms>\` `
    + '(add --trigger hover:<selector>, --trigger click:<selector>, or --trigger scroll for scroll-driven work). '
    + 'It steps the page under a virtual clock — CSS, Web Animations, GSAP and any rAF loop alike — photographs every frame, '
    + 'and writes a contact sheet with the change under each frame and the real curve plotted against the straight line. '
    + 'LOOK AT THE SHEET. It measures from the pixels what the source cannot tell you: whether anything moved at all, the easing '
    + 'the frames actually show, where the motion settles, whether one frame carries the whole change, and whether it still '
    + 'animates for a viewer who asked it not to. Then fix the weakest frame and capture it again, in the same loop as every '
    + 'other design surface — until it reads like a passionate professional made it. The moves with their real parameters are '
    + 'in visual-design-mastery/references/signature-moves.md (Motion) and motion-and-animation.md.'
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }) + '\n')
}

try { main() } catch { /* a reporting hook never blocks a write */ }
module.exports = { findings, ANIMATES }
