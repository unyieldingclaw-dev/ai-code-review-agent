# New Specialist Agents — v0.8.0 Design Spec

**Date:** 2026-06-14  
**Status:** Approved  
**Version:** v0.8.0

## Goal

Add 5 new specialist agents to the AI Code Review swarm to deepen code analysis across security secrets detection, error handling patterns, observability, database migrations, and code complexity. These agents augment the existing 11-agent swarm, bringing the total to 16 agents by v0.9.0 (incremental rollout with v0.8.0 shipping the first 5).

## Architecture Overview

All 5 new agents follow the existing agent contract:
- Extend `BaseAgent` from `src/core/agents/base.ts`
- Live in `src/core/agents/` with camelCase filenames (e.g., `secretsAgent.ts`)
- Are registered in the `buildAgents()` Map in `src/core/runner.ts`
- Report `Finding[]` with standard schema (id, agent, severity, file, line, title, detail, suggestion, relatedFindings)
- Run sequentially in the swarm orchestrator

Two of the five agents are **hybrid** (LLM + external tools) with graceful fallback:
- **SecretsAgent:** Shells out to gitleaks or trufflehog for static scanning, augments LLM analysis, merges & deduplicates
- **ComplexityAgent:** Shells out to lizard for CCN metrics, augments diff with complexity block, flags high-complexity functions to LLM

Three are **pure LLM:**
- **ErrorHandlingAgent:** Analyzes exception handling patterns without external tooling
- **ObservabilityAgent:** Analyzes logging coverage without external instrumentation
- **MigrationSafetyAgent:** Analyzes schema migrations (conditionally executed)

---

## Per-Agent Design

### 1. SecretsAgent (`src/core/agents/secrets.ts`)

**Purpose:** Detect hardcoded secrets, API keys, credentials in code.

**Approach:** Hybrid — runs gitleaks or trufflehog via `shell.ts`, parses JSON output into Findings, then runs LLM on the same diff, merges & deduplicates by `file:line`.

**Tool Chain:**
1. Try `gitleaks detect --source string --json` (default) with diff as stdin
2. Fallback: Try `trufflehog regex --json` with diff as stdin
3. Fallback: Skip external tool, LLM-only

**Configuration:**
```typescript
interface ReviewConfig {
  preferredSecretsScanner?: 'gitleaks' | 'trufflehog' | 'none'  // default: 'gitleaks'
  // ... existing fields
}
```

**Output:** Merges external tool findings with LLM findings, deduplicates by `file:line:secret_type`, keeps the higher severity finding if both tools flag the same line.

**Example Finding:**
```
{
  id: "secrets-001",
  agent: "SecretsAgent",
  severity: "critical",
  basis: "VERIFIED",  // external tool detection
  file: "src/config.ts",
  line: 42,
  title: "Hardcoded API Key",
  detail: "AWS_SECRET_ACCESS_KEY appears as a string literal. Exposed in version control.",
  suggestion: "Move to environment variable. Rotate the compromised key."
}
```

---

### 2. ErrorHandlingAgent (`src/core/agents/errorHandling.ts`)

**Purpose:** Flag error handling antipatterns: swallowed exceptions, ignored Promise rejections, silent failures.

**Approach:** Pure LLM. Detects:
- Empty catch blocks (no logging, rethrow, or recovery)
- `.catch(() => {})` without side effects
- `.then(...).catch(e => null)` — sentinel returns masking errors
- Log-and-continue patterns (logs error but doesn't fail the operation when it should)
- Missing error context (exception caught but no context recorded)

**Prompt template:** Analyzes diff for error handling statements, flags patterns that hide failures from visibility.

**Example Finding:**
```
{
  id: "errors-001",
  agent: "ErrorHandlingAgent",
  severity: "high",
  basis: "INFERRED",
  file: "src/api/handler.ts",
  line: 78,
  title: "Empty catch block swallows exception",
  detail: "Exception is caught but not logged, rethrown, or recovered. Caller has no visibility into the failure.",
  suggestion: "Log the error with context, rethrow, or implement explicit recovery logic."
}
```

---

### 3. ObservabilityAgent (`src/core/agents/observability.ts`)

**Purpose:** Flag code paths (especially error branches and state transitions) that lack logging.

**Approach:** Pure LLM. Detects:
- New error branches with no log output
- State transitions (e.g., `status = 'failed'`) without logging
- Conditional returns without preceding log statements
- Infers the logging library used in the codebase (e.g., pino, winston, console, custom logger)

**Prompt template:** Analyzes diff for control flow paths, identifies branches that lack instrumentation, suggests log calls appropriate to the inferred logging style.

**Example Finding:**
```
{
  id: "observability-001",
  agent: "ObservabilityAgent",
  severity: "medium",
  basis: "INFERRED",
  file: "src/db/connection.ts",
  line: 125,
  title: "Error branch lacks logging",
  detail: "Connection timeout is handled but not logged. Operators have no visibility into retry behavior.",
  suggestion: "Add `logger.warn({ timeout_ms, attempt }, 'Retrying connection...')` before the retry."
}
```

---

### 4. MigrationSafetyAgent (`src/core/agents/migrationSafety.ts`)

**Purpose:** Validate database schema migrations for common pitfalls.

**Approach:** Pure LLM, conditionally executed. Only runs if diff contains migration files (detected by parsing diff headers like `+++ b/migrations/...` or `+++ b/db/migrations/...`).

**Detects:**
- NOT NULL columns added without DEFAULT — breaks existing inserts
- DROP statements without IF EXISTS — fails if object doesn't exist
- Missing foreign key indexes — degrades query performance
- Missing down migrations (rollback path)
- Type changes on columns with existing data
- Renaming columns without aliases (breaks queries mid-deploy)

**Configuration:**
```typescript
interface ReviewConfig {
  migrationPaths?: string[]  // e.g., ['migrations/', 'db/migrations/', 'sqitch/']
  // ... existing fields
}
```

**Detection Logic:**
1. Parse diff headers for migration file paths
2. If any migration files present, run agent
3. If no migration files, skip agent (emit no findings, log skip reason)

**Example Finding:**
```
{
  id: "migration-001",
  agent: "MigrationSafetyAgent",
  severity: "high",
  basis: "INFERRED",
  file: "migrations/20260614_add_user_email.sql",
  line: 5,
  title: "NOT NULL column without DEFAULT",
  detail: "ALTER TABLE users ADD COLUMN email VARCHAR NOT NULL; will fail on existing rows with no value.",
  suggestion: "Add DEFAULT '' or '' || uuid_generate_v4() || '@example.com'; or use a two-step migration: ADD COLUMN (nullable) → UPDATE → ADD NOT NULL constraint."
}
```

---

### 5. ComplexityAgent (`src/core/agents/complexity.ts`)

**Purpose:** Flag functions exceeding complexity thresholds (Cyclomatic Complexity Number / CCN).

**Approach:** Hybrid — runs `lizard --csv` on changed files, parses CSV output, augments diff with `[COMPLEXITY METRICS]` block listing functions exceeding threshold, passes augmented diff to LLM.

**Tool Chain:**
1. Extract file paths from diff
2. For each changed file (if it exists locally and is a known language: .ts, .js, .py, .java, .go, etc.), run `lizard --csv <file>`
3. Parse CSV; extract functions with CCN >= threshold
4. Insert `[COMPLEXITY METRICS]\n<metrics table>` block before LLM prompt
5. LLM analyzes diff + metrics, flags high-complexity functions and suggests refactoring

**Configuration:**
```typescript
interface ReviewConfig {
  complexityThreshold?: number  // default: 10 (CCN)
  // ... existing fields
}
```

**Lizard CSV Output:**
```
NLOC,CCN,token_count,PARAM,length,location,file_name,function_name,long_name,start_line,end_line
45,12,320,3,45,src/utils/parser.ts:5:parse,src/utils/parser.ts,parse,"parse(input: string)",5,49
```

**Augmented Diff Block:**
```
[COMPLEXITY METRICS]
Function: parse (src/utils/parser.ts, lines 5–49)
  CCN: 12 (threshold: 10)  ← flagged
  Length: 45 lines
  Params: 3
  Tokens: 320
```

**Example Finding:**
```
{
  id: "complexity-001",
  agent: "ComplexityAgent",
  severity: "medium",
  basis: "VERIFIED",  // lizard metric
  file: "src/utils/parser.ts",
  line: 5,
  title: "High cyclomatic complexity: CCN=12",
  detail: "parse() has 12 decision paths. Code is hard to test and maintain. Each condition adds a branch.",
  suggestion: "Extract conditional blocks into separate functions. Consider using a lookup table or strategy pattern for branching."
}
```

---

## New Infrastructure: `src/utils/shell.ts`

**Purpose:** Safely shell out to external tools, parsing their output, with graceful fallback.

**Function Signature:**
```typescript
export async function runTool(
  command: string,
  args: string[],
  stdinData?: string
): Promise<string | null>
```

**Behavior:**
- Spawns child process with `command` and `args`
- If provided, writes `stdinData` to stdin
- **Uses `close` event, not `exit`** — gitleaks and similar tools exit non-zero when they find secrets
- Returns stdout (accumulated) on `close` event, regardless of exit code
- Returns `null` if command not found (ENOENT)
- Returns `null` on timeout (30s default) without throwing

**Error Handling:**
- No exceptions thrown; `null` is returned on missing tool or timeout
- Agents check for `null` and fall back to LLM-only mode
- Stderr is logged (not returned) for debugging

**Usage Example:**
```typescript
const output = await runTool('gitleaks', ['detect', '--source', 'string', '--json'], diff)
if (output === null) {
  // tool not found or timed out — fall back to LLM
  return lmmAnalysis(diff)
}
const findings = JSON.parse(output)
```

---

## Integration: `src/core/schema.ts` & `src/core/config.ts`

### AgentName Union
Add 5 entries:
```typescript
export type AgentName =
  | 'SecurityAgent'
  | 'PerformanceAgent'
  | 'CorrectnessAgent'
  | 'DesignAgent'
  | 'DependenciesAgent'
  | 'BreakingChangeAgent'
  | 'LicenseAgent'
  | 'CoverageAnalyst'
  | 'SecretsAgent'           // new
  | 'ErrorHandlingAgent'     // new
  | 'ObservabilityAgent'     // new
  | 'MigrationSafetyAgent'   // new
  | 'ComplexityAgent'        // new
```

### ReviewConfig Interface
```typescript
export interface ReviewConfig {
  // ... existing fields
  preferredSecretsScanner?: 'gitleaks' | 'trufflehog' | 'none'
  complexityThreshold?: number
  migrationPaths?: string[]
}
```

---

## Integration: `src/core/runner.ts`

### buildAgents() Registration
Agents **must be registered before being added to DEFAULT_CONFIG.agents**. Failure to register causes the runner to emit no `onProgress` calls for the agent, breaking tests.

```typescript
function buildAgents(config: ReviewConfig, llmProvider: LLMProvider): Map<AgentName, BaseAgent> {
  const agents = new Map<AgentName, BaseAgent>()

  // existing agents...
  agents.set('SecurityAgent', new SecurityAgent(llmProvider))
  // ...

  // new agents — register here
  agents.set('SecretsAgent', new SecretsAgent(llmProvider))
  agents.set('ErrorHandlingAgent', new ErrorHandlingAgent(llmProvider))
  agents.set('ObservabilityAgent', new ObservabilityAgent(llmProvider))
  agents.set('MigrationSafetyAgent', new MigrationSafetyAgent(llmProvider))
  agents.set('ComplexityAgent', new ComplexityAgent(llmProvider))

  return agents
}

const DEFAULT_CONFIG: ReviewConfig = {
  agents: [
    // existing...
    'SecretsAgent',            // add after registration
    'ErrorHandlingAgent',
    'ObservabilityAgent',
    'MigrationSafetyAgent',
    'ComplexityAgent',
  ],
  // ...
}
```

---

## Conditional Execution: MigrationSafetyAgent

In `SwarmRunner.run()` or orchestrator:

```typescript
async function shouldSkipAgent(agent: AgentName, diff: string): Promise<boolean> {
  if (agent !== 'MigrationSafetyAgent') return false

  // Check if diff contains migration file headers
  const hasMigrationFiles = /^\+\+\+ b\/(migrations|db\/migrations|sqitch)\//.test(diff)
  return !hasMigrationFiles
}
```

If `shouldSkipAgent()` returns `true`, emit `onProgress({ agent, status: 'skipped', reason: 'No migration files in diff' })` and continue to the next agent.

---

## Deduplication: SecretsAgent

When merging findings from gitleaks + LLM:

```typescript
function deduplicateFindings(toolFindings: Finding[], llmFindings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>()

  // key: `${file}:${line}:${secretType}`
  for (const f of toolFindings) {
    const key = `${f.file}:${f.line}:${f.title}`
    byKey.set(key, f)
  }

  for (const f of llmFindings) {
    const key = `${f.file}:${f.line}:${f.title}`
    if (!byKey.has(key)) {
      byKey.set(key, f)
    } else {
      // Keep tool finding (basis: VERIFIED) over LLM (basis: INFERRED/SPECULATIVE)
      const existing = byKey.get(key)!
      if (f.severity > existing.severity) {
        byKey.set(key, f)
      }
    }
  }

  return Array.from(byKey.values())
}
```

---

## Testing Strategy

- **Unit tests for shell.ts:** Mock child process, verify ENOENT → null, verify close event, verify stdout accumulation
- **Unit tests for each new agent:** Mock LLMProvider, verify output format and severity assignments
- **Unit test for SecretsAgent deduplication:** Mock tool + LLM outputs, verify merging logic
- **Unit test for MigrationSafetyAgent skip logic:** Verify agent skips when no migration files present
- **Unit test for ComplexityAgent CSV parsing:** Mock lizard output, verify metrics block insertion
- **Integration test:** Run full swarm with new agents on sample diffs, verify no crashes and findings are reported

---

## Out of Scope

- Fifth generation of agents (will arrive in v0.9.0 and beyond)
- Anthropic provider support for new agents (backlogged)
- IDE integrations (covered separately by MCP server spec)
- Custom rule definitions for SecretsAgent
- Database schema understanding beyond SQL (e.g., no ORM-specific validations)
