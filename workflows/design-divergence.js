export const meta = {
  name: 'design-divergence',
  description: 'Generate structurally different design directions with blind workers, score them for genericness, commit to one',
  whenToUse: 'Any visual work where looking distinctive is the actual goal — a hero, a landing page, a game UI, a brand surface, an art direction. Not for settings pages, checkout flows or data tables, where convention is the feature.',
  phases: [
    { title: 'DNA', detail: "extract the subject's own materials, motifs, palette, tempo, vernacular" },
    { title: 'Diverge', detail: 'one blind worker per operator, one structurally distinct direction each' },
    { title: 'Judge', detail: 'independent critics apply the swap test to every direction' },
    { title: 'Commit', detail: 'pick one and keep its logic pure — never blend the finalists' },
  ],
}

// args: a string brief, or { brief, subject, operators?, judgesPerDirection? }
const input = typeof args === 'string' ? { brief: args } : (args || {})
const BRIEF = input.brief || 'No brief supplied — ask the user before running this.'
const SUBJECT = input.subject || BRIEF

// Each operator is a HARD CONSTRAINT that makes the centroid invalid. They are handed out one
// per worker on purpose: a worker allowed to pick its own operator picks the one nearest the
// centroid, which is the failure this whole workflow exists to prevent.
const ALL_OPERATORS = [
  { key: 'material', rule: 'MATERIAL TRANSPLANT. Choose a physical material or process and obey its real limitations — letterpress cannot do gradients (it does deep impression, tight registration, ink spread); a CRT has scanlines, bloom and phosphor persistence; risograph misregisters and its inks multiply; woven textile has an inescapable grid. The limitations are the point; they force form you would not otherwise reach.' },
  { key: 'diegetic', rule: "DIEGETIC FRAMING. The interface is an OBJECT INSIDE the subject's world, not a website about it. Not 'a dark UI with gold accents' but an artifact the inhabitants of that world actually operate, obeying that world's laws of symmetry, ceremony, wear and pacing. Decide what the object is made of and who built it." },
  { key: 'amputation', rule: 'CONSTRAINT AMPUTATION. Forbid the default instrument and invent a replacement. Pick one: no cards; no rounded corners; no drop shadows; exactly two colours; no rectangles at all; type only, zero imagery. State which you amputated and what replaced it.' },
  { key: 'extreme', rule: 'EXTREME PARAMETER. Take one variable to an unreasonable value and hold it everywhere — display type at 200px, 90% of the canvas empty, a single colour at full chroma against pure neutral, one gesture that takes four seconds. Moderation is the centroid; commit to the extremity.' },
  { key: 'grammar', rule: 'CROSS-DOMAIN GRAMMAR. Borrow the LAYOUT GRAMMAR — hierarchy and spatial logic, not decoration — of an unrelated artifact: a nautical chart, a museum wall label, a mixing desk, an illuminated manuscript, a surgical tray, a stock ticker. Name the artifact and show how its grammar maps.' },
  { key: 'temporal', rule: 'TEMPORAL SIGNATURE FIRST. Decide how the thing BEHAVES OVER TIME before deciding how it looks, then design the surface that expresses that law. A UI that snaps hard and holds perfectly still is a different product from one that eases everything. State the motion law in one sentence first.' },
  { key: 'antagonist', rule: 'ANTAGONISTIC PAIRING. Force two things that should not coexist and resolve the tension — brutalist structure with delicate type, clinical precision with hand-drawn marks, ceremonial symmetry with industrial wear. The resolution is where the personality lives.' },
]

const OPERATORS = (input.operators && input.operators.length)
  ? ALL_OPERATORS.filter((o) => input.operators.includes(o.key))
  : ALL_OPERATORS.slice(0, 5)

const JUDGES = input.judgesPerDirection || 3

const DNA_SCHEMA = {
  type: 'object',
  required: ['materials', 'motifs', 'palette', 'tempo', 'vernacular'],
  properties: {
    materials: { type: 'array', items: { type: 'string' }, description: 'What this world is physically made of' },
    motifs: { type: 'array', items: { type: 'string' }, description: 'Recurring geometry and form language' },
    palette: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, source: { type: 'string' } } }, description: 'Colours SAMPLED from the subject, with where each came from — not chosen from a generator' },
    tempo: { type: 'string', description: 'How this world moves. Rhythm, pacing, stillness.' },
    vernacular: { type: 'array', items: { type: 'string' }, description: "What the subject calls things, in its own words" },
    laws: { type: 'array', items: { type: 'string' }, description: "Rules the subject's world obeys that a design must not violate" },
    antiPatterns: { type: 'array', items: { type: 'string' }, description: 'What would immediately read as wrong to someone who knows this subject' },
  },
}

const DIRECTION_SCHEMA = {
  type: 'object',
  required: ['oneLine', 'operator', 'concept', 'form', 'motion', 'whyOnlyThis'],
  properties: {
    oneLine: { type: 'string', description: 'The direction in ONE sentence, concrete enough to picture' },
    operator: { type: 'string' },
    constraintTaken: { type: 'string', description: 'The specific hard constraint adopted, and what it forbids' },
    concept: { type: 'string' },
    form: { type: 'string', description: 'Layout, type, colour, texture — how the constraint shows up in the surface' },
    motion: { type: 'string', description: 'The motion law: what moves, how, and what stays still' },
    whyOnlyThis: { type: 'string', description: "Why this design could ONLY belong to this subject. If you cannot answer without naming the brand, the design is generic." },
    riskiestChoice: { type: 'string', description: 'The single decision most likely to be rejected — name it rather than hiding it' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['swapTestSurvives', 'genericScore', 'reasoning'],
  properties: {
    swapTestSurvives: { type: 'boolean', description: 'TRUE means the design still works with another product swapped in — which means it FAILS, it designed the category' },
    genericScore: { type: 'number', description: '0 = could only be this subject; 10 = interchangeable with any product in the category' },
    strongest: { type: 'string' },
    weakest: { type: 'string' },
    centroidTells: { type: 'array', items: { type: 'string' }, description: 'Specific features that are simply the category default wearing a costume' },
    reasoning: { type: 'string' },
  },
}

phase('DNA')
const dna = await agent(
  `Extract the visual DNA of this subject. Do not design anything yet.\n\nSUBJECT: ${SUBJECT}\nBRIEF: ${BRIEF}\n\n` +
  `Originality is transplanted from the subject's own world, not invented and not borrowed from design galleries. ` +
  `So mine the SUBJECT's actual artifacts — its own imagery, its interfaces, its fiction, its materials — and report what it is physically made of, its recurring geometry, colours SAMPLED from it (say where each came from), how it moves, and what it calls things in its own vocabulary.\n\n` +
  `Also report the laws its world obeys and the anti-patterns — what would instantly read as WRONG to someone who knows this subject well. Those constraints are worth more than any inspiration.\n\n` +
  `If the subject has no strong world of its own, derive the DNA from its domain instead: the materials, grammar and tempo of the activity it serves.`,
  { label: 'dna', phase: 'DNA', schema: DNA_SCHEMA }
)

phase('Diverge')
// Workers are BLIND to each other. This is the containment rule from graph-engineering, and it
// matters more here than anywhere: a worker that can see a sibling's direction converges on it,
// and N converged workers reproduce the centroid the whole exercise exists to escape.
const directions = await parallel(OPERATORS.map((op) => () =>
  agent(
    `Produce ONE design direction. You are one of several designers working independently; you cannot see the others and must not try to cover every base. Commit hard to your assigned constraint.\n\n` +
    `BRIEF: ${BRIEF}\n\nSUBJECT DNA (measured, use it):\n${JSON.stringify(dna, null, 2)}\n\n` +
    `YOUR ASSIGNED OPERATOR — this is not a suggestion:\n${op.rule}\n\n` +
    `Rules:\n` +
    `- Obey the operator even where it is inconvenient. Its constraint is what makes your direction not the average.\n` +
    `- Use the DNA's real palette and vernacular. Do not invent colours when measured ones exist.\n` +
    `- Do not hedge toward safety. A direction that could ship for any product in this category has failed.\n` +
    `- Before you answer, apply the swap test to yourself: swap the product name and content for a competitor's. If your design still works, throw it away and go further.\n` +
    `- State your riskiest decision plainly rather than hiding it.`,
    { label: `direction:${op.key}`, phase: 'Diverge', schema: DIRECTION_SCHEMA }
  )
))

phase('Judge')
// Independent critics per direction, each blind to the others' verdicts. A single judge tends to
// reward polish; a panel disagreeing is the signal that a direction is actually taking a risk.
const judged = await parallel(directions.filter(Boolean).map((d) => () =>
  parallel(Array.from({ length: JUDGES }, (_, i) => () =>
    agent(
      `Judge this design direction adversarially. Your job is to find where it is secretly generic, not to be encouraging.\n\n` +
      `SUBJECT: ${SUBJECT}\n\nDIRECTION:\n${JSON.stringify(d, null, 2)}\n\nSUBJECT DNA:\n${JSON.stringify(dna, null, 2)}\n\n` +
      `THE SWAP TEST is the primary instrument: mentally replace the product name, copy and content with a DIFFERENT product in the same category. Does the design still work? If YES it designed the category rather than the thing, and that is a failure however polished it looks.\n\n` +
      `${['Judge as someone who knows this subject intimately and will notice anything false to its world.',
          'Judge as a hostile art director whose only question is "have I seen this before?"',
          'Judge on whether the constraint was actually obeyed, or quietly abandoned once it got inconvenient.'][i % 3]}\n\n` +
      `Name specific centroid tells — features that are the category default wearing a costume. Grain, glow and a custom cursor on a generic layout is still a generic layout.`,
      { label: `judge:${d.operator}:${i + 1}`, phase: 'Judge', schema: VERDICT_SCHEMA }
    )
  )).then((vs) => {
    const v = vs.filter(Boolean)
    const scores = v.map((x) => x.genericScore).filter((n) => typeof n === 'number')
    return {
      direction: d,
      verdicts: v,
      // Worst score, not mean: one judge spotting that it is the category default is enough.
      // A mean lets two polite verdicts bury the one that found the problem.
      worstGeneric: scores.length ? Math.max(...scores) : 10,
      failedSwap: v.filter((x) => x.swapTestSurvives).length,
    }
  })
))

phase('Commit')
const ranked = judged.filter(Boolean).sort((a, b) => a.worstGeneric - b.worstGeneric)

const decision = await agent(
  `Choose ONE direction and develop it into a brief someone can build from.\n\n` +
  `BRIEF: ${BRIEF}\n\nRANKED DIRECTIONS (lower worstGeneric is better; failedSwap counts judges who said it would still work for a different product):\n` +
  `${JSON.stringify(ranked.map((r) => ({ oneLine: r.direction.oneLine, operator: r.direction.operator, worstGeneric: r.worstGeneric, failedSwap: r.failedSwap, centroidTells: r.verdicts.flatMap((v) => v.centroidTells || []).slice(0, 6) })), null, 2)}\n\n` +
  `FULL DIRECTIONS:\n${JSON.stringify(ranked.map((r) => r.direction), null, 2).slice(0, 24000)}\n\n` +
  `THE RULE YOU MUST NOT BREAK: **commit to one direction and keep its internal logic pure.** Averaging several good directions reconstructs the centroid — that is exactly how "three strong concepts" becomes "a dark app with accent colours and some cards". You may graft AT MOST ONE element from a runner-up, and only if it does not contradict the winner's logic.\n\n` +
  `Deliver: the chosen direction and why it beat the others; the constraint that must be obeyed throughout; the concrete design system it implies (type, colour with real values from the DNA, spatial logic, motion law); what to build FIRST to prove the concept; and the specific centroid tells the judges found, as things to avoid during execution.\n\n` +
  `Also state plainly which directions were rejected and why — a rejected direction with its reasoning stops the idea being re-raised later, and belongs in project-memory.`,
  { label: 'commit', phase: 'Commit', effort: 'high' }
)

return {
  dna,
  directions: ranked.map((r) => ({ oneLine: r.direction.oneLine, operator: r.direction.operator, worstGeneric: r.worstGeneric, failedSwap: r.failedSwap })),
  decision,
}
