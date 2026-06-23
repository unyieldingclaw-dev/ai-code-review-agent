# MCP Server Design — v0.6.0

**Goal:** Expose the 11-agent Ollama swarm as an MCP tool so Cursor's chat panel can invoke a full code review without leaving the editor.

**Architecture:** A new `ai-review-mcp` binary is added to the existing `ai-review-agent` package. It runs an MCP server over stdio, registering one tool (`review_diff`). The tool gets the current git diff, runs the `SwarmRunner`, and returns a markdown summary formatted for inline chat consumption. No new npm package; one install gives users both the CLI and the MCP server.

**Provider:** Ollama only. Anthropic provider is explicitly backlogged.

**Target editors:** Cursor (primary). Any MCP-compatible client that can run a local stdio server.

**Platforms:** Windows and macOS.

---

## Design Decisions

### Transport: stdio

Cursor's local MCP integration expects a stdio server. The client spawns the server as a child process and communicates over stdin/stdout. HTTP transport is for remote/hosted servers — not needed here.

Consequence: all progress output and warnings must go to `process.stderr`. `process.stdout` is reserved for the MCP protocol.

### Package structure: new binary in existing package

`ai-review-agent` gains a second bin entry: `ai-review-mcp`. Users run `npm install -g ai-review-agent` once and get both tools. No separate package to publish or version.

### Agents: 10 analysis agents (no testgen)

The testgen agent writes generated test files to disk — surprising and hard to undo in a chat context. The MCP tool runs 10 agents: security, performance, correctness, design, dependencies, adversarial, integration, breaking-change, license, and coverage. Coverage findings (untested functions, missing branches) surface as regular findings in chat. Users who want generated test files use the CLI (`ai-review-agent`).

### Diff source: hybrid

1. Run `git diff --cached` (staged changes) from `repo_path`
2. If empty, fall back to `git diff HEAD` (last commit vs working tree)
3. If `repo_path` is provided as a tool parameter, use it; otherwise use `process.cwd()`

This handles both the common case (staged changes for review) and the multi-root workspace case where CWD may not be the repo root.

### Output format: A+C hybrid

Critical and high findings get full detail. Medium and low get a count summary at the bottom. Keeps the chat response focused on what needs action while not hiding that lower-severity issues exist.

---

## New Files

```
src/mcp/
  server.ts       — MCP Server entry point; registers review_diff tool; stdio transport
  tool.ts         — Tool handler: get diff, load config, run SwarmRunner, return formatted output
  formatter.ts    — A+C hybrid markdown renderer
```

The rest of `src/` is unchanged. The MCP layer calls into existing `SwarmRunner`, `loadConfig`, `OllamaProvider` exactly as the CLI does.

---

## Tool Definition

**Name:** `review_diff`

**Description:** Run the AI code review swarm on the current git diff. Runs 10 specialist agents (security, performance, correctness, design, dependencies, adversarial, integration, breaking-change, license, coverage) powered by Ollama locally. Returns a markdown summary with full detail for critical/high findings and a count for medium/low.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repo_path` | string | No | Absolute path to the repository root. Defaults to the server's working directory (Cursor sets this to the workspace root). |

**Returns:** A markdown string.

---

## Output Format

```markdown
## AI Code Review — 3 findings

### 🔴 CRITICAL · security · `src/auth/token.ts:47`

**Hardcoded JWT secret**
The secret is embedded as a string literal. An attacker with read access to the repo can forge tokens.
_Suggestion: Load from `process.env.JWT_SECRET`; throw on startup if missing._

### 🔴 CRITICAL · correctness · `src/db/query.ts:23`

**Unsanitized user input in SQL**
String interpolation in query builder bypasses parameterization — SQL injection vector.
_Suggestion: Use parameterized queries or the ORM's query builder._

### 🟠 HIGH · performance · `src/api/handler.ts:89`

**N+1 query inside loop**
Each iteration issues a separate DB query. Degrades linearly with dataset size.
_Suggestion: Batch with findMany + IN clause before the loop._

---

_4 medium · 2 low — run `ai-review-agent` in your terminal to see all findings_
```

**No critical/high findings:**

```markdown
## AI Code Review — ✅ No critical or high findings

_3 medium · 1 low — run `ai-review-agent` in your terminal to see all findings_
```

**Empty diff:**

```markdown
## AI Code Review

No staged changes found. Stage some changes with `git add` and try again.
```

**Severity icons:** 🔴 critical, 🟠 high

---

## Package Changes

### `package.json`

```json
{
  "bin": {
    "ai-review-agent": "./dist/cli/index.js",
    "ai-review-mcp": "./dist/mcp/server.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

`@modelcontextprotocol/sdk` moves from devDependency to dependency — the MCP server ships in `dist/` and needs it at runtime.

### `tsconfig.json`

No changes needed — the existing config compiles all files under `src/`.

---

## Cursor Configuration

### Project-level (`.cursor/mcp.json`)

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

### Global (~/.cursor/mcp.json)

Same format — applies to all workspaces. Useful when `ai-review-agent` is installed globally.

### Verification

After adding the config, Cursor shows the tool in **Settings → MCP**. The user can click "Test" to confirm it responds. In chat, typing `review my staged changes` or `@ai-review review_diff` invokes the tool.

---

## Error Cases

| Condition                  | Tool response                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Ollama not running         | Returns error message: "Ollama is not reachable at `{url}`. Start Ollama and try again." |
| No git repo at `repo_path` | Returns error message: "Not a git repository: `{path}`."                                 |
| Empty diff                 | Returns the "no staged changes" message above                                            |
| Agent timeout              | Timed-out agent is skipped; remaining findings are returned with a note                  |

All errors are returned as text content (not thrown), so Cursor displays them in chat rather than showing a generic tool failure.

---

## Testing

- Unit tests for `formatter.ts` — verify A+C hybrid output for all combinations (some critical/high, none, empty)
- Unit test for diff acquisition logic — mock `execSync`, verify staged-then-fallback behavior
- Unit test for error messages — Ollama unreachable, not a git repo, empty diff
- No integration tests for the MCP transport layer itself (the SDK handles that)

Existing tests for `SwarmRunner` and agents are unchanged.

---

## Out of Scope

- Testgen agent (CLI only — file writes don't belong in a chat tool; coverage findings still appear)
- Coverage gaps as generated test files (testgen is skipped; gaps surface as findings only)
- Anthropic provider (backlogged)
- HTTP transport (local-only tool, stdio is sufficient)
- VS Code extension integration (separate surface, separate task)
- Auto-adding `.cursor/mcp.json` during install (manual config is fine for now)
