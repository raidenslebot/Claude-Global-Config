// A drifting particle field over a noise flow, drawn on a 2D canvas.
// Fixture: a plausible piece that exercises the canvas vocabulary.

const cv = document.querySelector('canvas')
const ctx = cv.getContext('2d', { alpha: false })

function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.floor(cv.clientWidth * dpr)
  cv.height = Math.floor(cv.clientHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
fit()
addEventListener('resize', fit)

// Reproducible on demand, different every load: the seed is the only difference
// between this run and any other.
const seed = Math.floor(Math.random() * 0xffffffff)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(seed)

// A cheap value noise: one function, a thousand coherent marks nobody drew.
const grid = new Float32Array(4096)
for (let i = 0; i < grid.length; i++) grid[i] = rnd()
function noise2D(x, y) {
  const xi = Math.floor(x) & 63, yi = Math.floor(y) & 63
  return grid[yi * 64 + xi]
}

// The trail buffer. A single context cannot fade what it has already drawn without
// painting over it, so the previous frame lives here.
const buffer = document.createElement('canvas')
buffer.width = cv.width; buffer.height = cv.height
const bctx = buffer.getContext('2d', { willReadFrequently: true })

const ink = ctx.createRadialGradient(0, 0, 0, 0, 0, 40)
ink.setColorStop ? null : null
const tile = document.createElement('canvas'); tile.width = tile.height = 8
const hatch = ctx.createPattern(tile, 'repeat')

const emitter = { x: 0, y: 0, rate: 8 }
const particles = []
for (let i = 0; i < 900; i++) {
  particles.push({ x: rnd() * 1200, y: rnd() * 800, vx: 0, vy: 0, life: rnd() })
}

const hit = new Path2D()
hit.rect(20, 20, 160, 40)

function step(t) {
  // Feedback: last frame, dimmed, is the ground for this one.
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(buffer, 0, 0, cv.width, cv.height)
  ctx.fillStyle = 'rgba(20,22,28,0.06)'
  ctx.fillRect(0, 0, cv.width, cv.height)

  ctx.globalCompositeOperation = 'lighter'
  const damping = 0.94
  const gravity = 0.015
  for (const p of particles) {
    const a = noise2D(p.x / 90, p.y / 90) * Math.PI * 4
    const acceleration = 0.22
    p.vx = (p.vx + Math.cos(a) * acceleration) * damping
    p.vy = (p.vy + Math.sin(a) * acceleration + gravity) * damping
    p.x += p.vx; p.y += p.vy
    ctx.fillStyle = 'rgba(228,214,190,0.5)'
    ctx.fillRect(p.x, p.y, 1.2, 1.2)
  }

  // The label is measured and placed, not centred by eye.
  ctx.globalCompositeOperation = 'source-over'
  ctx.font = '500 13px ui-monospace, monospace'
  ctx.textBaseline = 'alphabetic'
  const label = 'seed ' + seed.toString(16)
  const w = ctx.measureText(label).width
  ctx.fillStyle = hatch || '#e4d6be'
  ctx.fillText(label, cv.clientWidth - w - 18, 24)

  // Keep this frame for the next one, and lift the pixels once a second to
  // measure how much of the field is still alight.
  bctx.clearRect(0, 0, buffer.width, buffer.height)
  bctx.drawImage(cv, 0, 0)
  if ((t | 0) % 1000 < 17) {
    const d = bctx.getImageData(0, 0, buffer.width, 1)
    let lit = 0
    for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 40) lit++
    if (lit > buffer.width * 0.8) bctx.putImageData(bctx.createImageData(1, 1), 0, 0)
  }
  requestAnimationFrame(step)
}
requestAnimationFrame(step)

cv.addEventListener('pointermove', (e) => {
  emitter.x = e.offsetX; emitter.y = e.offsetY
  cv.style.cursor = ctx.isPointInPath(hit, e.offsetX, e.offsetY) ? 'pointer' : 'crosshair'
})
