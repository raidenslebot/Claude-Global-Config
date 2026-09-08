#!/usr/bin/env node
/**
 * pre-tool-workflow-policy.js — carry model routing into workflow fan-outs.
 *
 * THE GAP THIS CLOSES
 * pre-tool-model-route.js assigns every spawned agent a model by task difficulty. It fires on
 * the Agent tool. Workflow agents are dispatched by the Workflow RUNTIME, never through the
 * Agent tool, so it never fires for them — and a six-worker fan-out ran every worker on the
 * session model, including one that edited a single YAML file. On a pinned session that is
 * still correct (they inherit); on a routable one it is pure over-assignment.
 *
 * The Workflow tool itself IS a tool call. So this fires on it, reads the session model, and
 * injects the policy into the script's `args` before the script runs:
 *
 *   args.__modelPolicy = { sessionModel, pinned, signals }
 *
 * The script then applies the same classifier to each agent's prompt. Two constraints decide
 * the shape: scripts have no filesystem access and cannot import, so the vocabulary travels
 * in `args`; and hooks may not import each other, so this file carries its OWN copy of the
 * signal sources. A test asserts the copy is byte-identical to the one in
 * pre-tool-model-route.js — change a signal there and the test names this file.
 *
 * Only a plain-object (or absent) `args` can carry the policy. A primitive `args` — a bare
 * string brief — is left untouched, and that workflow inherits. Rewriting a user's string
 * into an object would change what the script sees and break it.
 *
 * IT ALSO REFUSES. Injecting a routing table was advisory — the script has to read it, and a
 * script written for the task at hand does not; exactly one shipped workflow ever did. So this
 * also audits the script's text and returns `permissionDecision: 'deny'`, naming the fix, for
 * four defects that are visible before a single agent starts: agents that route nowhere, a
 * fan-out as wide as its data, a fan-out wider than an account can serve, and a verdict that
 * treats "every verifier died" as agreement. Each is refusable because each is a fact about the
 * text rather than a judgement about the task, and a deliberate exception is written into the
 * script as `cgc-audit-ack: <code>` so that it has an author.
 *
 * Exits 0 always; silent when it has nothing to change.
 */

const fs = require('node:fs')

const TAIL_BYTES = 256 * 1024

// ── Identical to pre-tool-model-route.js SIGNAL_SOURCES. Kept in sync by test, not by hand. ──
const SIGNAL_SOURCES = {
  /** Work where being wrong is expensive and hard to detect. Vetoes every downgrade. */
  JUDGMENT: [
    // `design` and `architecture` as VERBS or bare nouns are judgment. As the first half of a
    // compound domain noun — "design direction", "design tokens", "architecture diagram" —
    // they name the artifact, not the task, and the task is whatever verb governs them.
    // Without the lookahead "review this design direction" inherited the session model
    // instead of routing to opus: safe, but pure over-assignment on the judge role.
    '\\b(design(?! (direction|directions|system|systems|token|tokens|language|brief|file|files|doc|docs))|architect|architecture(?! (diagram|diagrams|doc|docs|document|overview))|decide|decision|choose|recommend|evaluate|assess)\\b',
    '\\b(trade-?offs?|approach|strategy|should we|best way|best approach|which is better)\\b',
    '\\b(ambigu\\w+|unclear|figure out|work out|reason about|think through)\\b',
    '\\b(refactor|redesign|rewrite|restructure|migrate)\\b',
    '\\b(root cause|diagnose|debug|investigate)\\b',
    '\\b(synthesi[sz]e|reconcile|resolve the|weigh|prioriti[sz]e)\\b',
    // BARE `why`. The narrow form `why (is|does|did|are)` missed "and why each one fails" and
    // "why the doctor command takes 8 seconds", both of which are diagnosis. Asking why is
    // always reasoning, whatever verb follows.
    '\\bwhy\\b',
    // Asking what something MEANS is interpretation, not retrieval.
    '\\b(explain|interpret|implication|what (does|do) (this|that|these|it) mean|means? for)\\b',
    // A trailing "and pick/choose one" turns an enumeration into a decision. The veto scans the
    // whole text, so naming these verbs is enough — no clause splitting required.
    '\\b(pick|select) (one|the|which)\\b',
    // "which X should ..." is a decision even when a verification NOUN sits in the subject:
    // "which model should a scan-verifier agent run on" is choosing, not verifying. Without
    // this, VERIFY matched the topic word and answered one tier below the session model.
    '\\b(which|what)\\b[^.?!]{0,24}\\bshould\\b',
    // Defect and quality nouns. "Where is the bug" reads like a lookup and is a hunt; the noun,
    // not the question frame, carries the difficulty.
    '\\b(bug|bugs|defect|defects|flaw|flaws|broken|failing|regression)\\b',
    '\\b(unsafe|unsafely|insecure|vulnerab\\w+|injection|exploit|security hole)\\b',
    // Performance work is diagnosis even when phrased as a search.
    '\\b(slow|slowness|bottleneck|takes \\d+ ?(s|ms|sec|second|minute))\\b',
    // "actually safe / actually correct" is a claim under test, never a count.
    '\\bactually (safe|correct|right|fixed|works?|working)\\b',
  ],
  /** Checking someone else's work. High reasoning, but the context is handed to it. */
  VERIFY: [
    '\\b(review|reviewing|verify|verif\\w+|validate|audit|auditing)\\b',
    '\\b(adversarial|critique|scrutin\\w+|double-?check|sanity-?check)\\b',
    // A noun may sit between the subject and the adjective: "is this FINDING real",
    // "is the fix correct". The tight form missed every one of those.
    '\\bis\\b[^.?!]{0,30}\\b(correct|right|real|valid|sound|accurate|true)\\b',
    '\\bdoes\\b[^.?!]{0,30}\\b(actually|really|correctly)\\b',
    '\\b(find|check for|look for)\\b[^.?!]{0,30}\\b(bugs|flaws|defects|vulnerabilit\\w+|problems|issues|holes)\\b',
    '\\b(security (review|audit)|threat model|check whether|confirm whether)\\b',
    '\\b(prove|disprove|refute|corroborate)\\b',
  ],
  /** Carrying out a decision that is already stated. */
  SPECIFIED: [
    '\\b(implement|apply|write|add|create) (the|this|these) (change|changes|fix|patch|spec|specification|plan|design|function|method|test|tests)\\b',
    '\\baccording to the (spec|specification|plan|design|description)\\b',
    '\\bas (described|specified|outlined|detailed) (above|below|in)\\b',
    '\\b(port|translate|convert) (this|the) \\w+ (to|into)\\b',
    '\\bwrite tests? (for|that cover) the\\b',
  ],
  /** Retrieval and mechanical transformation. No decision is required to do it correctly. */
  MECHANICAL: [
    '\\b(list|enumerate|inventory|catalogue|catalog|tally|count) (all|every|each|the)\\b',
    '\\b(find|locate) (all|every|each|the) (file|files|occurrence|occurrences|instance|instances|usage|usages|reference|references|line|lines|definition)\\b',
    '\\b(grep|search) (for|the (codebase|repo|tree|files))\\b',
    '\\b(which|what) files\\b',
    '\\bwhere (is|are) (the|it|this)\\b',
    '\\b(read|extract|collect|gather|report) (the|all|every)[^.]{0,40}\\b(and (list|report|return|output))\\b',
    '\\brun (the )?(tests?|test suite|lint|linter|build|command)\\b',
    '\\b(rename|reformat|reindent|sort|deduplicate) (all|every|the)\\b',
  ],
  // A mutating verb beside a mechanical one — "run the tests and fix any failures", "grep for
  // TODO and remove each one" — means the agent decides what to change. This vetoes only the
  // haiku downgrade; it routes nothing upward on its own.
  MUTATE: [
    '\\b(fix|fixes|fixing|repair|repairs|resolve|resolves|remove|delete|replace|rewrite|refactor|migrate|correct)\\b',
  ],
  /** Agent types whose job is fixed by their definition, regardless of prompt wording. */
  TYPE_VERIFY: 'review|verif|audit|critic|security|adversar|scan-verifier|patch-verifier',
  TYPE_SEARCH: '^(explore|.*:explore)$',
}

/** Model id on the most recent fact in the transcript, or null. Same logic as the sibling
 *  hooks: a `/model` command record beats an older assistant message, so a switch is seen on
 *  the very next prompt rather than one turn late. */
function currentModel(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null
  let text
  try {
    const size = fs.statSync(transcriptPath).size
    const start = Math.max(0, size - TAIL_BYTES)
    const fd = fs.openSync(transcriptPath, 'r')
    try {
      const buf = Buffer.alloc(Math.min(size, TAIL_BYTES))
      fs.readSync(fd, buf, 0, buf.length, start)
      text = buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const sw = line.match(/<command-name>\/model<\/command-name>[\s\S]{0,300}?<command-args>([A-Za-z0-9._\[\]-]{4,60})<\/command-args>/)
    if (sw) return sw[1]
    let j
    try { j = JSON.parse(line) } catch { continue }
    const m = (j && j.message && j.message.model) || (j && j.model)
    if (typeof m === 'string' && m.length > 3) return m
  }
  return null
}

/** 'pinned' when no coarse alias can express this model; otherwise 'routable'. */
function classify(model) {
  if (!model) return null
  const id = String(model).toLowerCase()
  const routable =
    /(^|[^0-9])claude-(opus-5|sonnet-5|fable-5|haiku-4-5)/.test(id) ||
    /^(opus|sonnet|fable|haiku)$/.test(id)
  return routable ? 'routable' : 'pinned'
}


// ── the gate ────────────────────────────────────────────────────────────────────────────────
//
// WHY THIS IS A GATE AND NOT A NOTE. Injecting `__modelPolicy` into args was advisory: the
// script has to read it, and a script authored for the task at hand does not. Measured on a real
// run — factorx-spec-review, 2026-09-06 — the policy arrived in args, was ignored, and all 1,000
// agents ran on the session model. The same run had no cap between finding and verifying (590
// findings x 2 verifiers = 1,193 agents wanted against a 1,000 backstop) and collapsed its votes
// with `vs.length > 0 && vs.every(...)`, which returns "not refuted" for an EMPTY vote list. 931
// agents then died on the account's session limit, and every finding whose verifiers died was
// reported as confirmed: 491 "confirmed" defects, of which 421 had no verification at all and 70
// had half. Of the 169 findings that got two working verifiers, ZERO survived. The run cost
// 8.67M tokens to produce a result whose verified subset was empty.
//
// None of those three is a judgement call, and all three are visible in the script's text before
// a single agent starts. So they are refused, with the fix named. A script that means to do one
// of them anyway says so in a comment — `// cgc-audit-ack: <code>` — and the acknowledgement is
// the record that somebody decided rather than forgot.

/**
 * Blank out string, template and comment CONTENT so a search sees code and not prose. Length is
 * preserved so offsets still line up. Interpolations inside a template are code and stay: a
 * prompt that merely contains the word "agent(" must not read as a call site, while
 * `${agent(x)}` genuinely is one.
 */
function stripLiterals(src) {
  const out = src.split('')
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' ' }
  let i = 0
  const tpl = []                       // template-literal nesting: brace depth of each ${...}
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') blank(i++); continue }
    if (c === '/' && d === '*') { blank(i++); blank(i++); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank(i++); blank(i++); blank(i++); continue }
    if (c === "'" || c === '"') {
      const q = c; i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') blank(i++); blank(i++) }
      i++; continue
    }
    if (c === '`') {
      i++
      while (i < src.length) {
        if (src[i] === '\\') { blank(i++); blank(i++); continue }
        if (src[i] === '`') { i++; break }
        if (src[i] === '$' && src[i + 1] === '{') { i += 2; tpl.push(1); break }   // code resumes
        blank(i++)
      }
      continue
    }
    if (tpl.length && c === '{') { tpl[tpl.length - 1]++; i++; continue }
    if (tpl.length && c === '}') {
      tpl[tpl.length - 1]--
      if (tpl[tpl.length - 1] === 0) {                                            // back into the template
        tpl.pop(); i++
        while (i < src.length) {
          if (src[i] === '\\') { blank(i++); blank(i++); continue }
          if (src[i] === '`') { i++; break }
          if (src[i] === '$' && src[i + 1] === '{') { i += 2; tpl.push(1); break }
          blank(i++)
        }
        continue
      }
      i++; continue
    }
    i++
  }
  return out.join('')
}

/**
 * The three refusals. `routable` is false on a pinned session, where inheritance is the rule and
 * naming a model would be wrong — so the routing fault is not raised there.
 *
 * @returns {{code: string, why: string, fix: string}[]}
 */
function auditWorkflow(script, { routable }) {
  const src = String(script || '')
  const code = stripLiterals(src)
  // `[ \t]` and not `\s`: written as `ack:\s` the source contains "k:\", which is exactly the
  // shape of a Windows drive path — and the gate that keeps real drive paths out of installed
  // hooks reads it as one. The guard is right to be strict, so the regex avoids the collision.
  const acked = new Set([...src.matchAll(/cgc-audit-ack:[ \t]*([a-z-]+)/g)].map((m) => m[1]))
  const faults = []
  const add = (code_, why, fix) => { if (!acked.has(code_)) faults.push({ code: code_, why, fix }) }

  // 1. A fan-out whose width comes from the data, with nothing bounding it. An array LITERAL is
  //    bounded by construction; an identifier is only bounded if something slices it.
  // What "bounded" means, calibrated against the two real scripts. A literal array is bounded
  // only if nothing is SPREAD into it: `[0, 1]` is two, `[...seen.values()]` is however many the
  // data had — and that second one is the exact expression that put 590 findings into a fan-out
  // with a 1000-agent ceiling. Array.from({length: n}) states its own width. An identifier is
  // bounded when its declaration slices, states a length, or is itself the result of a bounded
  // fan-out; the declaration is read across lines, because a capped list is usually a ternary.
  /**
   * The initialiser of `const <name> = …`, exactly — from the `=` to the newline at which every
   * bracket it opened has closed again.
   *
   * Two cheaper versions of this were wrong in opposite directions. Stopping at the first line
   * that began with a keyword ran straight past the end of a one-line declaration into the next
   * statement, so `const u = [...seen.values()]` followed by `await pipeline(u, …)` read as "u is
   * the result of a fan-out" and the unbounded case was called bounded. Capping the scan at 400
   * characters then failed the other way: a declaration whose initialiser is a multi-line
   * `parallel(...)` never closed inside the cap, matched nothing, and a bounded list was called
   * unbounded. Depth is the thing that actually delimits a statement, so count it.
   */
  const declarationOf = (name) => {
    const at = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).exec(code)
    if (!at) return ''
    let i = at.index + at[0].length
    const start = i
    let depth = 0
    for (; i < code.length && i - start < 4000; i++) {
      const c = code[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === '\n' && depth <= 0 && i > start) {
        // Depth alone ends a statement one line too early when the statement is a multi-line
        // ternary: `const OPERATORS = (cond)` closes its bracket, and the `? … : ALL.slice(0, 5)`
        // that actually bounds it lives on the next two lines. A line that ends on an operator,
        // or the next one that opens with one, is a continuation rather than an end.
        const before = code.slice(0, i).trimEnd().slice(-1)
        const after = code.slice(i + 1).trimStart().slice(0, 2)
        const opensWith = /^[?:.+*/%&|,)\]}]|^(?:&&|\|\||\?\?)/.test(after)
        const endsWith = /[=+\-*/%?:&|,([{]/.test(before)
        if (!opensWith && !endsWith) break
      }
    }
    return code.slice(start, i)
  }

  const boundedName = (name) => {
    const body = declarationOf(name)
    if (/\.slice\s*\(|Array\s*\.\s*from\s*\(/.test(body)) return true
    // Anchored: the fan-out must BE this declaration, not merely appear somewhere after it.
    if (/^\s*await\s+(?:parallel|pipeline)\s*\(/.test(body)) return true       // as wide as its own source
    if (/^\s*\[/.test(body) && !/\.\.\./.test(body)) return true              // a literal, nothing spread in
    return new RegExp(`\\b${name}\\s*\\.\\s*slice\\s*\\(`).test(code)
  }
  // Capture EITHER the opening bracket of a literal OR a whole identifier. A character class
  // holding both ran them together and yielded "[0" as a name, which is not a name — and the
  // RegExp built from it threw inside the hook, where a throw is a silent no-op.
  const fans = [...code.matchAll(/\b(?:parallel|pipeline)\s*\(\s*(\[|[A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  for (const name of [...new Set(fans)]) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === 'Array') continue   // a literal, or Array.from's stated width
    if (boundedName(name)) continue
    {
      add('unbounded-fanout',
        `the fan-out over "${name}" is as wide as the data: nothing slices it, and it is not a literal array`,
        `cap it — \`const capped = ${name}.slice(0, MAX)\` — and log() how many were dropped, or acknowledge with "// cgc-audit-ack: unbounded-fanout". The runtime stops at 1000 agents per workflow and a pipeline stage that throws drops its item to null, so an uncapped fan-out does not fail loudly; it silently reports on the part that fitted.`)
    }
  }


  // ── how many agents this script can actually dispatch ─────────────────────────────────────
  //
  // Refusing an UNBOUNDED fan-out is not enough, and the hole was found within the hour: the
  // rule said "cap it" and never said what a cap may be, so `.slice(0, 500)` satisfied it and
  // still asks for five hundred agents.
  //
  // The number that matters is not the runtime's 1,000-agent backstop — that is a runaway guard,
  // not a budget. It is what an account can actually serve. Measured on the run that made this
  // gate necessary: 69 agents completed and consumed 8,665,098 tokens — about 125,600 each,
  // because each was reading a whole language specification — and that was a session limit,
  // reached from nothing, in thirty minutes. The other 931 agents existed only to fail. So a
  // script asking for four figures is not ambitious; it is asking for something no account can
  // serve, and the failures land on whatever it needed the rest of the day for.
  const CEILING = Number(process.env.CGC_WORKFLOW_AGENT_CEILING || 40)

  /** A literal, or a name whose declaration is one (`const JUDGES = input.n || 3`). */
  const numOf = (token) => {
    if (/^\d+$/.test(token)) return Number(token)
    const m = /^\s*(?:[\w.]+\s*\|\|\s*)?(\d+)\s*$/.exec(declarationOf(token))
    return m ? Number(m[1]) : null
  }

  /** How many items a fan-out over this expression iterates, or null when it cannot be known. */
  const widthOf = (expr, seen = new Set()) => {
    const e = String(expr || '').trim()
    let m
    if ((m = /^\[([^\]]*)\]/.exec(e))) {
      if (/\.\.\./.test(m[1])) return null                 // a spread is not a width
      return m[1].trim() ? m[1].split(',').length : 0
    }
    if ((m = /^Array\s*\.\s*from\s*\(\s*\{\s*length\s*:\s*([\w.]+)/.exec(e))) return numOf(m[1])
    if ((m = /^([A-Za-z_$][\w$]*)/.exec(e))) {
      const name = m[1]
      if (seen.has(name)) return null                      // a cycle is not a width
      seen.add(name)
      const body = declarationOf(name)
      let d
      if ((d = /\.slice\s*\(\s*\d+\s*,\s*([\w.]+)\s*\)/.exec(body))) return numOf(d[1])
      if ((d = /^\s*await\s+(?:parallel|pipeline)\s*\(([\s\S]*)$/.exec(body))) return widthOf(d[1], seen)
      if (/^\s*\[/.test(body)) return widthOf(body, seen)
      return null
    }
    return null
  }

  // Every fan-out, with the span of its own call, so that one INSIDE another multiplies rather
  // than adds: two phases in sequence are 13 + 20, the same two nested are 13 x 20.
  const sites = []
  for (const m of code.matchAll(/\b(?:parallel|pipeline)\s*\(/g)) {
    let i = m.index + m[0].length, depth = 1
    const argStart = i
    for (; i < code.length && depth > 0; i++) {
      const c = code[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
    }
    sites.push({ start: m.index, end: i, width: widthOf(code.slice(argStart, i)) })
  }
  const inside = (a, b) => a.start > b.start && a.end <= b.end
  let worst = 0
  for (const site of sites) {
    if (sites.some((other) => other !== site && inside(site, other))) continue   // counted by its parent
    const nested = sites.filter((other) => other !== site && inside(other, site))
    let n = site.width
    for (const child of nested) { if (n !== null && child.width !== null) n *= child.width }
    if (n !== null) worst += n
  }
  if (worst > CEILING) {
    add('fanout-exceeds-budget',
      `this script can dispatch about ${worst} agents, and the ceiling is ${CEILING}`,
      `narrow it. Verify the ranked top of the list rather than all of it, or use fewer verifiers per item; a finder that produces hundreds of items is usually the thing to fix, not the thing to scale. On the run this ceiling comes from, 69 agents of that weight were an entire session limit — so a fan-out in the hundreds cannot complete, and the agents past the limit fail rather than answer. Raise it deliberately with CGC_WORKFLOW_AGENT_CEILING, or acknowledge with "// cgc-audit-ack: fanout-exceeds-budget".`)
  }

  // 2. Votes that survived are counted, but nothing says what happens when NONE did. That is the
  //    line that turned 421 unverified findings into "confirmed".
  if (/\.filter\s*\(\s*Boolean\s*\)/.test(code) && /\bagent\s*\(/.test(code)) {
    // The tell is narrow on purpose, because "handled" and "unhandled" look alike. A ternary on
    // the count — `scores.length ? Math.max(...scores) : 10` in design-divergence, where 10 is the
    // WORST score — decides the empty case pessimistically and is correct. What is not correct is
    // `vs.length > 0 && vs.every(...)`: with no survivors that whole expression is false, the
    // negation is true, and a finding nobody checked is reported as confirmed. That is the shape,
    // and only that shape, that this refuses.
    const saysEmpty = /\.length\s*===\s*0|\.length\s*<\s*\d|\.length\s*!==\s*\d|\.length\s*\?|\bif\s*\(\s*!\s*\w+\.length/.test(code)
    const failsOpen = /\.length\s*>\s*0\s*&&/.test(code)
    if (failsOpen && !saysEmpty) {
      add('verdict-fails-open',
        'surviving results are filtered with filter(Boolean) but nothing branches on there being NONE — an agent that dies returns null, so a verdict computed from an empty list is a verdict nobody reached',
        'decide the empty case explicitly — \`if (votes.length === 0) return { ...f, verdict: "unverified" }\` — and never let it collapse to the affirmative. An agent dies on a terminal API error or when the account hits its session limit, which is exactly when a fan-out is largest.')
    }
  }

  // 3. Agents with no model on a session where the aliases can express one. The policy is in
  //    args; a script that neither uses it nor names a model runs the whole fleet on the session
  //    model, which is what "the model is still not being changed" looks like from outside.
  if (routable && /\bagent\s*\(/.test(code)) {
    const routes = /__modelPolicy|\bmodel\s*:/.test(code)
    if (!routes) {
      add('unrouted-fanout',
        'every agent() in this script inherits the session model: it neither names a model nor reads the __modelPolicy this hook puts in args',
        'route each agent by the hardest decision it must make alone — retrieval and mechanical passes to "haiku", work scoped to a stated spec to "sonnet", verification to "opus", genuinely open questions omitted so they inherit. See the model-routing skill; workflows/design-divergence.js carries the helper.')
    }
  }

  // ── models typed in by hand, with the policy in args and unread ────────────────────────────
  //
  // `unrouted-fanout` above asks only whether a model is NAMED, and a literal satisfies it. That
  // is not the same as being ROUTED, and the difference was measured on a real run: seven agents
  // whose models were written into the script by hand, where the classifier — never consulted —
  // disagreed with every one of the five it could read. Two were sonnet that should have been
  // haiku; three were sonnet that should have INHERITED, so hand-picking was not even reliably
  // the cheaper mistake. It is simply a different answer, arrived at without the rule.
  //
  // AND ON A PINNED SESSION IT IS A CORRECTNESS FAILURE, which is why this fault is not gated on
  // `routable` the way the one above is. When the session runs a version the coarse aliases
  // cannot express, inheritance is the ONLY mechanism that reproduces it, and the mandate calls
  // that absolute. A literal `model: 'sonnet'` overrides it — the fleet silently runs something
  // the session did not choose. `routeModel` returns undefined for every agent when the policy
  // says pinned, so a script that asks the policy cannot make that mistake; one that hardcodes
  // cannot avoid it.
  if (/\bagent\s*\(/.test(code)) {
    // Found in the STRIPPED code and read from the SOURCE. Stripping blanks a literal's contents
    // character for character, so `model: 'sonnet'` becomes `model: '      '` — which means the
    // stripped text still shows WHERE a model was assigned in code, while a `model:` that merely
    // appears inside a prompt has been blanked away entirely and cannot be mistaken for one.
    // Offsets survive because the blanking preserves length, so the real value is the same span
    // of the original. Matching the source directly would have flagged any prompt that discusses
    // models; matching the stripped text alone would have lost the value.
    const literals = [...code.matchAll(/\bmodel\s*:\s*(['"`])\s*\1/g)]
      .map((m) => (src.slice(m.index, m.index + m[0].length).match(/(haiku|sonnet|opus|fable)/) || [])[1])
      .filter(Boolean)
    if (literals.length && !/__modelPolicy/.test(code)) {
      const seen = [...new Set(literals)].join(', ')
      add('hand-picked-models',
        `${literals.length} agent(s) name a model literally (${seen}) and nothing in this script reads the __modelPolicy this hook puts in args`,
        'derive them instead: read args.__modelPolicy and route each prompt through the routeModel helper (workflows/design-divergence.js is the reference copy). A literal is not routing — it is one person\'s guess frozen into the script, and on a session pinned to a version the aliases cannot name it overrides the inheritance that is the only way to reproduce that version.')
    }
  }

  return faults
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function main() {
  const payload = readPayload()
  const tool = String(payload.tool_name || payload.toolName || payload.tool || '')
  if (tool !== 'Workflow') return

  const input = payload.tool_input || payload.toolInput || payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return

  const model = currentModel(payload.transcript_path)
  const mode = classify(model)
  if (!mode) return // session model unknown: inject nothing rather than a guess

  const args = input.args
  // Only an object can carry the policy. A string brief stays a string; that workflow inherits.
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return
  if (args && args.__modelPolicy) return // already carried (a resume, or a nested workflow)

  // The gate runs before the injection: a script with one of these defects is not improved by
  // being handed a routing table it does not read.
  const faults = auditWorkflow(input.script, { routable: mode === 'routable' })
  if (faults.length) {
    const reason = ['This workflow was not started. ' + faults.length + ' thing(s) in the script must be settled first:']
      .concat(faults.map((f, i) => `\n${i + 1}. ${f.code} — ${f.why}\n   ${f.fix}`))
      .join('')
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }))
    return
  }

  const updated = {
    ...input,
    args: {
      ...(args || {}),
      __modelPolicy: { sessionModel: model, pinned: mode === 'pinned', signals: SIGNAL_SOURCES },
    },
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: updated,
    },
  }))
}

// Exported so the drift test can compare SIGNAL_SOURCES against the routing hook's copy.
module.exports = { SIGNAL_SOURCES, classify, auditWorkflow, stripLiterals }

if (require.main === module) {
  try {
    main()
  } catch {
    // A hook that throws is worse than one that does nothing.
  }
  process.exit(0)
}
