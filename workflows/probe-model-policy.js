export const meta = {
  name: 'probe-model-policy',
  description: 'Prove the Workflow PreToolUse hook is injecting the model policy — returns the args the script received, spawns nothing',
  whenToUse: 'After a Claude Code upgrade, or whenever workflow fan-outs look like they are all running on the session model. Zero agents, milliseconds.',
  phases: [{ title: 'Probe', detail: 'no agents — the returned value is the verdict' }],
}

// The hook under test fires on the Workflow tool call and rewrites tool_input.args to carry
// __modelPolicy BEFORE this body runs. Nothing here spawns an agent, so the return value is a
// direct observation of what the harness delivered — not a claim about it.
//
// Read the result as: policyPresent=false means the harness did not honour updatedInput on the
// Workflow tool, and every workflow fan-out is silently inheriting the session model. That is
// safe (cost, not correctness) but it is the exact hole this hook exists to close, so a false
// here after an upgrade is the signal to re-check the hook contract.
//
// Pass any object as args so the hook has something to attach to; a bare string cannot carry
// the policy by design. `briefSurvived` proves injection is additive, not a replacement.
phase('Probe')
const p = args && args.__modelPolicy
return {
  argsKeys: args ? Object.keys(args) : null,
  policyPresent: Boolean(p),
  sessionModel: p ? p.sessionModel : null,
  pinned: p ? p.pinned : null,
  signalKeys: p && p.signals ? Object.keys(p.signals) : null,
  briefSurvived: args ? args.brief : null,
}
