// The tide board, in a terminal. Fixture for the TUI vocabulary: real colour, real
// glyph resolution, a live redraw, and honest degradation when there is no TTY.

const ESC = '\x1b['
const out = process.stdout

// 24-bit colour. The 16-colour palette is a constraint from 1985, not a style.
const rgb = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`
const bg = (r, g, b) => `${ESC}48;2;${r};${g};${b}m`
const reset = `${ESC}0m`
const bold = `${ESC}1m`
const dim = `${ESC}2m`
const italic = `${ESC}3m`

// Degrade honestly rather than writing escapes into a log file.
const colour = out.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'
const paint = (s, c) => (colour ? c + s + reset : s)

// A gradient across a run, so colour carries the value rather than decorating it.
function gradientText(text, from, to) {
  return [...text].map((ch, i) => {
    const t = i / Math.max(1, text.length - 1)
    const c = from.map((v, k) => Math.round(v + (to[k] - v) * t))
    return paint(ch, rgb(c[0], c[1], c[2]))
  }).join('')
}

// Braille gives a 2x4 pixel grid inside one cell, which is how a terminal draws a
// real curve rather than an approximation of one.
const BRAILLE = 0x2800
function brailleRow(values, height = 4) {
  let s = ''
  for (let i = 0; i < values.length; i += 2) {
    let mask = 0
    for (let col = 0; col < 2; col++) {
      const v = Math.round((values[i + col] || 0) * height)
      for (let row = 0; row < v; row++) mask |= 1 << (col * 3 + row)
    }
    s += String.fromCharCode(BRAILLE + mask)
  }
  return s
}

const BLOCKS = '▁▂▃▄▅▆▇█'
const sparkline = (xs) => xs.map((x) => BLOCKS[Math.min(7, Math.floor(x * 8))]).join('')

// Grapheme-aware width: the difference between a table that aligns and one that
// shears the moment a name has a wide character in it.
function stringWidth(s) {
  let w = 0
  for (const ch of s) w += ch.codePointAt(0) > 0x1100 ? 2 : 1
  return w
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - stringWidth(s)))

function frame(box) {
  const top = '┌' + '─'.repeat(box.w) + '┐'
  const bot = '└' + '─'.repeat(box.w) + '┘'
  const mid = box.rows.map((r) => '│' + pad(r, box.w) + '│')
  return [top, ...mid, bot].join('\n')
}

function enterAltScreen() { out.write(ESC + '?1049h'); out.write(ESC + '?1006h' + ESC + '?1000h') }
function leaveAltScreen() { out.write(ESC + '?1000l' + ESC + '?1049l') }

let lastLines = 0
function render(state) {
  // Redraw in place: a live view, not a wall of appended lines.
  if (lastLines) out.write(ESC + lastLines + 'A' + ESC + '2J')
  const body = frame({
    w: 46,
    rows: [
      paint(bold + 'HARBOUR SWIM CLUB', rgb(239, 233, 220)) + dim + '  outer basin' + reset,
      '',
      gradientText('  ' + sparkline(state.curve), [31, 42, 68], [255, 90, 31]),
      '  ' + brailleRow(state.curve),
      '',
      paint(italic + '  ' + state.label, rgb(180, 190, 205)) + reset,
      dim + '  next high 16:41' + reset,
      bg(31, 42, 68) + ' '.repeat(46) + reset,
    ],
  })
  out.write(body + '\n')
  lastLines = body.split('\n').length + 1
}

process.on('SIGINT', () => { leaveAltScreen(); process.exit(0) })
if (colour) enterAltScreen()
setInterval(() => render({
  curve: Array.from({ length: 24 }, (_, i) => 0.5 - 0.5 * Math.cos(i / 4)),
  label: 'coming in',
}), 1000)
