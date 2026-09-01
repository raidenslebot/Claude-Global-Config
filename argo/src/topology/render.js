/**
 * render.js — draw the declared graph so a human can see what they agreed to.
 *
 * a lint result tells you a rule broke. a picture tells you why the rule exists.
 * peer edges are drawn red because they are the ones that quietly turn one wrong
 * step into four, and shared state gets its own node shape because it is a
 * channel too — a slower one, with more writers on it than anyone remembers.
 *
 * both renderers are pure string builders over the declaration in file order, so
 * the diagram in a pull request diffs only when the topology actually changed.
 */

const PEER = '#e5484d'
const BROADCAST = '#d9822b'

function mermaidLabel(text) {
  return String(text).replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ')
}

function dotLabel(text) {
  return String(text).replace(/["\\]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

/** Escape first, join second — otherwise the escaper eats graphviz's own line break. */
function dotLines(...parts) {
  return parts.filter(Boolean).map(dotLabel).join('\\n')
}

/** Stable synthetic ids — agent ids contain dashes, which mermaid reads as edges. */
function idMap(decl) {
  const agents = new Map()
  decl.agents.forEach((a, i) => agents.set(a.id, `a${i}`))
  const states = new Map()
  decl.sharedState.forEach((s, i) => states.set(s.id, `s${i}`))
  return { agents, states }
}

/**
 * Mermaid flowchart of the declared topology.
 *
 * @param {object} decl  a normalised declaration (from normalise())
 * @param {object} [opts]
 * @param {string} [opts.direction] mermaid direction, default 'TD'
 */
export function renderMermaid(decl, { direction = 'TD' } = {}) {
  const { agents, states } = idMap(decl)
  const L = [`flowchart ${direction}`]
  const links = []

  if (decl.name) L.push(`  %% ${mermaidLabel(decl.name)}`)

  for (const a of decl.agents) {
    const node = agents.get(a.id)
    const sub = a.model ? `<br/><small>${mermaidLabel(a.model)}</small>` : ''
    // agentType is the definition that will actually be dispatched; role is only
    // the shape of the box. Draw both, so a mis-typed type is visible in review.
    const kind = a.agentType ? `${a.role} · ${a.agentType}` : a.role
    const label = `${mermaidLabel(a.id)}<br/><i>${mermaidLabel(kind)}</i>${sub}`
    // Supervisors get the subroutine shape so the chain of command reads at a glance.
    L.push(a.role === 'supervisor' ? `  ${node}[["${label}"]]` : `  ${node}["${label}"]`)
  }

  for (const s of decl.sharedState) {
    const detail = `${s.writers.length} writer(s) · ${s.readers.length} reader(s)`
    L.push(`  ${states.get(s.id)}[("${mermaidLabel(s.id)}<br/>${detail}")]`)
  }

  for (const e of decl.edges) {
    const from = agents.get(e.from)
    const to = agents.get(e.to)
    if (!from || !to) continue
    if (e.kind === 'peer') {
      links.push({ text: `  ${from} ==>|peer| ${to}`, style: `stroke:${PEER},stroke-width:2px` })
    } else if (e.kind === 'report') {
      links.push({ text: `  ${from} -.->|report| ${to}`, style: '' })
    } else if (e.kind === 'broadcast') {
      links.push({ text: `  ${from} -.->|broadcast| ${to}`, style: `stroke:${BROADCAST},stroke-width:2px` })
    } else {
      links.push({ text: `  ${from} -->|dispatch| ${to}`, style: '' })
    }
  }

  for (const s of decl.sharedState) {
    const node = states.get(s.id)
    for (const w of s.writers) {
      const from = agents.get(w)
      if (from) links.push({ text: `  ${from} -->|writes| ${node}`, style: `stroke:${BROADCAST}` })
    }
    for (const r of s.readers) {
      const to = agents.get(r)
      if (to) links.push({ text: `  ${node} -.->|reads| ${to}`, style: '' })
    }
  }

  for (const link of links) L.push(link.text)
  links.forEach((link, i) => {
    if (link.style) L.push(`  linkStyle ${i} ${link.style};`)
  })

  L.push('  classDef supervisor fill:#1f2d3b,stroke:#5a8cc0,color:#dbe9f5;')
  L.push('  classDef worker fill:#1f2b22,stroke:#5aa06a,color:#dcf0e2;')
  L.push('  classDef state fill:#3b1f1f,stroke:#b45252,color:#f5d5d5;')

  const sup = decl.agents.filter((a) => a.role === 'supervisor').map((a) => agents.get(a.id))
  const wrk = decl.agents.filter((a) => a.role !== 'supervisor').map((a) => agents.get(a.id))
  if (sup.length > 0) L.push(`  class ${sup.join(',')} supervisor;`)
  if (wrk.length > 0) L.push(`  class ${wrk.join(',')} worker;`)
  if (decl.sharedState.length > 0) {
    L.push(`  class ${decl.sharedState.map((s) => states.get(s.id)).join(',')} state;`)
  }

  return L.join('\n')
}

/** Graphviz rendering of the same graph, for anywhere mermaid is not available. */
export function renderDot(decl) {
  const L = ['digraph topology {']
  L.push('  rankdir=TB;')
  L.push('  graph [fontname="Helvetica", labelloc="t"];')
  if (decl.name) L.push(`  label="${dotLabel(decl.name)}";`)
  L.push('  node [fontname="Helvetica", shape=box, style=rounded];')
  L.push('  edge [fontname="Helvetica", fontsize=10];')

  for (const a of decl.agents) {
    const shape = a.role === 'supervisor' ? 'doubleoctagon' : 'box'
    const kind = a.agentType ? `${a.role} · ${a.agentType}` : a.role
    const label = dotLines(a.id, a.model ? `${kind} · ${a.model}` : kind)
    L.push(`  "${dotLabel(a.id)}" [shape=${shape}, label="${label}"];`)
  }

  for (const s of decl.sharedState) {
    const label = dotLines(s.id, `${s.writers.length} writer(s) · ${s.readers.length} reader(s)`)
    L.push(`  "state:${dotLabel(s.id)}" [shape=cylinder, style=filled, fillcolor="#f5d5d5", label="${label}"];`)
  }

  for (const e of decl.edges) {
    const head = `  "${dotLabel(e.from)}" -> "${dotLabel(e.to)}"`
    if (e.kind === 'peer') {
      L.push(`${head} [label="peer", color="${PEER}", fontcolor="${PEER}", penwidth=2];`)
    } else if (e.kind === 'report') {
      L.push(`${head} [label="report", style=dashed];`)
    } else if (e.kind === 'broadcast') {
      L.push(`${head} [label="broadcast", style=dotted, color="${BROADCAST}", fontcolor="${BROADCAST}"];`)
    } else {
      L.push(`${head} [label="dispatch"];`)
    }
  }

  for (const s of decl.sharedState) {
    for (const w of s.writers) {
      L.push(`  "${dotLabel(w)}" -> "state:${dotLabel(s.id)}" [label="writes", color="${BROADCAST}"];`)
    }
    for (const r of s.readers) {
      L.push(`  "state:${dotLabel(s.id)}" -> "${dotLabel(r)}" [label="reads", style=dashed];`)
    }
  }

  L.push('}')
  return L.join('\n')
}
