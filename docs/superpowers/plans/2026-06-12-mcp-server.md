# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ai-review-mcp` binary to the existing `ai-review-agent` package that exposes the 10-agent Ollama swarm as a `review_diff` MCP tool for Cursor's chat panel.

**Architecture:** Three new files under `src/mcp/` (formatter, tool handler, server entry). The MCP layer is a thin wrapper — it calls into existing `SwarmRunner`, `loadConfig`, and `OllamaProvider` unchanged. Transport is stdio. One new runtime dependency: `@modelcontextprotocol/sdk`.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` ^1.0.0, Vitest (existing test framework), Node ≥ 18, Windows + macOS.

**Spec:** `docs/superpowers/specs/2026-06-12-mcp-server-design.md`

---

## File Map

| File | Operation | Responsibility |
|------|-----------|----------------|
| `src/mcp/formatter.ts` | Create | A+C hybrid markdown renderer — pure function, no I/O |
| `src/mcp/tool.ts` | Create | Tool handler: get diff, load config, run SwarmRunner, catch errors |
| `src/mcp/server.ts` | Create | MCP server entry: register tool, connect stdio transport |
| `tests/unit/mcp/formatter.test.ts` | Create | Unit tests for all formatter output cases |
| `tests/unit/mcp/tool.test.ts` | Create | Unit tests for diff acquisition and error handling |
| `package.json` | Modify | Add `ai-review-mcp` bin, add `@modelcontextprotocol/sdk` dep |

---

## Task 1: formatter.ts + tests

The formatter is a pure function: takes `ReviewResult`, returns a markdown string. No I/O, no external dependencies. Start here — it defines the output contract everything else depends on.

**Files:**
- Create: `src/mcp/formatter.ts`
- Create: `tests/unit/mcp/formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/mcp/formatter.test.ts
import { describe, it, expect } from 'vitest'
import { formatMcpOutput } from '../../../src/mcp/formatter.js'
import type { ReviewResult } from '../../../src/core/schema.js'

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: {
      totalFindings: 0,
      bySeverity: {},
      byAgent: {},
      durationMs: 100,
    },
    ...overrides,
  }
}

function makeFinding(severity: 'critical' | 'high' | 'medium' | 'low', overrides = {}) {
  return {
    id: 'f1',
    agent: 'security' as const,
    severity,
    basis: 'VERIFIED' as const,
    file: 'src/auth.ts',
    line: 42,
    title: 'Test finding',
    detail: 'Detailed description',
    suggestion: 'Fix it this way',
    ...overrides,
  }
}

describe('formatMcpOutput', () => {
  it('returns no-findings message when findings is empty', () => {
    const result = formatMcpOutput(makeResult())
    expect(result).toContain('✅ No findings')
  })

  it('returns no-critical/high message when only medium/low exist', () => {
    const result = formatMcpOutput(makeResult({
      findings: [makeFinding('medium'), makeFinding('low')],
      summary: { totalFindings: 2, bySeverity: { medium: 1, low: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('✅ No critical or high findings')
    expect(result).toContain('1 medium')
    expect(result).toContain('1 low')
  })

  it('renders critical finding with 🔴 icon and full detail', () => {
    const finding = makeFinding('critical', {
      id: 'f1', agent: 'security', file: 'src/auth.ts', line: 42,
      title: 'Hardcoded secret', detail: 'Key is embedded in source.', suggestion: 'Use env var.'
    })
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: { security: 1 }, durationMs: 100 }
    }))
    expect(result).toContain('🔴')
    expect(result).toContain('CRITICAL')
    expect(result).toContain('security')
    expect(result).toContain('src/auth.ts:42')
    expect(result).toContain('Hardcoded secret')
    expect(result).toContain('Key is embedded in source.')
    expect(result).toContain('Use env var.')
  })

  it('renders high finding with 🟠 icon', () => {
    const finding = makeFinding('high')
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('🟠')
    expect(result).toContain('HIGH')
  })

  it('shows medium/low count tail when both exist', () => {
    const findings = [
      makeFinding('critical'), makeFinding('medium'), makeFinding('medium'), makeFinding('low')
    ]
    const result = formatMcpOutput(makeResult({
      findings,
      summary: { totalFindings: 4, bySeverity: { critical: 1, medium: 2, low: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('2 medium')
    expect(result).toContain('1 low')
    expect(result).toContain('ai-review-agent')
  })

  it('omits tail when no medium/low findings', () => {
    const finding = makeFinding('critical')
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).not.toContain('medium')
    expect(result).not.toContain('low')
    expect(result).not.toContain('ai-review-agent')
  })

  it('header shows count of critical+high only', () => {
    const findings = [makeFinding('critical'), makeFinding('high'), makeFinding('medium')]
    const result = formatMcpOutput(makeResult({
      findings,
      summary: { totalFindings: 3, bySeverity: { critical: 1, high: 1, medium: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('2 findings')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run tests/unit/mcp/formatter.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/mcp/formatter.js'`

- [ ] **Step 3: Implement formatter.ts**

```typescript
// src/mcp/formatter.ts
import type { Finding, ReviewResult } from '../core/schema.js'

export function formatMcpOutput(result: ReviewResult): string {
  const { findings, summary } = result

  if (findings.length === 0) {
    return '## AI Code Review — ✅ No findings\n'
  }

  const actionable = findings.filter(
    f => f.severity === 'critical' || f.severity === 'high'
  )
  const mediumCount = summary.bySeverity.medium ?? 0
  const lowCount = summary.bySeverity.low ?? 0

  if (actionable.length === 0) {
    const tail = buildTail(mediumCount, lowCount)
    return `## AI Code Review — ✅ No critical or high findings\n\n_${tail}_\n`
  }

  const count = actionable.length
  const header = `## AI Code Review — ${count} finding${count === 1 ? '' : 's'}\n\n`
  const body = actionable.map(renderFinding).join('\n\n')
  const tail = buildTail(mediumCount, lowCount)
  const footer = tail ? `\n\n---\n_${tail}_\n` : '\n'

  return header + body + footer
}

function renderFinding(f: Finding): string {
  const icon = f.severity === 'critical' ? '🔴' : '🟠'
  return [
    `### ${icon} ${f.severity.toUpperCase()} · ${f.agent} · \`${f.file}:${f.line}\``,
    `**${f.title}**`,
    f.detail,
    `_Suggestion: ${f.suggestion}_`,
  ].join('\n')
}

function buildTail(medium: number, low: number): string {
  const parts: string[] = []
  if (medium > 0) parts.push(`${medium} medium`)
  if (low > 0) parts.push(`${low} low`)
  if (parts.length === 0) return ''
  return `${parts.join(' · ')} — run \`ai-review-agent\` in your terminal to see all findings`
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx vitest run tests/unit/mcp/formatter.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/formatter.ts tests/unit/mcp/formatter.test.ts
git commit -m "feat(mcp): add A+C hybrid markdown formatter"
```

---

## Task 2: tool.ts + tests

The tool handler orchestrates everything: get the diff, load config, run the swarm, catch errors, return text. Test the diff acquisition logic and all error paths with mocks — don't actually call git or Ollama in unit tests.

**Files:**
- Create: `src/mcp/tool.ts`
- Create: `tests/unit/mcp/tool.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/mcp/tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReviewTool } from '../../../src/mcp/tool.js'

// Mock child_process so tests never shell out
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

// Mock SwarmRunner so tests never call Ollama
vi.mock('../../../src/core/runner.js', () => ({
  SwarmRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      findings: [],
      testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 },
    }),
  })),
}))

// Mock OllamaProvider — trivial stub
vi.mock('../../../src/core/llm/ollamaProvider.js', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({})),
}))

// Mock loadConfig — return default config
vi.mock('../../../src/core/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    model: 'devstral:latest',
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    anthropicModel: '',
    maxFindings: 15,
    agents: ['security', 'performance', 'correctness', 'design', 'dependencies',
             'coverage', 'adversarial', 'integration', 'breaking-change', 'license'],
    contextLines: 10,
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    ignorePaths: [],
    sanitize: true,
  }),
}))

import { execSync } from 'child_process'
const mockExecSync = vi.mocked(execSync)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runReviewTool', () => {
  it('uses staged diff by default', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    await runReviewTool({})
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('diff --cached'),
      expect.any(Object)
    )
  })

  it('falls back to git diff HEAD when no staged changes', async () => {
    mockExecSync
      .mockReturnValueOnce('' as any)            // first call: git diff --cached → empty
      .mockReturnValueOnce('diff --git a/f.ts b/f.ts\n+line' as any) // second call: git diff HEAD
    await runReviewTool({})
    const calls = mockExecSync.mock.calls.map(c => c[0] as string)
    expect(calls[0]).toContain('--cached')
    expect(calls[1]).toContain('diff HEAD')
  })

  it('returns empty-diff message when no changes found', async () => {
    mockExecSync.mockReturnValue('' as any)
    const result = await runReviewTool({})
    expect(result).toContain('No staged changes found')
  })

  it('uses provided repo_path in git commands', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    await runReviewTool({ repo_path: '/tmp/myrepo' })
    const call = mockExecSync.mock.calls[0][0] as string
    expect(call).toContain('/tmp/myrepo')
  })

  it('returns error message when git command throws (not a repo)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repository') })
    const result = await runReviewTool({})
    expect(result).toContain('Not a git repository')
  })

  it('returns error message when Ollama is unreachable', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    vi.mocked(SwarmRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockRejectedValue(new Error('LLM provider not available')),
    }) as any)
    const result = await runReviewTool({})
    expect(result).toContain('Ollama is not reachable')
  })

  it('excludes testgen from agents regardless of config', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    const { loadConfig } = await import('../../../src/core/config.js')
    vi.mocked(loadConfig).mockReturnValueOnce({
      model: 'devstral:latest',
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      anthropicModel: '',
      maxFindings: 15,
      agents: ['security', 'testgen', 'coverage'],  // testgen present in config
      contextLines: 10,
      testOutputDir: './ai-review-tests',
      maxDiffLines: 2000,
      agentTimeoutMs: 60000,
      ignorePaths: [],
      sanitize: true,
    })
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    const runMock = vi.fn().mockResolvedValue({
      findings: [], testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 }
    })
    vi.mocked(SwarmRunner).mockImplementationOnce((config: any) => {
      expect(config.agents).not.toContain('testgen')
      return { run: runMock } as any
    })
    await runReviewTool({})
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run tests/unit/mcp/tool.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/mcp/tool.js'`

- [ ] **Step 3: Implement tool.ts**

```typescript
// src/mcp/tool.ts
import { execSync } from 'child_process'
import { resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMcpOutput } from './formatter.js'
import type { AgentName } from '../core/schema.js'

// testgen writes files to disk — never run it in the MCP context.
// WHY: Chat tools should not write to the project without explicit user intent.
const MCP_EXCLUDED_AGENTS: AgentName[] = ['testgen']

export interface ReviewToolParams {
  repo_path?: string
}

export async function runReviewTool(params: ReviewToolParams): Promise<string> {
  const repoPath = resolve(params.repo_path ?? process.cwd())

  // --- Diff acquisition (staged → HEAD fallback) ---
  let diff: string
  try {
    diff = execSync(`git -C "${repoPath}" diff --cached`, { encoding: 'utf-8' })
    if (!diff.trim()) {
      diff = execSync(`git -C "${repoPath}" diff HEAD`, { encoding: 'utf-8' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Friendly message for the common case of not being in a repo
    return `## AI Code Review\n\nNot a git repository: \`${repoPath}\`.\n\n_${msg}_`
  }

  if (!diff.trim()) {
    return '## AI Code Review\n\nNo staged changes found. Stage some changes with `git add` and try again.'
  }

  // --- Config ---
  const config = loadConfig(repoPath)
  // Remove testgen regardless of what the config file says
  config.agents = config.agents.filter(
    (a): a is AgentName => !MCP_EXCLUDED_AGENTS.includes(a)
  )

  // --- Run swarm ---
  const provider = new OllamaProvider(config.ollamaUrl, config.model)
  const runner = new SwarmRunner(config, provider)

  try {
    const result = await runner.run({ diff, projectPath: repoPath })
    return formatMcpOutput(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('provider not available') || msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      return `## AI Code Review\n\nOllama is not reachable at \`${config.ollamaUrl}\`. Start Ollama and try again.\n\n_${msg}_`
    }
    return `## AI Code Review\n\nReview failed: ${msg}`
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx vitest run tests/unit/mcp/tool.test.ts
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool.ts tests/unit/mcp/tool.test.ts
git commit -m "feat(mcp): add review_diff tool handler"
```

---

## Task 3: server.ts

The MCP server entry point. Registers the `review_diff` tool with the MCP SDK and connects the stdio transport. This is glue code — keep it thin. All logic lives in `tool.ts`.

**Files:**
- Create: `src/mcp/server.ts`

No unit tests for the server entry point — the MCP SDK's transport layer is an integration concern. The smoke test in Task 5 verifies it.

- [ ] **Step 1: Install the MCP SDK**

```
npm install @modelcontextprotocol/sdk
```

Expected: package added to `node_modules/`, `package.json` and `package-lock.json` updated.

- [ ] **Step 2: Implement server.ts**

```typescript
#!/usr/bin/env node
// src/mcp/server.ts
//
// MCP server entry point for ai-review-mcp.
// Exposes the review_diff tool over stdio transport.
//
// WHY stdio: Cursor spawns local MCP servers as child processes and communicates
// over stdin/stdout. All diagnostic output must go to stderr — stdout is the
// MCP protocol channel.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { runReviewTool } from './tool.js'

const server = new Server(
  { name: 'ai-review', version: '0.6.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'review_diff',
      description:
        'Run the AI code review swarm on the current git diff. ' +
        'Uses 10 specialist agents (security, performance, correctness, design, ' +
        'dependencies, adversarial, integration, breaking-change, license, coverage) ' +
        'powered by Ollama locally — no API costs, fully offline. ' +
        'Returns a markdown summary with full detail for critical/high findings.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description:
              'Absolute path to the repository root. ' +
              'Defaults to the server\'s working directory (Cursor sets this to the workspace root).',
          },
        },
        required: [],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'review_diff') {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
  }

  const args = (request.params.arguments ?? {}) as { repo_path?: string }

  try {
    const text = await runReviewTool({ repo_path: args.repo_path })
    return { content: [{ type: 'text', text }] }
  } catch (err) {
    // runReviewTool catches and formats errors itself — this is a safety net only.
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `## AI Code Review\n\nUnexpected error: ${msg}` }] }
  }
})

// WHY: process.stderr for diagnostics — stdout is reserved for the MCP protocol.
process.stderr.write('[ai-review-mcp] Server starting...\n')

const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write('[ai-review-mcp] Server ready.\n')
```

- [ ] **Step 3: Confirm TypeScript compiles (no build yet)**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): add MCP server entry point (stdio transport)"
```

---

## Task 4: package.json updates

Add the `ai-review-mcp` bin entry. The MCP SDK is already in `dependencies` from the `npm install` in Task 3 — just verify and commit.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the bin entry**

Edit `package.json` — change the `bin` field from:
```json
"bin": {
  "ai-review-agent": "./dist/cli/index.js"
}
```
to:
```json
"bin": {
  "ai-review-agent": "./dist/cli/index.js",
  "ai-review-mcp": "./dist/mcp/server.js"
}
```

- [ ] **Step 2: Verify @modelcontextprotocol/sdk is in dependencies (not devDependencies)**

```
node -e "const p = require('./package.json'); console.log(p.dependencies['@modelcontextprotocol/sdk'])"
```

Expected: prints a version string like `^1.0.0`. If it printed `undefined`, move it from `devDependencies` to `dependencies` manually.

- [ ] **Step 3: Run full test suite to confirm nothing regressed**

```
npm test
```

Expected: all tests PASS (existing 62 + new mcp tests)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ai-review-mcp bin entry to package.json"
```

---

## Task 5: Build + smoke test

Build the project and verify the MCP server binary starts and responds to a `tools/list` request.

**Files:** None modified.

- [ ] **Step 1: Build**

```
npm run build
```

Expected: exits 0. Verify the new file exists:
```
ls dist/mcp/server.js
```
Expected: file present

- [ ] **Step 2: Smoke test — tools/list**

On Windows (PowerShell):
```powershell
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp/server.js
```

On macOS/Linux:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp/server.js
```

Expected: JSON response containing `review_diff` in the tools array. Stderr may show `[ai-review-mcp] Server starting...` and `[ai-review-mcp] Server ready.`

Example expected stdout:
```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"review_diff","description":"...","inputSchema":{...}}]}}
```

- [ ] **Step 3: Commit**

```bash
git add dist/
git commit -m "chore: build dist for v0.6.0 MCP server"
```

---

## Task 6: Cursor wiring + documentation

Add the Cursor config file and document how to connect the server.

**Files:**
- Create: `.cursor/mcp.json`
- Modify: `README.md` — add MCP / Cursor section

- [ ] **Step 1: Create .cursor/mcp.json**

```json
{
  "mcpServers": {
    "ai-review": {
      "command": "ai-review-mcp",
      "args": []
    }
  }
}
```

Save to `.cursor/mcp.json` in the project root.

Note: this file configures Cursor for this project. Users who install `ai-review-agent` globally and want it available in all workspaces should copy this to their global `~/.cursor/mcp.json`.

- [ ] **Step 2: Add README section**

Add the following section to `README.md` after the existing "Install" section:

```markdown
## Cursor Integration (MCP)

After installing globally, add this to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ai-review": {
      "command": "ai-review-mcp",
      "args": []
    }
  }
}
```

Restart Cursor. The `review_diff` tool will appear in **Settings → MCP**. In Cursor's chat panel, ask:

> Review my staged changes

or invoke directly:

> @ai-review review_diff

Requires Ollama running locally with `devstral:latest` pulled. The tool runs 10 agents (security, performance, correctness, design, dependencies, adversarial, integration, breaking-change, license, coverage). For generated test files, use the CLI (`ai-review-agent`).
```

- [ ] **Step 3: Run full test suite one final time**

```
npm test
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add .cursor/mcp.json README.md
git commit -m "docs: add Cursor MCP config and README section for review_diff tool"
```

---

## Verification Checklist

Before marking the feature complete:

- [ ] `npm test` passes (all existing + new mcp tests)
- [ ] `npm run build` succeeds, `dist/mcp/server.js` exists
- [ ] Smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp/server.js` returns JSON with `review_diff`
- [ ] `review_diff` appears in Cursor Settings → MCP after adding `.cursor/mcp.json`
- [ ] Invoking the tool from Cursor chat with no staged changes returns the "no staged changes" message
- [ ] Invoking the tool with staged changes returns a markdown review

---

## Out of Scope

- Coverage/testgen agents generating test files in MCP context (CLI only)
- Anthropic provider (backlogged)
- HTTP transport
- Auto-wiring Cursor config during `npm install`
- Publishing to npm (bump version separately after this lands)
