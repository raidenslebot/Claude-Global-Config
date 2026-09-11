// seams — every module is correct and the whole flow fails.
//
// The instance that named this class: the inventory store knows which account owns a stack, and
// the rename handler writes the old account's stack under the new name anyway. Switching accounts
// keeps the previous player's live node clears. Both modules pass their own tests. The defect is
// in the edge between them, and a suite of unit tests cannot see it by construction — every test
// names one module, stands it up alone, and asserts what that module does at its own interface.
//
// WHAT COVERAGE MEANS HERE, AND WHY IT IS NOT REACHABILITY.
//
// The obvious measure — for each import edge A -> B, does some test transitively REACH both A and
// B — is degenerate, and it is worth writing down why so nobody re-derives it. Reachability is
// transitive over the same graph the edge came from: if a test reaches A, and A imports B, then
// that test reaches B, always. So under that definition every edge below a tested module is
// trivially covered and the only edges left are the ones whose importer no test touches at all.
// That is plain missing coverage — a real thing, a lesser thing, and NOT this failure class. It is
// counted in the note and never reported as a seam.
//
// So a pair is measured by what a test NAMES: the own source modules it imports directly (through
// test-only helpers, which are part of the test). A test that names one module is a test of that
// module; whatever it believes about B it believes through A's interface, which is exactly where
// this defect hides. A test that names both has stood the two of them up together and can, at
// least in principle, notice that they disagree.
//
// A test that RUNS a module as a child process is the other way a pair gets stood up together, and
// missing it produced this check's first false positive: motion-render was reported against
// screen-render by a test that spawns the real motion-render CLI on a real page. A spawned process
// has no mocks in it by construction, so everything that module imports ran for real and the
// assertions are on the far end of the whole flow — which is the definition of exercising a seam.
// The spawn target is read from the quoted path the test builds its argv from, and an import
// specifier is explicitly NOT one, or every module a test merely imports would count as spawned.
//
// WHY THERE IS NO MINIMUM TREE SIZE, THOUGH THERE WAS ONE.
//
// This check used to return early on fewer than five import edges, on the reasoning that a tree
// that small cannot have a seam problem. That reasoning is false, and the counter-example is the
// instance in the paragraph above: an inventory store and a username handler is TWO modules and
// ONE edge, and the size gate is what made this check silent on the exact failure it was named
// after. Nothing else rejected it — the pair resolved, both ends were named by a test, and the
// seam scored. So size decides nothing now; it is reported in `note` as context on how small the
// sample was and no more. The gate a seam has to pass is the one that was always load-bearing:
// both endpoints are driven by some test, and no single test drives them together.
//
// WHAT IT DELIBERATELY DOES NOT SEE. Mocks — a test that names both and stubs one of them reads as
// covered here. Wiring done at runtime (a DI container, a registry, a dynamic path) is not an
// import and is invisible. Non-JS imports (Python, Ruby, Go) and unresolved path aliases are
// counted, not guessed at.

import { dirname, resolve, sep } from 'node:path'

export const id = 'seams'
export const title = 'Seams — every module is correct and the flow between them fails'
export const why = 'Two modules that each pass their own tests, with no test that stands the pair up together.'

const JS = /\.(?:[cm]?jsx?|[cm]?tsx?|vue|svelte)$/i
// The specifier is blanked in `code`, so match the syntax AROUND it and read the real text out of
// `src` at the same offset. `d` gives the offsets; the lookbehind keeps `Array.from('x')` out.
const SPEC = /(?<![.\w$])(?:from|import|require)\s*\(?\s*(['"])([^'"\r\n]*)\1/gd
const SUBPROCESS = /\b(?:child_process|spawnSync|execFileSync|execSync|spawn\s*\(|fork\s*\()/
// A quoted path a test builds argv from: 'tools/motion-render.mjs', or the bare basename inside a
// join(). Anchored on the extension so ordinary strings do not qualify.
const PATH_LITERAL = /['"]([^'"\r\n]*\.[cm]?[jt]sx?)['"]/gd

/**
 * What KIND of import this is, read from the statement in front of the specifier. Two kinds carry
 * no behaviour and would otherwise dominate a TypeScript tree: `import type {X} from` (and
 * `import {type X}`) is erased before anything runs, and `export … from` is a barrel that
 * re-exports a name without ever calling through it. Neither can have two modules disagree across
 * it, which is what a seam is. `require()` and dynamic `import()` reach here with no statement in
 * front of them and come back as plain imports, which is correct.
 */
function kindOf(before) {
  const k = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'))
  if (k < 0) return {}
  const clause = before.slice(k)
  if (!/^(?:import|export)\b[^;]*$/.test(clause) || !/\bfrom\s*['"]$/.test(clause)) return {}
  if (/^(?:import|export)\s+type\b/.test(clause)) return { typeOnly: true }
  const braces = /\{([^}]*)\}/.exec(clause)
  if (braces && braces[1].trim()) {
    const entries = braces[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (entries.every((e) => /^type\s/.test(e))) return { typeOnly: true }
  }
  return { reexport: /^export\b/.test(clause) }
}

/** Candidate files a relative specifier could mean. Resolve what is ordinary; count the rest. */
function candidates(spec) {
  const out = [spec]
  const bare = spec.replace(/\/+$/, '')
  for (const e of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte']) out.push(bare + e)
  for (const e of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']) out.push(bare + '/index' + e)
  // TypeScript ESM writes the emitted extension in the source.
  const m = /^(.*)\.([cm]?)js$/.exec(bare)
  if (m) for (const e of ['ts', 'tsx', 'mts', 'cts']) out.push(`${m[1]}.${e}`)
  return out
}

export function run(ctx) {
  const norm = (p) => p.split(sep).join('/')
  const byAbs = new Map()
  const byLower = new Map()
  for (const f of ctx.files) { byAbs.set(norm(f.abs), f); byLower.set(norm(f.abs).toLowerCase(), f) }

  const isSource = new Set(ctx.sources.filter((f) => JS.test(f.rel)).map((f) => f.rel))
  const nodes = ctx.files.filter((f) => JS.test(f.rel))
  const jsTests = nodes.filter((f) => ctx.isTestPath(f.rel))
  const out = new Map()          // rel -> Map(rel -> line of the first import)
  const specSpans = new Map()    // rel -> [[start, end]] of every import specifier, resolved or not
  let unresolved = 0

  for (const f of nodes) {
    const edges = new Map()
    const spans = []
    out.set(f.rel, edges)
    specSpans.set(f.rel, spans)
    const code = f.code
    SPEC.lastIndex = 0
    let m
    while ((m = SPEC.exec(code))) {
      const [a, b] = m.indices[2]
      spans.push([a, b])
      const spec = f.src.slice(a, b).trim()
      if (!spec) continue
      const kind = kindOf(code.slice(Math.max(0, a - 400), a))
      if (kind.typeOnly) continue
      if (!spec.startsWith('.')) {
        // `@/x`, `~/x`, `#alias` are aliases we cannot resolve without the project's config;
        // a bare package name is somebody else's code and is not a seam.
        if (/^(?:@\/|~\/|#)/.test(spec)) unresolved++
        continue
      }
      const base = dirname(f.abs)
      let hit = null
      for (const c of candidates(spec)) {
        const p = norm(resolve(base, c))
        hit = byAbs.get(p) || byLower.get(p.toLowerCase())
        if (hit) break
      }
      if (!hit) { unresolved++; continue }
      if (hit.rel === f.rel) continue
      const had = edges.get(hit.rel)
      // A module imported both ways is imported for real; the barrel is the weaker claim.
      if (!had) edges.set(hit.rel, { line: ctx.lineOf(f.src, a), reexport: !!kind.reexport })
      else if (had.reexport && !kind.reexport) { had.reexport = false; had.line = ctx.lineOf(f.src, a) }
    }
  }

  // A seam candidate is a real call-through between two own modules: source to source, and not a
  // barrel re-exporting a name it never uses.
  const candidateEdges = []
  for (const [a, edges] of out) {
    if (!isSource.has(a)) continue
    for (const [b, e] of edges) if (isSource.has(b) && !e.reexport) candidateEdges.push([a, b, e.line])
  }
  const edgeCount = candidateEdges.length

  if (!jsTests.length) {
    return { findings: [], scanned: edgeCount, note: `no JavaScript or TypeScript tests in this tree — ${edgeCount} import edges between ${isSource.size} own modules, none of them exercised by anything this check can see.` }
  }
  // What a test NAMES: own source modules it imports directly, following test-only helpers.
  const walkFrom = (start, throughTestsOnly) => {
    const seen = new Set([start])
    const found = new Set()
    const q = [start]
    while (q.length) {
      for (const b of (out.get(q.shift()) || new Map()).keys()) {
        if (isSource.has(b)) {
          found.add(b)
          if (throughTestsOnly) continue
        }
        if (seen.has(b)) continue
        seen.add(b)
        q.push(b)
      }
    }
    return found
  }

  // A basename shared by two own modules cannot identify which one a spawn meant; drop both.
  const byBase = new Map()
  for (const r of isSource) {
    const base = r.slice(r.lastIndexOf('/') + 1)
    byBase.set(base, byBase.has(base) ? null : r)
  }
  /** Own modules this test runs as a child process — read from argv paths, never from imports. */
  const spawnTargets = (t) => {
    const hits = new Set()
    if (!SUBPROCESS.test(t.code)) return hits
    const spans = specSpans.get(t.rel) || []
    PATH_LITERAL.lastIndex = 0
    let m
    while ((m = PATH_LITERAL.exec(t.src))) {
      const [a] = m.indices[1]
      if (spans.some(([s, e]) => a >= s && a < e)) continue     // that is an import, not a run
      const p = m[1]
      const hit = byBase.get(p.slice(p.lastIndexOf('/') + 1))
      if (hit && hit !== t.rel) hits.add(hit)
    }
    return hits
  }

  const named = new Map()     // source rel -> count of tests that drive it
  const reached = new Set()   // source rel -> reached transitively by some test
  const groups = []           // sets of modules that some test ran together, unmocked
  let isolated = 0
  let spawners = 0
  let inGraph = 0
  let reachOne = 0
  for (const t of jsTests) {
    const d = walkFrom(t.rel, true)
    const all = walkFrom(t.rel, false)
    for (const b of all) reached.add(b)
    const spawned = spawnTargets(t)
    const drives = new Set([...d, ...spawned])
    if (!drives.size) continue
    inGraph++
    groups.push(d)
    for (const s of spawned) groups.push(new Set([s, ...walkFrom(s, false)]))
    for (const b of drives) {
      named.set(b, (named.get(b) || 0) + 1)
    }
    if (spawned.size) spawners++
    if (drives.size === 1 && !spawned.size) isolated++
    if (all.size === 1) reachOne++
  }

  const fanIn = new Map()
  for (const [a, edges] of out) {
    if (!isSource.has(a)) continue
    for (const [b, e] of edges) if (isSource.has(b) && !e.reexport) fanIn.set(b, (fanIn.get(b) || 0) + 1)
  }

  const seams = []
  let oneSided = 0
  for (const [a, b, line] of candidateEdges) {
    const ta = named.get(a) || 0
    const tb = named.get(b) || 0
    if (groups.some((g) => g.has(a) && g.has(b))) continue
    // A seam with an untested endpoint is missing coverage, not this failure class.
    if (!ta || !tb) { oneSided++; continue }
    seams.push({ a, b, line, ta, tb, fan: fanIn.get(b) || 0, score: 2 * (fanIn.get(b) || 0) + Math.min(ta, tb) })
  }
  seams.sort((x, y) => y.score - x.score || y.fan - x.fan || x.a.localeCompare(y.a))

  // One hub can own every uncovered edge in a tree, and ten lines that all end at the same module
  // say one thing ten times. Three per target leaves room for the other hubs underneath it.
  const perTarget = new Map()
  const shown = seams.filter((s) => {
    const n = (perTarget.get(s.b) || 0) + 1
    perTarget.set(s.b, n)
    return n <= 3
  })
  const perTargetDropped = seams.length - shown.length

  const findings = shown.slice(0, 10).map((s) => ({
    file: s.a,
    line: s.line,
    what: 'this pair is never stood up together by any test, though both modules are tested alone',
    evidence: `${s.a} imports ${s.b}; ${s.ta} test(s) drive ${s.a}, ${s.tb} drive ${s.b}, none drives both; ${s.fan} module(s) import ${s.b}`,
    fix: `write one test that drives ${s.a} against the real ${s.b} and asserts what crosses between them`,
  }))

  const pct = inGraph ? Math.round((isolated / inGraph) * 100) : 0
  const bits = []
  // Size is NOT a gate. This check used to return early under five edges, and that threshold was
  // what silenced its own founding instance: two modules, one edge, one unit test each. The count
  // is still worth saying, because a reader of a two-edge tree should know the sample is that
  // small — but it decides nothing.
  if (edgeCount < 5) bits.push(`only ${edgeCount} import edge(s) between own modules — a small sample, though not a gate: the instance that named this class was two modules and one edge`)
  bits.push(`${isolated}/${inGraph} tests (${pct}%) name exactly one own module and drive no subprocess${pct >= 70 ? ' — a suite this isolated cannot detect a seam defect by construction' : ''}`)
  if (spawners) bits.push(`${spawners} test(s) run an own module as a child process, which counts everything that module imports as exercised together`)
  if (reachOne !== isolated) bits.push(`${reachOne} test(s) reach exactly one own module transitively`)
  if (jsTests.length > inGraph) bits.push(`${jsTests.length - inGraph} test(s) reach no own module at all and were left out of that fraction`)
  const unTested = [...isSource].filter((r) => !reached.has(r)).length
  if (unTested) bits.push(`${unTested} own module(s) no test reaches at all — plain missing coverage, not counted as seams`)
  if (oneSided) bits.push(`${oneSided} uncovered edge(s) had an endpoint no test names, and were dropped for the same reason`)
  // Two different reasons a seam is not printed, and they were previously reported as one number
  // under the per-target reason — which on this repo blamed the hub cap for three drops the cap
  // did not make. A ranked seam that fell off the end is a different fact from a hub saying the
  // same thing a fourth time, and the reader acts on them differently.
  if (perTargetDropped) bits.push(`${perTargetDropped} more seam(s) not listed, at most three per imported module`)
  if (shown.length > findings.length) bits.push(`${shown.length - findings.length} further seam(s) ranked below the ten listed and cut by that limit, not by the per-module cap`)
  if (unresolved) bits.push(`${unresolved} specifier(s) unresolved (path aliases, generated or oversized files) and therefore invisible here`)
  bits.push('mocks, runtime wiring and non-JS imports are not detected')

  return { findings, scanned: edgeCount, note: bits.join(' · ') + '.' }
}
