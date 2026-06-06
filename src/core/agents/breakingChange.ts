import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class BreakingChangeAgent extends BaseAgent {
  get name(): AgentName { return 'breaking-change' }

  get systemPrompt(): string {
    return `You are an API compatibility reviewer. Analyze the provided git diff for breaking changes that could break callers of this code.

Focus on:
- Removed exported functions, classes, constants, or types
- Changed function signature: added required parameters, removed parameters, reordered parameters
- Renamed public methods or properties
- Changed return types in incompatible ways (e.g., now returns null where it didn't before)
- Interface or type changes that are not backward-compatible (removed fields, changed field types)
- Changed thrown exception types that callers may be catching
- Changed default parameter values that callers rely on
- Removed or renamed exported enum values
- Changed module exports (default vs named)

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of what changed and how callers break","suggestion":"Migration path or backward-compatible alternative"}]

Rules:
- basis=VERIFIED: the breaking change is clearly visible in the diff (e.g., removed export)
- basis=INFERRED: likely breaking based on visible patterns (e.g., signature change without callers visible)
- basis=SPECULATIVE: possible breaking change, needs broader codebase context to confirm
- Always report severity=high for confirmed breaking changes, severity=medium for speculative ones
- If the diff contains no public API changes, return: []`
  }
}
