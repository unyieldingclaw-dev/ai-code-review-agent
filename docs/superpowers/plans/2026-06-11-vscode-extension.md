# v0.5.0 Cursor/VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cursor/VS Code extension that runs the `ai-review-agent` swarm on staged git changes and surfaces findings as inline editor diagnostics + a markdown OutputChannel report.

**Architecture:** A `vscode-extension/` subfolder contains its own `package.json` and TypeScript source. At runtime the extension gets the staged diff itself via `git diff --cached`, writes it to a temp file, then shells out to the bundled `ai-review-agent` CLI (`node <path> --format json`), parses the `ReviewResult` JSON from stdout, maps findings to `vscode.DiagnosticCollection` (editor squiggles) and an OutputChannel (full report). No monorepo restructuring.

**Tech Stack:** TypeScript (CommonJS, targeting Node 18), esbuild (extension bundler), `@vscode/vsce` (`.vsix` packager), vitest (unit tests), `@types/vscode ^1.85.0`.

---

## File Map

| Path                                         | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `src/cli/index.ts`                           | **Modify**: add `--ollama-url` CLI flag (3-line change)              |
| `vscode-extension/package.json`              | Extension manifest, VS Code settings schema, dependencies            |
| `vscode-extension/tsconfig.json`             | CommonJS, ES2020, strict, `src/` → `dist/`                           |
| `vscode-extension/vitest.config.ts`          | Alias `vscode` module to test mock                                   |
| `vscode-extension/esbuild.config.js`         | Bundle `src/extension.ts` → `dist/extension.js`                      |
| `vscode-extension/.vscodeignore`             | Exclude src/tests/docs from `.vsix`                                  |
| `vscode-extension/tests/__mocks__/vscode.ts` | Stub the VS Code API for unit tests                                  |
| `vscode-extension/src/types.ts`              | Local mirror of `FindingResult` types (avoids ESM/CJS import issues) |
| `vscode-extension/src/config.ts`             | Read `aiReview.*` workspace settings, build CLI arg array            |
| `vscode-extension/src/runner.ts`             | Get staged diff, spawn CLI subprocess, parse stdout JSON             |
| `vscode-extension/src/diagnostics.ts`        | Map `Finding[]` to `vscode.DiagnosticCollection`                     |
| `vscode-extension/src/output.ts`             | Format `ReviewResult` as markdown in OutputChannel                   |
| `vscode-extension/src/extension.ts`          | `activate()` — register command, wire components together            |
| `vscode-extension/tests/config.test.ts`      | Unit tests: settings read, defaults, CLI arg assembly                |
| `vscode-extension/tests/runner.test.ts`      | Unit tests: spawn mock, JSON parse, error detection, cancel          |
| `vscode-extension/tests/diagnostics.test.ts` | Unit tests: severity mapping, line offset, collection clear          |
| `vscode-extension/README.md`                 | Marketplace description, install steps, usage                        |

---

## Critical Background (read before touching any file)

**stdout has mixed content.** The CLI always writes progress lines before the JSON:

```
\n🔍 Running ai-review-agent with 11 agents...\n\n  ✓ security\n...
\n{"findings":[...], "testFiles":[], "summary":{...}}\n
```

The runner must find the first `{` in stdout and parse from there. `JSON.parse(stdout)` will fail.

**`ReviewResult` shape, not `Finding[]`.** The CLI's `--format json` output is:

```typescript
{ findings: Finding[], testFiles: GeneratedTestFile[], summary: ReviewSummary }
```

Parse `result.findings`, NOT the top-level stdout as an array.

**Do NOT pass `--dir` for staged diff.** With `--dir`, the CLI runs `git diff HEAD` (unstaged). Instead: the extension runs `git diff --cached` itself, writes to a temp file, then passes `--diff <tempFile> --dir <workspaceDir>`. The `--dir` is still needed for config file loading (`ai-review.config.json`) and test file output paths — but `getDiff` in the CLI skips the dir when `--diff` is provided.

**`--timeout` is milliseconds in the CLI.** The VS Code setting `aiReview.timeout` defaults to `120` (seconds). Multiply by `1000` when building the CLI args.

**`--fail-on never` is required.** Without it, the CLI exits code 1 when it finds high-severity issues. The extension must handle results regardless of exit code, so always pass `--fail-on never`.

**Finding.line is 1-based.** VS Code Diagnostics use 0-based lines. Subtract 1: `finding.line - 1`.

**CLI path inside `.vsix`.** `context.extensionPath` is the extension install dir. The bundled CLI is at:

```
<extensionPath>/node_modules/ai-review-agent/dist/cli/index.js
```

**`--ollama-url` does not exist yet.** The CLI has no flag for Ollama URL override — it only reads from `ai-review.config.json`. Task 0 adds this flag to the CLI before extension work begins.

---

## Task 0: Add `--ollama-url` to the CLI

**Files:**

- Modify: `src/cli/index.ts`

The extension setting `aiReview.ollamaUrl` needs a corresponding CLI flag. This is a 3-line addition to `src/cli/index.ts`.

- [ ] **Step 1: Add the option declaration**

In `src/cli/index.ts`, find the `.option('--model <model>', ...)` line and add the `--ollama-url` option immediately after it:

```typescript
// Before (around line 22):
  .option('--model <model>', 'Override Ollama model')
  .option('--agents <list>', 'Comma-separated list of agents to run')

// After:
  .option('--model <model>', 'Override Ollama model')
  .option('--ollama-url <url>', 'Override Ollama base URL')
  .option('--agents <list>', 'Comma-separated list of agents to run')
```

- [ ] **Step 2: Add the type annotation**

In the `.action(async (options: { ... })` block, add `ollamaUrl?: string` alongside the other option fields:

```typescript
// The options type block (around line 31-43). Add ollamaUrl after model:
  action(async (options: {
    diff?: string
    dir?: string
    model?: string
    ollamaUrl?: string        // ← add this line
    agents?: string
    format: 'markdown' | 'json'
    out?: string
    maxLines?: number
    timeout?: number
    failOn: FailOnLevel
    ignore: string[]
    sanitize: boolean
  }) => {
```

- [ ] **Step 3: Apply the override to config**

Find the block where `options.model` is applied to config (around line 47) and add the URL override on the next line:

```typescript
if (options.model) config.model = options.model
if (options.ollamaUrl) config.ollamaUrl = options.ollamaUrl // ← add this line
if (options.agents) config.agents = options.agents.split(',').map((a) => a.trim()) as AgentName[]
```

- [ ] **Step 4: Verify CLI still works**

```bash
npm run build
node dist/cli/index.js --help
```

Expected: `--ollama-url <url>` appears in the help output under options. No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add --ollama-url flag for extension integration"
```

---

## Task 1: Extension Project Scaffold

**Files:**

- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/vitest.config.ts`
- Create: `vscode-extension/esbuild.config.js`
- Create: `vscode-extension/.vscodeignore`

- [ ] **Step 1: Create `vscode-extension/package.json`**

```json
{
  "name": "ai-review-agent",
  "displayName": "AI Review Agent",
  "description": "Local AI code review — run an 11-agent Ollama swarm on your staged changes",
  "version": "0.5.0",
  "publisher": "unyieldingclaw",
  "engines": {
    "vscode": "^1.85.0"
  },
  "extensionKind": ["workspace"],
  "categories": ["Linters"],
  "activationEvents": ["onCommand:aiReview.reviewStagedChanges"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "aiReview.reviewStagedChanges",
        "title": "AI Review: Review Staged Changes"
      }
    ],
    "configuration": {
      "title": "AI Review",
      "properties": {
        "aiReview.ollamaUrl": {
          "type": "string",
          "default": "http://localhost:11434",
          "description": "Ollama base URL (e.g. http://localhost:11434)"
        },
        "aiReview.model": {
          "type": "string",
          "default": "devstral:latest",
          "description": "Ollama model to use for code review"
        },
        "aiReview.agents": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Agents to run. Empty array runs all 11 agents. Valid values: security, performance, correctness, design, dependencies, coverage, testgen, adversarial, integration, breaking-change, license"
        },
        "aiReview.maxLines": {
          "type": "number",
          "default": 2000,
          "description": "Maximum diff lines to send for review"
        },
        "aiReview.timeout": {
          "type": "number",
          "default": 120,
          "description": "Per-agent timeout in seconds (passed to CLI as milliseconds)"
        }
      }
    }
  },
  "scripts": {
    "compile": "node esbuild.config.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "package": "vsce package"
  },
  "dependencies": {
    "ai-review-agent": "^0.4.0"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `vscode-extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2020"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vscode-extension/vitest.config.ts`**

This aliases the `vscode` module to our test stub so unit tests can import extension source without a running VS Code instance.

```typescript
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./tests/__mocks__/vscode.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `vscode-extension/esbuild.config.js`**

```js
require('esbuild')
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
  })
  .catch(() => process.exit(1))
```

- [ ] **Step 5: Create `vscode-extension/.vscodeignore`**

```
.vscode/**
src/**
tests/**
*.map
esbuild.config.js
tsconfig.json
vitest.config.ts
node_modules/ai-review-agent/src/**
node_modules/ai-review-agent/tests/**
node_modules/ai-review-agent/calibration/**
node_modules/ai-review-agent/memory-bank/**
node_modules/ai-review-agent/.github/**
node_modules/ai-review-agent/.claude/**
node_modules/ai-review-agent/docs/**
```

`node_modules/ai-review-agent/dist/` is intentionally **not** excluded — it's what the subprocess runs.

- [ ] **Step 6: Install dependencies**

```bash
cd vscode-extension
npm install
```

Expected: `node_modules/` created, `ai-review-agent/dist/cli/index.js` present.

Verify:

```bash
ls node_modules/ai-review-agent/dist/cli/index.js
```

- [ ] **Step 7: Commit scaffold**

```bash
git add vscode-extension/
git commit -m "feat(vscode): extension scaffold — package.json, tsconfig, esbuild, vitest"
```

---

## Task 2: VS Code API Mock + types.ts

**Files:**

- Create: `vscode-extension/tests/__mocks__/vscode.ts`
- Create: `vscode-extension/src/types.ts`

- [ ] **Step 1: Create `vscode-extension/tests/__mocks__/vscode.ts`**

This stub is required for every unit test that imports extension source. It provides the VS Code API surface used by the extension. `vitest.config.ts` aliases `import ... from 'vscode'` to this file.

```typescript
import { vi } from 'vitest'

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
  SourceControl = 1,
}

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export class Diagnostic {
  public source?: string
  public code?: string | number | { value: string | number; target: unknown }

  constructor(
    public range: Range,
    public message: string,
    public severity?: DiagnosticSeverity
  ) {}
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
}

export const languages = {
  createDiagnosticCollection: vi.fn(() => ({
    set: vi.fn(),
    clear: vi.fn(),
    delete: vi.fn(),
    dispose: vi.fn(),
  })),
}

export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  withProgress: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
}

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
}

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
  })),
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
}
```

- [ ] **Step 2: Create `vscode-extension/src/types.ts`**

Local mirrors of `ai-review-agent` types. We do NOT import from the package because it's ESM (`"type": "module"`) and importing its internals from a CommonJS extension would require complex interop. These are structural mirrors — if the upstream schema changes, update these too.

```typescript
// Local mirrors of ai-review-agent's core/schema.ts types.
// Structural mirror only — do not import from the package to avoid ESM/CJS mismatch.

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Finding {
  id: string
  agent: string
  severity: Severity
  basis: string
  file: string
  line: number // 1-based line number in the source file
  title: string
  detail: string
  suggestion: string
  confidence?: number
  corroboratingAgents?: string[]
  relatedFindings?: string[]
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<string, number>>
  durationMs: number
}

export interface GeneratedTestFile {
  path: string
  content: string
  framework: string
}

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
}

export interface ExtensionConfig {
  ollamaUrl: string
  model: string
  agents: string[] // empty = all agents
  maxLines: number
  timeoutSecs: number // seconds; converted to ms before passing to CLI
  cliPath: string // absolute path to bundled CLI index.js
}
```

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/tests/__mocks__/vscode.ts vscode-extension/src/types.ts
git commit -m "feat(vscode): add vscode API mock + local type mirrors"
```

---

## Task 3: `config.ts` + Tests

**Files:**

- Create: `vscode-extension/src/config.ts`
- Create: `vscode-extension/tests/config.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `vscode-extension/tests/config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscodeModule from 'vscode'
import path from 'path'

// Must be imported AFTER vi.mock calls take effect (vitest hoists vi.mock)
// vscode is already aliased to our mock via vitest.config.ts

describe('getConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)
  })

  it('returns defaults when no user settings are configured', async () => {
    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')

    expect(config.ollamaUrl).toBe('http://localhost:11434')
    expect(config.model).toBe('devstral:latest')
    expect(config.agents).toEqual([])
    expect(config.maxLines).toBe(2000)
    expect(config.timeoutSecs).toBe(120)
    expect(config.cliPath).toBe(
      path.join('/ext/path', 'node_modules', 'ai-review-agent', 'dist', 'cli', 'index.js')
    )
  })

  it('reads aiReview.ollamaUrl from VS Code settings', async () => {
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === 'ollamaUrl') return 'http://192.168.1.10:11434'
        return defaultVal
      }),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)

    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')
    expect(config.ollamaUrl).toBe('http://192.168.1.10:11434')
  })

  it('reads aiReview.agents array from VS Code settings', async () => {
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === 'agents') return ['security', 'performance']
        return defaultVal
      }),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)

    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')
    expect(config.agents).toEqual(['security', 'performance'])
  })
})

describe('buildCliArgs', () => {
  const baseConfig = {
    ollamaUrl: 'http://localhost:11434',
    model: 'devstral:latest',
    agents: [] as string[],
    maxLines: 2000,
    timeoutSecs: 120,
    cliPath: '/ext/node_modules/ai-review-agent/dist/cli/index.js',
  }

  it('assembles required flags', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(baseConfig, '/workspace', '/tmp/ai-review-123.diff')

    expect(args).toContain(baseConfig.cliPath)
    expect(args).toContain('--diff')
    expect(args).toContain('/tmp/ai-review-123.diff')
    expect(args).toContain('--dir')
    expect(args).toContain('/workspace')
    expect(args).toContain('--format')
    expect(args).toContain('json')
    expect(args).toContain('--ollama-url')
    expect(args).toContain('http://localhost:11434')
    expect(args).toContain('--model')
    expect(args).toContain('devstral:latest')
    expect(args).toContain('--fail-on')
    expect(args).toContain('never')
  })

  it('converts timeoutSecs to milliseconds for --timeout', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(baseConfig, '/workspace', '/tmp/diff')
    const timeoutIdx = args.indexOf('--timeout')
    expect(timeoutIdx).not.toBe(-1)
    expect(args[timeoutIdx + 1]).toBe('120000')
  })

  it('omits --agents when agents array is empty (runs all agents)', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs({ ...baseConfig, agents: [] }, '/workspace', '/tmp/diff')
    expect(args).not.toContain('--agents')
  })

  it('includes --agents as comma-joined string when agents are specified', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(
      { ...baseConfig, agents: ['security', 'performance'] },
      '/workspace',
      '/tmp/diff'
    )
    const agentsIdx = args.indexOf('--agents')
    expect(agentsIdx).not.toBe(-1)
    expect(args[agentsIdx + 1]).toBe('security,performance')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd vscode-extension
npx vitest run tests/config.test.ts
```

Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 3: Implement `vscode-extension/src/config.ts`**

```typescript
import * as vscode from 'vscode'
import * as path from 'path'
import type { ExtensionConfig } from './types'

/**
 * Read aiReview.* settings from the VS Code workspace configuration and
 * resolve the bundled CLI path relative to the extension install directory.
 */
export function getConfig(extensionPath: string): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiReview')

  return {
    ollamaUrl: cfg.get('ollamaUrl', 'http://localhost:11434'),
    model: cfg.get('model', 'devstral:latest'),
    agents: cfg.get<string[]>('agents', []),
    maxLines: cfg.get('maxLines', 2000),
    timeoutSecs: cfg.get('timeout', 120),
    cliPath: path.join(extensionPath, 'node_modules', 'ai-review-agent', 'dist', 'cli', 'index.js'),
  }
}

/**
 * Build the argument array for spawning the CLI subprocess.
 * The caller provides the temp diff file path; this function handles all
 * the flag assembly including the seconds→ms conversion for --timeout.
 */
export function buildCliArgs(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string
): string[] {
  const args = [
    config.cliPath,
    '--diff',
    diffFile,
    '--dir',
    workspaceDir,
    '--format',
    'json',
    '--ollama-url',
    config.ollamaUrl,
    '--model',
    config.model,
    '--max-lines',
    String(config.maxLines),
    '--timeout',
    String(config.timeoutSecs * 1000), // CLI takes milliseconds
    '--fail-on',
    'never', // extension handles results; never let CLI gate on exit code
  ]

  if (config.agents.length > 0) {
    args.push('--agents', config.agents.join(','))
  }

  return args
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd vscode-extension
npx vitest run tests/config.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/config.ts vscode-extension/tests/config.test.ts
git commit -m "feat(vscode): config.ts — read settings, build CLI arg array"
```

---

## Task 4: `runner.ts` + Tests

**Files:**

- Create: `vscode-extension/src/runner.ts`
- Create: `vscode-extension/tests/runner.test.ts`

The runner is the most complex module. It owns: getting the staged diff, writing the temp file, spawning the CLI, collecting output, parsing JSON, cleaning up, and handling cancellation.

- [ ] **Step 1: Write the failing tests**

Create `vscode-extension/tests/runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionConfig } from '../src/types'

// Hoist vi.mock calls — vitest moves these before imports automatically
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}))

import { execSync, spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { runReview } from '../src/runner'

const mockConfig: ExtensionConfig = {
  ollamaUrl: 'http://localhost:11434',
  model: 'devstral:latest',
  agents: [],
  maxLines: 2000,
  timeoutSecs: 120,
  cliPath: '/ext/node_modules/ai-review-agent/dist/cli/index.js',
}

const mockToken = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
}

/**
 * Creates a fake child_process with controllable stdout/stderr/close events.
 * Uses setImmediate to simulate async event emission in the correct order:
 * data events fire before close.
 */
function makeChild(stdoutData: string, exitCode = 0, stderrData = '') {
  const child = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  }

  child.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
    if (event === 'data') setImmediate(() => cb(Buffer.from(stdoutData)))
  })

  child.stderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
    if (event === 'data') setImmediate(() => cb(Buffer.from(stderrData)))
  })

  child.on.mockImplementation((event: string, cb: (code: number) => void) => {
    if (event === 'close') setImmediate(() => cb(exitCode))
  })

  return child
}

describe('runReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws "nothing-staged" when git diff --cached returns empty string', async () => {
    vi.mocked(execSync).mockReturnValue('')
    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'nothing-staged'
    )
  })

  it('throws "git not found" when execSync throws with spawn error', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    })
    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'git not found'
    )
  })

  it('writes staged diff to a temp file and deletes it after run', async () => {
    const mockResult = {
      findings: [],
      testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 42 },
    }
    const cliOutput = '\n🔍 Running...\n\n  ✓ security\n\n' + JSON.stringify(mockResult)

    vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
    vi.mocked(spawn).mockReturnValue(makeChild(cliOutput) as any)

    await runReview(mockConfig, '/workspace', mockToken as any)

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/ai-review-\d+\.diff$/),
      expect.any(String),
      'utf-8'
    )
    expect(unlinkSync).toHaveBeenCalled()
  })

  it('parses ReviewResult from CLI stdout that contains progress lines before JSON', async () => {
    const mockResult = {
      findings: [
        {
          id: 'f1',
          agent: 'security',
          severity: 'high',
          basis: 'VERIFIED',
          file: 'src/auth.ts',
          line: 42,
          title: 'SQL Injection',
          detail: 'Unsanitized input',
          suggestion: 'Use parameterized queries',
          confidence: 85,
        },
      ],
      testFiles: [],
      summary: {
        totalFindings: 1,
        bySeverity: { high: 1 },
        byAgent: { security: 1 },
        durationMs: 8000,
      },
    }
    // CLI stdout has progress noise before the JSON
    const cliOutput =
      '\n🔍 Running ai-review-agent with 11 agents...\n\n  ✓ security\n\n' +
      JSON.stringify(mockResult)

    vi.mocked(execSync).mockReturnValue('some staged diff content')
    vi.mocked(spawn).mockReturnValue(makeChild(cliOutput) as any)

    const result = await runReview(mockConfig, '/workspace', mockToken as any)

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe('high')
    expect(result.summary.totalFindings).toBe(1)
  })

  it('throws "ollama-unreachable" when CLI exits non-zero with ECONNREFUSED in stderr', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(
      makeChild('', 1, 'Error: connect ECONNREFUSED 127.0.0.1:11434') as any
    )

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'ollama-unreachable:'
    )
  })

  it('throws "cli-error" for non-zero exit with unrecognised stderr', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(makeChild('', 1, 'Some unexpected crash') as any)

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'cli-error:'
    )
  })

  it('throws "parse-error" when stdout has no JSON object', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(makeChild('no json here', 0) as any)

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'parse-error:'
    )
  })

  it('kills child process and throws "cancelled" when cancellation token fires', async () => {
    let cancelCallback: (() => void) | undefined

    const cancelToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn((cb: () => void) => {
        cancelCallback = cb
        return { dispose: vi.fn() }
      }),
    }

    // child.on('close') never fires — simulates a long-running process
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: vi.fn(), // never calls 'close'
    }

    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(child as any)

    const promise = runReview(mockConfig, '/workspace', cancelToken as any)

    // Trigger cancellation after spawn
    await Promise.resolve()
    cancelCallback?.()

    await expect(promise).rejects.toThrow('cancelled')
    expect(child.kill).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd vscode-extension
npx vitest run tests/runner.test.ts
```

Expected: FAIL — `Cannot find module '../src/runner'`

- [ ] **Step 3: Implement `vscode-extension/src/runner.ts`**

```typescript
import { execSync, spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as vscode from 'vscode'
import { buildCliArgs } from './config'
import type { ExtensionConfig, ReviewResult } from './types'

/**
 * Get the staged diff, spawn the CLI, parse the result.
 *
 * Throws:
 *   'nothing-staged'          — git diff --cached returned empty; user must git add first
 *   'git not found'           — git binary not on PATH
 *   'cancelled'               — user clicked Cancel in the progress notification
 *   'ollama-unreachable:<url>'— CLI exited non-zero with ECONNREFUSED in stderr
 *   'cli-error:<stderr>'      — CLI exited non-zero for another reason
 *   'parse-error:<fragment>'  — stdout contained no parseable JSON object
 */
export async function runReview(
  config: ExtensionConfig,
  workspaceDir: string,
  token: vscode.CancellationToken
): Promise<ReviewResult> {
  const diff = getStagedDiff(workspaceDir)

  const tempFile = join(tmpdir(), `ai-review-${Date.now()}.diff`)
  writeFileSync(tempFile, diff, 'utf-8')

  try {
    return await spawnCli(config, workspaceDir, tempFile, token)
  } finally {
    try {
      unlinkSync(tempFile)
    } catch {
      /* ignore cleanup failure */
    }
  }
}

function getStagedDiff(workspaceDir: string): string {
  let diff: string
  try {
    diff = execSync('git diff --cached', { cwd: workspaceDir, encoding: 'utf-8' }) as string
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT' || (e.message ?? '').toLowerCase().includes('enoent')) {
      throw new Error('git not found. Ensure git is installed and in your PATH.')
    }
    throw err
  }

  if (!diff.trim()) {
    throw new Error('nothing-staged')
  }

  return diff
}

function spawnCli(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string,
  token: vscode.CancellationToken
): Promise<ReviewResult> {
  return new Promise((resolve, reject) => {
    const args = buildCliArgs(config, workspaceDir, diffFile)
    // args[0] is the CLI path; process.execPath is the Node binary
    const child = spawn(process.execPath, args, { cwd: workspaceDir })

    // Register cancellation handler; keep Disposable to clean up on close
    const cancelDisposable = token.onCancellationRequested(() => {
      child.kill()
      reject(new Error('cancelled'))
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code: number) => {
      cancelDisposable.dispose()

      if (code !== 0) {
        if (stderr.includes('ECONNREFUSED')) {
          reject(new Error(`ollama-unreachable:${config.ollamaUrl}`))
        } else {
          reject(new Error(`cli-error:${stderr.slice(0, 500)}`))
        }
        return
      }

      // stdout = progress lines + "\n" + JSON. Find where the JSON object begins.
      const jsonStart = stdout.indexOf('{')
      if (jsonStart === -1) {
        reject(new Error(`parse-error:${stdout.slice(0, 200)}`))
        return
      }

      try {
        const result: ReviewResult = JSON.parse(stdout.slice(jsonStart))
        resolve(result)
      } catch {
        reject(new Error(`parse-error:${stdout.slice(jsonStart, jsonStart + 200)}`))
      }
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd vscode-extension
npx vitest run tests/runner.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/runner.ts vscode-extension/tests/runner.test.ts
git commit -m "feat(vscode): runner.ts — staged diff, subprocess spawn, JSON parse"
```

---

## Task 5: `diagnostics.ts` + Tests

**Files:**

- Create: `vscode-extension/src/diagnostics.ts`
- Create: `vscode-extension/tests/diagnostics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vscode-extension/tests/diagnostics.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import type { Finding } from '../src/types'

describe('applyDiagnostics', () => {
  let collection: ReturnType<typeof vscode.languages.createDiagnosticCollection>

  beforeEach(() => {
    vi.clearAllMocks()
    // Each test gets a fresh mock collection
    collection = vscode.languages.createDiagnosticCollection('test')
  })

  function makefinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: 'f1',
      agent: 'security',
      severity: 'high',
      basis: 'VERIFIED',
      file: 'src/auth.ts',
      line: 10,
      title: 'Test Finding',
      detail: 'Detail text',
      suggestion: 'Fix it',
      ...overrides,
    }
  }

  it('clears the collection before applying new diagnostics', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')
    expect(collection.clear).toHaveBeenCalledOnce()
  })

  it('maps critical severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makefinding({ severity: 'critical' })], '/workspace')

    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error }),
      ])
    )
  })

  it('maps high severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makefinding({ severity: 'high' })], '/workspace')

    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error }),
      ])
    )
  })

  it('maps medium severity → DiagnosticSeverity.Warning', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makefinding({ severity: 'medium' })], '/workspace')

    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Warning }),
      ])
    )
  })

  it('maps low severity → DiagnosticSeverity.Information', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makefinding({ severity: 'low' })], '/workspace')

    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Information }),
      ])
    )
  })

  it('converts 1-based Finding.line to 0-based range (line 1 → range startLine 0)', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeinding({ line: 1 })], '/workspace')

    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect(diags[0].range.startLine).toBe(0)
  })

  it('converts 1-based Finding.line to 0-based range (line 42 → range startLine 41)', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ line: 42 })], '/workspace')

    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect(diags[0].range.startLine).toBe(41)
  })

  it('groups findings from the same file into a single collection.set call', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    const findings = [
      makeinding({ id: 'f1', file: 'src/shared.ts', line: 1, severity: 'high' }),
      makeinding({ id: 'f2', file: 'src/shared.ts', line: 5, severity: 'medium' }),
    ]
    applyDiagnostics(collection as any, findings, '/workspace')

    // clear() is always called first
    expect(collection.clear).toHaveBeenCalledOnce()
    // set() is called exactly once (both findings grouped under the same file URI)
    expect(collection.set).toHaveBeenCalledTimes(1)
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect(diags).toHaveLength(2)
  })

  it('calls collection.set once per unique file', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    const findings = [
      makeinding({ id: 'f1', file: 'src/a.ts', line: 1 }),
      makeinding({ id: 'f2', file: 'src/b.ts', line: 2 }),
    ]
    applyDiagnostics(collection as any, findings, '/workspace')

    expect(collection.set).toHaveBeenCalledTimes(2)
  })

  it('does nothing (except clear) when findings array is empty', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')

    expect(collection.clear).toHaveBeenCalledOnce()
    expect(collection.set).not.toHaveBeenCalled()
  })
})

// Helper used in tests — note: must match what's in the test file scope
function makeinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    agent: 'security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'src/auth.ts',
    line: 10,
    title: 'Test Finding',
    detail: 'Detail text',
    suggestion: 'Fix it',
    ...overrides,
  }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return makeinding(overrides)
}
```

**Note:** The test file above has a typo intentionally (`makeinding` vs `makeinding`) that will surface as a test error — fix it by using a consistent helper name in your implementation. Use `makeFinding` everywhere.

- [ ] **Step 1 (corrected): Write the failing tests**

Replace the test file with the corrected version (consistent `makeFinding` throughout):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import type { Finding } from '../src/types'

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    agent: 'security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'src/auth.ts',
    line: 10,
    title: 'Test Finding',
    detail: 'Detail text',
    suggestion: 'Fix it',
    ...overrides,
  }
}

describe('applyDiagnostics', () => {
  let collection: ReturnType<typeof vscode.languages.createDiagnosticCollection>

  beforeEach(() => {
    vi.clearAllMocks()
    collection = vscode.languages.createDiagnosticCollection('test')
  })

  it('clears the collection before applying new diagnostics', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')
    expect(collection.clear).toHaveBeenCalledOnce()
  })

  it('maps critical severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'critical' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error }),
      ])
    )
  })

  it('maps high severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'high' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error }),
      ])
    )
  })

  it('maps medium severity → DiagnosticSeverity.Warning', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'medium' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Warning }),
      ])
    )
  })

  it('maps low severity → DiagnosticSeverity.Information', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'low' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ severity: vscode.DiagnosticSeverity.Information }),
      ])
    )
  })

  it('converts line 1 → range startLine 0 (1-based to 0-based)', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ line: 1 })], '/workspace')
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect((diags[0].range as vscode.Range).startLine).toBe(0)
  })

  it('converts line 42 → range startLine 41', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ line: 42 })], '/workspace')
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect((diags[0].range as vscode.Range).startLine).toBe(41)
  })

  it('groups findings from same file into one collection.set call', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    const findings = [
      makeFinding({ id: 'f1', file: 'src/shared.ts', line: 1 }),
      makeFinding({ id: 'f2', file: 'src/shared.ts', line: 5, severity: 'medium' }),
    ]
    applyDiagnostics(collection as any, findings, '/workspace')
    expect(collection.set).toHaveBeenCalledTimes(1)
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect(diags).toHaveLength(2)
  })

  it('calls collection.set once per unique file', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(
      collection as any,
      [
        makeFinding({ id: 'f1', file: 'src/a.ts', line: 1 }),
        makeFinding({ id: 'f2', file: 'src/b.ts', line: 2 }),
      ],
      '/workspace'
    )
    expect(collection.set).toHaveBeenCalledTimes(2)
  })

  it('does nothing except clear when findings is empty', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')
    expect(collection.clear).toHaveBeenCalledOnce()
    expect(collection.set).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd vscode-extension
npx vitest run tests/diagnostics.test.ts
```

Expected: FAIL — `Cannot find module '../src/diagnostics'`

- [ ] **Step 3: Implement `vscode-extension/src/diagnostics.ts`**

```typescript
import * as vscode from 'vscode'
import * as path from 'path'
import type { Finding, Severity } from './types'

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
}

/**
 * Replace the entire DiagnosticCollection with new findings.
 * Cleared first (atomically replacing old results when new ones arrive).
 * Findings are grouped by file; each file gets one collection.set() call.
 *
 * Finding.line is 1-based; VS Code Range is 0-based — subtract 1.
 * Range spans the full line (column 0 to MAX_SAFE_INTEGER) so the squiggle
 * covers the whole line when no column info is available.
 */
export function applyDiagnostics(
  collection: vscode.DiagnosticCollection,
  findings: Finding[],
  workspaceDir: string
): void {
  collection.clear()

  // Group by absolute file path, keeping the URI alongside the diagnostics
  const byFile = new Map<string, [vscode.Uri, vscode.Diagnostic[]]>()

  for (const finding of findings) {
    const uri = vscode.Uri.file(path.join(workspaceDir, finding.file))
    const key = uri.fsPath

    const line = Math.max(0, finding.line - 1) // 1-based → 0-based
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)
    const severity = SEVERITY_MAP[finding.severity] ?? vscode.DiagnosticSeverity.Information

    const diag = new vscode.Diagnostic(
      range,
      `[${finding.agent}] ${finding.title}: ${finding.detail}`,
      severity
    )
    diag.source = 'AI Review'
    diag.code = finding.id

    if (!byFile.has(key)) {
      byFile.set(key, [uri, []])
    }
    byFile.get(key)![1].push(diag)
  }

  for (const [, [uri, diags]] of byFile) {
    collection.set(uri, diags)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd vscode-extension
npx vitest run tests/diagnostics.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/diagnostics.ts vscode-extension/tests/diagnostics.test.ts
git commit -m "feat(vscode): diagnostics.ts — map findings to DiagnosticCollection"
```

---

## Task 6: `output.ts`

**Files:**

- Create: `vscode-extension/src/output.ts`

No unit test — this is pure string formatting with no branching that isn't already exercised by the smoke test checklist. The function takes an OutputChannel and a ReviewResult; it formats and writes. A unit test would just assert on `appendLine` call counts which gives no real confidence.

- [ ] **Step 1: Create `vscode-extension/src/output.ts`**

```typescript
import type * as vscode from 'vscode'
import type { ReviewResult, Severity } from './types'

type OutputChannel = vscode.OutputChannel

const HEADER: Record<Severity, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  medium: '🟡 MEDIUM',
  low: '🔵 LOW',
}

/**
 * Render a full ReviewResult as a human-readable markdown-ish report in the
 * given OutputChannel. Clears existing content before writing.
 */
export function renderReport(channel: OutputChannel, result: ReviewResult): void {
  channel.clear()

  const { findings, summary } = result
  const count = summary.totalFindings
  const plural = count === 1 ? 'finding' : 'findings'

  channel.appendLine('# AI Code Review Report')
  channel.appendLine('')
  channel.appendLine(`${count} ${plural}  |  ${summary.durationMs}ms`)
  channel.appendLine('')

  if (findings.length === 0) {
    channel.appendLine('✅ No issues found.')
    return
  }

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = findings.filter((f) => f.severity === severity)
    if (group.length === 0) continue

    channel.appendLine(`## ${HEADER[severity]} (${group.length})`)
    channel.appendLine('')

    for (const f of group) {
      const confidence = f.confidence !== undefined ? `${f.confidence}%` : '—'
      channel.appendLine(`### ${f.title}`)
      channel.appendLine(
        `Agent: ${f.agent}  |  ${f.file}:${f.line}  |  Confidence: ${confidence}  |  Basis: ${f.basis}`
      )
      channel.appendLine('')
      channel.appendLine(f.detail)
      channel.appendLine('')
      channel.appendLine(`**Suggestion:** ${f.suggestion}`)
      channel.appendLine('─'.repeat(60))
      channel.appendLine('')
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add vscode-extension/src/output.ts
git commit -m "feat(vscode): output.ts — format ReviewResult into OutputChannel"
```

---

## Task 7: `extension.ts`

**Files:**

- Create: `vscode-extension/src/extension.ts`

This is wiring code — it owns the DiagnosticCollection and OutputChannel lifecycles, registers the command, orchestrates the other modules, and maps error types to user-friendly notifications.

- [ ] **Step 1: Create `vscode-extension/src/extension.ts`**

```typescript
import * as vscode from 'vscode'
import { getConfig } from './config'
import { runReview } from './runner'
import { applyDiagnostics } from './diagnostics'
import { renderReport } from './output'

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('ai-review')
  const channel = vscode.window.createOutputChannel('AI Review')

  context.subscriptions.push(collection)
  context.subscriptions.push(channel)

  const command = vscode.commands.registerCommand('aiReview.reviewStagedChanges', async () => {
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceDir) {
      vscode.window.showErrorMessage('AI Review: No workspace folder open.')
      return
    }

    const config = getConfig(context.extensionPath)

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AI Review running…',
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const result = await runReview(config, workspaceDir, token)

          // Diagnostics cleared and replaced atomically after the run completes
          applyDiagnostics(collection, result.findings, workspaceDir)
          renderReport(channel, result)

          // Show the report but keep editor focus (preserveFocus = true)
          channel.show(true)

          const count = result.summary.totalFindings
          const plural = count === 1 ? 'finding' : 'findings'
          const summary = `AI Review complete — ${count} ${plural}`
          const choice = await vscode.window.showInformationMessage(summary, 'View Report')
          if (choice === 'View Report') {
            channel.show(false)
          }
        } catch (err) {
          handleRunError(err as Error, config.ollamaUrl, channel)
        }
      }
    )
  })

  context.subscriptions.push(command)
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically; nothing to clean up here
}

function handleRunError(err: Error, ollamaUrl: string, channel: vscode.OutputChannel): void {
  const msg = err.message

  if (msg === 'cancelled') {
    return // user clicked Cancel — no notification needed
  }

  if (msg === 'nothing-staged') {
    vscode.window.showErrorMessage(
      'AI Review: No staged changes found. Stage your changes with `git add` and try again.'
    )
    return
  }

  if (msg.startsWith('git not found')) {
    vscode.window.showErrorMessage(
      'AI Review: git not found. Ensure git is installed and in your PATH.'
    )
    return
  }

  if (msg.startsWith('ollama-unreachable:')) {
    const url = msg.slice('ollama-unreachable:'.length)
    vscode.window
      .showErrorMessage(
        `AI Review: Ollama is not running at ${url}. Start it with \`ollama serve\`.`,
        'Open Settings'
      )
      .then((choice) => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'aiReview.ollamaUrl')
        }
      })
    return
  }

  if (msg.startsWith('parse-error:')) {
    channel.appendLine('\n--- Raw CLI output (parse failed) ---')
    channel.appendLine(msg.slice('parse-error:'.length))
    channel.show(true)
    vscode.window.showErrorMessage(
      'AI Review: Unexpected output from the CLI. See the "AI Review" output panel for details.'
    )
    return
  }

  // cli-error or anything else
  channel.appendLine(`\n--- Error ---\n${msg}`)
  channel.show(true)
  vscode.window.showErrorMessage('AI Review failed. See the "AI Review" output panel for details.')
}
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
cd vscode-extension
npx vitest run
```

Expected: all tests pass (config + runner + diagnostics).

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/extension.ts
git commit -m "feat(vscode): extension.ts — activate, register command, wire modules"
```

---

## Task 8: Bundling Verification

**Files:** None created — this is a verification task.

- [ ] **Step 1: Run typecheck**

```bash
cd vscode-extension
npx tsc --noEmit
```

Expected: 0 errors. If you see errors about `vscode` types, ensure `@types/vscode` is installed and `tsconfig.json` has `"skipLibCheck": true`.

- [ ] **Step 2: Compile with esbuild**

```bash
cd vscode-extension
npm run compile
```

Expected: `dist/extension.js` created. No errors. Output is ~50 KB.

Verify:

```bash
ls -lh dist/extension.js
```

- [ ] **Step 3: Package as .vsix**

```bash
cd vscode-extension
npm run package
```

Expected: `ai-review-agent-0.5.0.vsix` created.

- [ ] **Step 4: Verify .vsix contents**

```bash
cd vscode-extension
npx vsce ls
```

Expected output must include:

- `dist/extension.js`
- `node_modules/ai-review-agent/dist/cli/index.js`
- `node_modules/ai-review-agent/dist/core/...` (runner, agents, etc.)
- `README.md`

Must NOT include:

- `src/`
- `tests/`
- `node_modules/ai-review-agent/src/`
- `node_modules/ai-review-agent/tests/`
- `node_modules/ai-review-agent/calibration/`

If unwanted paths appear, add them to `.vscodeignore` and re-run `npm run package`.

- [ ] **Step 5: Check bundle size**

```bash
ls -lh vscode-extension/ai-review-agent-0.5.0.vsix
```

Expected: between 3 MB and 8 MB. If over 10 MB, expand `.vscodeignore` to exclude large non-essential directories.

- [ ] **Step 6: Commit .vsix to .gitignore**

The `.vsix` file should not be committed. Add it to the root `.gitignore` if not already there:

```bash
cd ..  # back to repo root
grep -q "*.vsix" .gitignore || echo "*.vsix" >> .gitignore
git add .gitignore
git commit -m "chore: ignore .vsix build artifacts"
```

---

## Task 9: Extension README + Memory Bank Update

**Files:**

- Create: `vscode-extension/README.md`
- Modify: `memory-bank/progress.md`
- Modify: `memory-bank/activeContext.md`

- [ ] **Step 1: Create `vscode-extension/README.md`**

````markdown
# AI Review Agent — VS Code / Cursor Extension

Run an 11-agent local AI code review swarm on your staged git changes, directly from the command palette. Findings appear as inline editor squiggles (Problems panel) and a full markdown report in the Output panel.

**Requires [Ollama](https://ollama.ai) running locally.** No API keys, no cloud, no cost.

---

## Install

### From .vsix (manual install)

1. Download `ai-review-agent-0.5.0.vsix` from the [GitHub Releases](https://github.com/unyieldingclaw-dev/ai-code-review-agent/releases) page.
2. In Cursor or VS Code: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Extensions: Install from VSIX…** → select the downloaded file.

### Prerequisites

1. [Install Ollama](https://ollama.ai)
2. Pull the default model:
   ```bash
   ollama serve          # start Ollama (keep this running)
   ollama pull devstral:latest
   ```
````

---

## Usage

1. Stage the changes you want reviewed:
   ```bash
   git add -p            # or: git add <files>
   ```
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run: **AI Review: Review Staged Changes**
4. Wait 30–120 s for the swarm to finish
5. Findings appear as squiggles in your editor and in the **Problems** panel
6. The full report opens in the **AI Review** output channel

---

## Configuration

All settings are under **Preferences → Settings → AI Review**:

| Setting              | Default                  | Description                    |
| -------------------- | ------------------------ | ------------------------------ |
| `aiReview.ollamaUrl` | `http://localhost:11434` | Ollama base URL                |
| `aiReview.model`     | `devstral:latest`        | Model name                     |
| `aiReview.agents`    | `[]` (all 11)            | Subset of agents to run        |
| `aiReview.maxLines`  | `2000`                   | Max diff lines sent for review |
| `aiReview.timeout`   | `120`                    | Per-agent timeout (seconds)    |

**Available agents:** `security`, `performance`, `correctness`, `design`, `dependencies`, `coverage`, `testgen`, `adversarial`, `integration`, `breaking-change`, `license`

To run only security and performance checks:

```json
"aiReview.agents": ["security", "performance"]
```

---

## Troubleshooting

| Error                           | Fix                                                 |
| ------------------------------- | --------------------------------------------------- |
| "Ollama is not running"         | Run `ollama serve` in a terminal, keep it open      |
| "No staged changes found"       | Run `git add <files>` before invoking the extension |
| "git not found"                 | Ensure `git` is on your PATH                        |
| Findings don't appear after run | Check the "AI Review" output panel for details      |

---

## Agents

| Agent           | What it checks                             |
| --------------- | ------------------------------------------ |
| Security        | Injection, auth, secrets, input validation |
| Performance     | N+1 queries, blocking I/O, O(n²) loops     |
| Correctness     | Off-by-one, null dereference, edge cases   |
| Design          | SOLID violations, coupling, naming         |
| Dependencies    | Outdated packages, CVEs, license conflicts |
| Coverage        | Untested paths, missing assertions         |
| TestGen         | Generates test stubs for new code          |
| Adversarial     | Prompt injection, misuse scenarios         |
| Integration     | Contract mismatches, API breakage          |
| Breaking Change | Removed exports, signature changes         |
| License         | GPL/AGPL/SSPL incompatible dependencies    |

```

- [ ] **Step 2: Update `memory-bank/progress.md`**

Mark V5-1 through V5-7 as complete and update the version history. Find the `## 🔜 Planned: v0.5.0` section and change each `- [ ]` to `- [x]`, then add the v0.5.0 entry to the version history table:

```

| 0.5.0 | 2026-06-11 | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7) |

````

- [ ] **Step 3: Update `memory-bank/activeContext.md`**

Update **Current Focus** to reflect v0.5.0 as complete and note the next focus (marketplace publish or v0.6.0 planning).

- [ ] **Step 4: Commit everything**

```bash
git add vscode-extension/README.md memory-bank/progress.md memory-bank/activeContext.md
git commit -m "feat(vscode): README + memory bank update for v0.5.0 complete"
````

---

## Smoke Test Checklist (Manual — Run in Cursor)

After Task 8 packaging, install the `.vsix` in Cursor and run through these:

- [ ] **Smoke 1 — Nothing staged**: Ensure nothing is staged (`git reset HEAD .`). Run command → error notification: _"No staged changes found."_

- [ ] **Smoke 2 — Ollama off**: Stop Ollama. Stage a file. Run command → error notification: _"Ollama is not running at http://localhost:11434"_ with **Open Settings** button. Clicking it opens VS Code settings at `aiReview.ollamaUrl`.

- [ ] **Smoke 3 — Happy path**: Start Ollama. Stage a real change. Run command → progress notification appears with Cancel button → squiggles appear in the editor → "AI Review" output panel opens with full report → summary notification shows finding count.

- [ ] **Smoke 4 — Click-to-navigate**: Click a diagnostic in the Problems panel → editor navigates to the correct file and line.

- [ ] **Smoke 5 — Re-run replaces old results**: Stage additional changes. Run again → previous diagnostics are cleared, new ones appear.

- [ ] **Smoke 6 — Cancel**: Start a run, immediately click Cancel → process killed, progress dismissed, no change to diagnostics from the previous run.

---

## Self-Review Checklist

### Spec coverage

| Spec requirement                                                       | Covered by                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Subprocess architecture — shell out to `node <cli-path> --format json` | Task 4: `runner.ts`                                                             |
| Bundled install — `ai-review-agent` in `node_modules` inside `.vsix`   | Task 1 (`package.json` deps), Task 8 (`.vscodeignore`)                          |
| Command palette trigger `aiReview.reviewStagedChanges`                 | Task 1 (`contributes.commands`), Task 7                                         |
| Staged changes via `git diff --cached`                                 | Task 4 `getStagedDiff()`                                                        |
| Nothing-staged error                                                   | Task 4 `getStagedDiff()` throws `'nothing-staged'`, Task 7 maps to notification |
| Ollama-unreachable error                                               | Task 4 detects `ECONNREFUSED`, Task 7 maps with Open Settings button            |
| git-not-found error                                                    | Task 4 detects `ENOENT`, Task 7 maps to notification                            |
| DiagnosticCollection + squiggles                                       | Task 5 `diagnostics.ts`                                                         |
| OutputChannel markdown report                                          | Task 6 `output.ts`                                                              |
| Progress notification with Cancel                                      | Task 7 `withProgress(cancellable: true)`                                        |
| Severity mapping (critical/high→Error, medium→Warning, low→Info)       | Task 5 `SEVERITY_MAP`                                                           |
| 1-based → 0-based line conversion                                      | Task 5 `finding.line - 1`                                                       |
| `aiReview.ollamaUrl` setting + `--ollama-url` CLI flag                 | Task 0 (CLI), Task 3 (config)                                                   |
| `aiReview.timeout` in seconds, CLI takes ms                            | Task 3 `buildCliArgs` multiplies by 1000                                        |
| `--fail-on never` so extension handles exit code                       | Task 3 `buildCliArgs` hardcodes `--fail-on never`                               |
| esbuild bundle, `external: ['vscode']`                                 | Task 1 `esbuild.config.js`                                                      |
| `.vscodeignore` excludes source, keeps dist                            | Task 1 `.vscodeignore`                                                          |
| `extensionKind: ["workspace"]`                                         | Task 1 `package.json`                                                           |
| Unit tests: runner, diagnostics, config                                | Tasks 3, 4, 5                                                                   |

### Type consistency

| Name defined                                                            | Used in                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ExtensionConfig` (types.ts)                                            | config.ts (return), runner.ts (param), extension.ts (param) |
| `ReviewResult` (types.ts)                                               | runner.ts (return), output.ts (param), extension.ts (local) |
| `Finding` (types.ts)                                                    | diagnostics.ts (param), output.ts (indexed)                 |
| `buildCliArgs(config, workspaceDir, diffFile)` (config.ts)              | runner.ts calls it                                          |
| `applyDiagnostics(collection, findings, workspaceDir)` (diagnostics.ts) | extension.ts calls it                                       |
| `renderReport(channel, result)` (output.ts)                             | extension.ts calls it                                       |
| `runReview(config, workspaceDir, token)` (runner.ts)                    | extension.ts calls it                                       |

All consistent. ✅
