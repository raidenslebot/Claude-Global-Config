// decision — the UI exposes the machinery instead of delivering the decision.
//
// The instance that named this class: "The intended experience is one actionable instruction
// with deeper explanation available. The implemented structure still contains 15 panels across
// six groups, while the design document describes four coordinated surfaces."
//
// So what this measures is a RATIO, never a verdict. A settings page, a data grid and an admin
// console are all SUPPOSED to be control panels, and nothing here can tell which one it is
// looking at — so it reports how many surfaces a screen presents against how many decisions it
// offers, and against whatever the project's own design document said it would present. That
// last comparison is the only finding here that is not taste: it is the implementation
// disagreeing with its own stated intent, in two numbers, with the document's path beside them.
//
// The unit is a ROOT, not a file. A component module holding six panel components is six
// screens' worth of parts in one file and is not a screen with six panels — counting per file
// said `Panels.tsx` had thirteen surfaces when its largest actual root has one.
//
// And the document comparison does NOT go through the "is this a screen" heuristic, which is the
// one thing here that must not be undone. That heuristic asks whether the markup offers anything
// to do, and the instance above offers NOTHING to do — that is the defect being reported — so for
// two years' worth of runs it classified its own founding instance as a poster and said nothing.
// A count in a design document is better evidence that markup is a screen than any tally of
// buttons, so once a document states one, the comparison runs on control-less markup too.

const int = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Thresholds. Picked by running this over the trees named in `note`, not by feel.
const SURFACE_MAX = int('CGC_BEHAVIOUR_SURFACE_MAX', 8)   // top-level surfaces before a root reads as a panel
const DOC_RATIO = int('CGC_BEHAVIOUR_DOC_RATIO', 2)       // implementation ÷ documented count that counts as disagreement
const MIN_CONTROLS = 2                                    // below this a file is a document, not a screen

// ── the scanner ──────────────────────────────────────────────────────────────────────────────
// Markup attributes live inside quotes, which is exactly what ctx.code blanks — so this reads
// .src and blanks only comments and script/style bodies, preserving length so every offset still
// indexes the original.
const hollow = (m) => m.replace(/[^\n]/g, ' ')
const readable = (src) => src
  .replace(/<!--[\s\S]*?-->/g, hollow)
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, hollow)
  .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, a, b, c) => a + hollow(b) + c)
  .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, b, c) => a + hollow(b) + c)

const TAG = /<(\/?)([A-Za-z][\w.:-]*|)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>"'])*?)(\/?)>/g
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const SEMANTIC = new Set(['section', 'article', 'aside', 'details', 'fieldset'])
const ROLES = /\brole\s*=\s*["'](region|group|tabpanel)["']/i
const WORDS = ['panel', 'card', 'section', 'group', 'widget', 'tile', 'accordion']
// "group" is the one surface word that names something which is not a surface far more often
// than it names one: Tailwind's bare `group` marks a hover scope, and every CSS framework spells
// a field wrapper `form-group` / `input-group`.
const NOT_A_GROUP = new Set(['form', 'input', 'btn', 'button', 'radio', 'checkbox', 'field', 'control', 'toggle', 'avatar', 'icon', 'option', 'tab', 'nav', 'list', 'menu', 'chip'])

const classOf = (attrs) => {
  const m = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  return m ? (m[1] ?? m[2]) : ''
}

/** A class token names a surface when the surface word is the token's LAST segment: `hero-section`
 *  and `settings-panel` are surfaces, `card-body` and `panel-heading` are parts of one. */
export function surfaceWordIn(cls) {
  for (const tok of cls.split(/\s+/)) {
    const segs = tok.toLowerCase().split(/[-_]/).filter(Boolean)
    const last = segs[segs.length - 1]
    if (!WORDS.includes(last)) continue
    if (last === 'group' && (segs.length < 2 || NOT_A_GROUP.has(segs[segs.length - 2]))) continue
    return tok
  }
  return ''
}

/** A capitalised component whose own name ends in a surface word. */
function componentSurface(tag) {
  if (!/^[A-Z]/.test(tag)) return ''
  const last = tag.replace(/^.*\./, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').pop().toLowerCase()
  return WORDS.includes(last) && last !== 'group' ? tag : ''
}

const PRIMARY_CLASS = /(^|[-_\s])(primary|cta|confirm|submit)([-_\s]|$)/i
const PRIMARY_PROP = /\b(variant|color|kind|intent|appearance)\s*=\s*[{"']*(primary|cta|confirm)\b/i
const ACTION_TAG = /^(button|a|input|Button|Link|[A-Z]\w*(Button|Link))$/

function isPrimary(tag, attrs) {
  if (!ACTION_TAG.test(tag)) return false
  if (/\btype\s*=\s*["']submit["']/i.test(attrs)) return true
  if (PRIMARY_PROP.test(attrs)) return true
  return PRIMARY_CLASS.test(classOf(attrs))
}

const CONTROL = /<(button|select|textarea|form|Button|Select|Textarea|Form)\b|<input\b|\brole\s*=\s*["']button["']|\b(onClick|on:click|@click|v-on:click|onSubmit|on:submit)\b/g

/**
 * Parse markup into its ROOTS. A root is one contiguous top-of-stack element (or fragment): one
 * HTML document, or one component's returned tree. Each root carries the surfaces directly under
 * it — nested surfaces are not counted, because a card inside a panel is part of the panel — and
 * the primary actions inside it.
 */
export function census(src) {
  const s = readable(src)
  const stack = []          // open elements; each knows whether it was counted as a surface
  let inSurface = 0         // how many enclosing elements were counted as surfaces
  let root = null
  const roots = []

  TAG.lastIndex = 0
  let m
  while ((m = TAG.exec(s))) {
    const [, close, tag, attrs, selfClose] = m
    const lower = tag.toLowerCase()

    if (close) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag)
      if (i < 0) continue
      for (let k = stack.length - 1; k >= i; k--) if (stack[k].surface) inSurface--
      stack.length = i
      if (!stack.length) root = null
      continue
    }

    // `useState<Card>()` and `Array<Panel>` are TypeScript, not markup. JSX never opens a tag
    // directly after an identifier, a `)` or a `]`, so that is the whole tell.
    if (/[\w$)\].]/.test(s[m.index - 1] || ' ')) continue

    if (!root) { root = { index: m.index, surfaces: [], primaries: 0, primaryAt: [] }; roots.push(root) }

    if (isPrimary(tag, attrs)) { root.primaries++; root.primaryAt.push(m.index) }

    const cls = classOf(attrs)
    const byTag = SEMANTIC.has(lower)
    const byRole = ROLES.test(attrs)
    const byClass = surfaceWordIn(cls)
    const byComp = componentSurface(tag)
    const topLevel = Boolean(byTag || byRole || byClass || byComp) && inSurface === 0

    if (topLevel) {
      root.surfaces.push({
        index: m.index,
        // What the element declares about itself: tag plus its sorted class tokens. Two surfaces
        // with the same signature are, as far as the screen is concerned, the same kind of thing.
        sig: [lower, ...cls.toLowerCase().split(/\s+/).filter(Boolean).sort()].join('.'),
        // Named the way it would be pointed at on screen: the tag, plus whichever attribute is
        // the reason it counted. Six bare `<section>`s tell the reader nothing.
        why: byComp ? `<${byComp}>`
          : `<${lower}${byClass ? ` class="${byClass}"` : byRole ? ` role="${ROLES.exec(attrs)[1]}"` : ''}>`,
      })
    }

    if (!(VOID.has(lower) || selfClose === '/')) {
      stack.push({ tag, surface: topLevel })
      if (topLevel) inSurface++
    } else if (!stack.length) root = null
  }

  return { roots, controls: (s.match(CONTROL) || []).length }
}

/** The root that presents the most at once — the screen, among a file's parts. */
export const widest = (c) => c.roots.reduce((a, b) => (b.surfaces.length > (a?.surfaces.length ?? -1) ? b : a), null)

/** The first heading level that appears inside a surface. */
const headingLevel = (src, from, to) => {
  const h = /<h([1-6])\b/i.exec(src.slice(from, to ?? src.length))
  return h ? Number(h[1]) : 0
}

// ── the design document ──────────────────────────────────────────────────────────────────────
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
// WORD-numbers only, and that is a measured decision rather than an oversight. A bare digit
// beside a plural noun is a count far less often than it is a reference: across 37 real trees on
// the machine this was tuned against, every digit this pattern matched was one — "§1 surfaces",
// "Update 41 panels" — and both of the legitimate statements it found were spelled out ("seven
// surfaces", "four coordinated surfaces"). A fabricated number is worse here than no number at
// all, because the document comparison is the only finding in this check that speaks with
// confidence. A document that writes its count in digits is read by the LIST form below, which
// counts items instead of parsing them; the blind spot is stated in `note`.
const COUNT_SENTENCE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+((?:[a-z]+\s+){0,2})(surfaces|panels|screens|views|regions|tiles)\b/gi
// A range and an increment are both refusals to state a TOTAL, and both were being read as one.
// "one or two views" (a range) put a 57-surface scraped page against a document that named no
// number at all; "Two more screens at different resolutions would confirm" (an increment, in a
// research log) put a real project's six-surface panel against a note about taking more
// screenshots. Neither is rounded down — both are skipped, and the search moves on.
const NOT_A_TOTAL = /\b(or|to|more|other|another|additional|further|extra|fewer)\b/i
const SURFACE_HEADING = /^(#{1,6})[ \t]+.*\b(surface|panel|screen|layout|view|region)s?\b.*$/gim

/** Does this prose file state, or enumerate, how many surfaces the screen has? */
export function statedSurfaces(src) {
  SURFACE_HEADING.lastIndex = 0
  let h
  while ((h = SURFACE_HEADING.exec(src))) {
    // An enumeration of a screen's surfaces is headed by a NAME — "## Surfaces", "## The four
    // surfaces", "### Screen layout". A heading that is a sentence merely containing one of these
    // words is about something else, and its bullets are not surfaces: "### 4.5 Layout transitions
    // between panels" had two bullets about Motion's `layout` prop, and this check was reporting a
    // real project's six-surface panel as disagreeing with a document that describes two.
    const name = h[0].replace(/^#{1,6}[ \t]+/, '').replace(/^\d+(?:\.\d+)*\.?[ \t]*/, '').trim()
    if (name.split(/\s+/).length > 3) continue
    // …and it is headed by the PLURAL THING ENUMERATED, not merely by a heading that contains a
    // surface word. "## Surfaces" and "## The four surfaces" list surfaces; "# Layout",
    // "## CLI surface" and "### 2. Root Screen Containment" list rules — and all three were
    // measured fabricating a count on real trees on this machine, the worst of them putting a
    // CLI's five commands against a scraped page's 57 panels.
    const head = name.split(/\s+/).pop().replace(/[^A-Za-z]/g, '').toLowerCase()
    if (!/^(?:surfaces|panels|screens|views|regions|tiles)$/.test(head)) continue
    const depth = h[1].length
    const rest = src.slice(h.index + h[0].length)
    const stop = new RegExp(`^#{1,${depth}}[ \\t]`, 'm').exec(rest)
    const body = rest.slice(0, stop ? stop.index : rest.length)
    const items = (body.match(/^[ \t]{0,3}(?:[-*+]|\d{1,2}[.)])[ \t]+\S/gm) || []).length
    if (items >= 2) return { count: items, how: `${items} items listed under "${h[0].trim()}"` }
  }
  COUNT_SENTENCE.lastIndex = 0
  let c
  while ((c = COUNT_SENTENCE.exec(src))) {
    if (NOT_A_TOTAL.test(c[2])) continue
    return { count: NUM[c[1].toLowerCase()], how: `"${c[0].trim()}"` }
  }
  return null
}

const DESIGNISH = /(^|\/)[^/]*\b(design|direction|directions|spec|ui|ux|layout|screens?|surfaces?|wireframe|interface)[^/]*\.(md|mdx|txt|rst)$/i

// ── the check ────────────────────────────────────────────────────────────────────────────────
export const id = 'decision'
export const title = 'Machinery on screen instead of a decision'
export const why = 'The screen presents every surface it owns and no single thing to do next.'

export function run(ctx) {
  const files = ctx.markup.filter((f) => !ctx.isTestPath(f.rel))
  if (!files.length) return { findings: [], scanned: 0, note: 'no markup in this tree — nothing here presents a screen.' }

  const findings = []
  const screens = []
  const roots = []          // every markup file's widest root, control-bearing or not

  for (const f of files) {
    const c = census(f.src)
    const r = widest(c)
    if (!r) continue
    roots.push({ f, root: r, controls: c.controls })
    // A poster, a slide, an email and a rendered report are documents, not decisions. What
    // separates a screen from a document is that a screen asks you to do something.
    if (c.controls < MIN_CONTROLS) continue
    screens.push({ f, root: r })

    const n = r.surfaces.length
    if (n <= SURFACE_MAX) continue

    if (r.primaries !== 1) {
      findings.push({
        file: f.rel,
        line: ctx.lineOf(f.src, r.surfaces[SURFACE_MAX].index),
        what: `${n} top-level surfaces and ${r.primaries === 0 ? 'no primary action' : `${r.primaries} primary actions`}`,
        evidence: `${r.surfaces.slice(0, 6).map((x) => x.why).join(', ')}${n > 6 ? `, +${n - 6} more` : ''} — primary controls in this root: ${r.primaries}`,
        fix: r.primaries === 0
          ? 'name the one thing this screen wants done and give it the only primary control'
          : 'demote all but one primary, or split this into the screens those primaries belong to',
      })
    }

    // Flat weight: every surface declares itself identically and carries the same heading level,
    // so nothing on the screen outranks anything else.
    const sigs = new Set(r.surfaces.map((x) => x.sig))
    const levels = new Set(r.surfaces.map((x, i) => headingLevel(f.src, x.index, r.surfaces[i + 1]?.index)))
    if (sigs.size === 1 && levels.size === 1) {
      findings.push({
        file: f.rel,
        line: ctx.lineOf(f.src, r.surfaces[0].index),
        what: `all ${n} surfaces carry one class signature and one heading level`,
        evidence: `every surface is \`${[...sigs][0]}\` with ${[...levels][0] ? `<h${[...levels][0]}>` : 'no heading'}`,
        fix: 'give the surface that carries the answer a different weight from the ones that only explain it',
      })
    }
  }

  // ── the implementation against its own design document ─────────────────────────────────────
  // This comparison does NOT go through the control heuristic above, and that is the whole
  // repair. The founding instance — fifteen panels against a document naming four surfaces —
  // carried no interactive control at all, so "a screen asks you to do something" classified it
  // as a poster and dropped it before the two numbers ever met. The heuristic excluded the
  // reported defect by construction: a screen that asks you to do nothing IS the defect. When a
  // design document states a surface count it has already said this markup is a screen, which is
  // better evidence than any guess made from counting buttons. A bare surface census still needs
  // the guess, because it has nothing else.
  const widestOf = (list) => list.reduce((a, b) => (b.root.surfaces.length > a.root.surfaces.length ? b : a))
  const designish = ctx.prose.filter((p) => !ctx.isTestPath(p.rel) && DESIGNISH.test(p.rel))
  const docs = designish.map((p) => ({ p, stated: statedSurfaces(p.src) })).filter((d) => d.stated)

  // A tree is not always one project, and when it is not, this comparison invents a number out of
  // two unrelated files. Measured: a blog post inside one cloned repo ("ten generated screens")
  // against a scraped gallery page inside another, and a memory note about a Warframe project
  // ("four surfaces") against a plugin's report template. So a document counts only if it plausibly
  // governs that markup: same top-level directory, or both within NEAR_ROOT directories of the
  // root, which is where a project keeps the design document for its own screens
  // (`design/directions.md` beside `src/dashboard.html`). The cost is stated in `note`: a document
  // buried deeper than that, in a tree it does not share a top directory with, is not read.
  const NEAR_ROOT = 2
  const unit = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '')
  const nearRoot = (rel) => rel.split('/').length <= NEAR_ROOT + 1
  if (docs.length && roots.length) {
    // The MOST GENEROUS stated count, not the smallest. Taking the minimum was adversarial
    // selection against itself: a tree with twenty design-ish documents would be judged against
    // the loosest sentence in any of them, so the better documented a project was the more
    // certainly this fired. The claim being made is "the implementation disagrees with its own
    // stated intent" — and it only disagrees with the PROJECT once it exceeds every count the
    // project states. Disagreeing with the smallest is disagreeing with one sentence.
    const worst = widestOf(roots)
    const local = docs.filter((d) => unit(d.p.rel) === unit(worst.f.rel) || (nearRoot(d.p.rel) && nearRoot(worst.f.rel)))
    const doc = local.length ? local.reduce((a, b) => (b.stated.count > a.stated.count ? b : a)) : null
    const n = worst.root.surfaces.length
    if (doc && n >= doc.stated.count * DOC_RATIO && n > doc.stated.count + 2) {
      findings.push({
        file: worst.f.rel,
        line: null,
        what: `implementation presents ${n} surfaces where the design document describes ${doc.stated.count}`,
        evidence: `${doc.p.rel}: ${doc.stated.how} — ${worst.f.rel}: ${n} top-level surfaces in one root, ${worst.controls} interactive control${worst.controls === 1 ? '' : 's'}`,
        fix: `fold the screen back to the ${doc.stated.count} surfaces the document names, or amend the document to the structure you actually meant`,
      })
    }
  } else if (!docs.length && screens.length && widestOf(screens).root.surfaces.length > SURFACE_MAX) {
    // Speculative, so it keeps the screen requirement: "write down your surfaces" is advice, and
    // advice needs a screen in front of it before it is worth anybody's attention.
    const worst = widestOf(screens)
    findings.push({
      file: worst.f.rel,
      line: null,
      what: 'no design document states how many surfaces a screen should present',
      // Which is not the same as "there is no design document", and saying so would be a claim
      // stronger than the measurement: a tree can hold five of them and state its count in a form
      // this cannot read. The number of documents actually looked at goes in the evidence.
      evidence: designish.length
        ? `largest screen ${worst.f.rel} has ${worst.root.surfaces.length} top-level surfaces; ${designish.length} design/direction/spec document(s) in this tree, none of them stating a count in a form this reads (a spelled-out one..twelve, or a list under a heading named for the surfaces)`
        : `largest screen ${worst.f.rel} has ${worst.root.surfaces.length} top-level surfaces; no design/direction/spec document in this tree enumerates surfaces`,
      fix: 'write down the surfaces this screen is supposed to have, so the next panel added has something to disagree with',
    })
  }

  if (!screens.length) {
    return {
      findings,
      scanned: files.length,
      note: `${files.length} markup files and none of them a screen — every one is under ${MIN_CONTROLS} interactive controls, so they are documents (posters, slides, email, rendered reports) and a surface count on its own says nothing about them. The one thing still measured here is disagreement with a design document that states a count AND sits where it could be governing that markup (same top-level directory, or both within two directories of the root): the document says this markup is a screen, so the control heuristic does not get to overrule it, but a document from somewhere else in the tree is not evidence about this file at all.`,
    }
  }

  return {
    findings,
    scanned: screens.length,
    note: `${screens.length} of ${files.length} markup files are screens (>=${MIN_CONTROLS} interactive controls); the rest are documents and are not counted — except against a design document that states a surface count, which is compared with the widest markup root in the tree whether or not it carries controls. This reports a RATIO, not a verdict — a settings page, a data grid or an admin console is SUPPOSED to be a control panel, so a dense screen here is a question to answer, never automatically a defect. Thresholds: more than ${SURFACE_MAX} top-level surfaces in one root (CGC_BEHAVIOUR_SURFACE_MAX) together with a primary-action count other than exactly one; document disagreement at ${DOC_RATIO}x and at least three over (CGC_BEHAVIOUR_DOC_RATIO). Deliberately not detected: surfaces produced by a loop or by a route-level layout (the source shows one element, the screen shows twenty), surfaces assembled at runtime or inside a script block, nesting below the first surface, and anything a framework renders that is not readable as markup. Three blind spots with an author rather than an oversight, all of them on the document comparison, because that is the one finding here that speaks with confidence and a fabricated number is worse than no number. (1) It takes the WIDEST markup root, and the MOST GENEROUS count stated by a document that plausibly governs it — one in the same top-level directory, or one within two directories of the root when the markup is too. That is what stops a blog post inside one cloned repository being read against a scraped page inside another, and it costs the comparison any design document buried deeper than that in a directory its markup does not share. It is a proxy for "one project", not a test of it: a monorepo can still pair a spec with a screen from a sibling package, and in a project whose widest file is an email template or a rendered report that file is the one named — both paths and both numbers are in the evidence so a reader sees which it is in a glance. (2) A count written in DIGITS in a sentence ("the shell is 3 surfaces") is not read; only spelled-out numbers one..twelve are. Measured over 37 real trees, every digit this pattern matched was a section reference or a version number and never a count. Write the surfaces as a list under a heading and the count is read exactly, digits or not. (3) A heading is read as an enumeration only when it is at most three words AND ends in the plural thing enumerated — "## Surfaces", "## The four surfaces". "### 4.5 Layout transitions between panels" is a sentence about transitions, and "# Layout", "## CLI surface" and "### 2. Root Screen Containment" head lists of rules; all four were measured inventing a count on real trees on this machine, so a document that heads its list any other way is not read at all.`,
  }
}
