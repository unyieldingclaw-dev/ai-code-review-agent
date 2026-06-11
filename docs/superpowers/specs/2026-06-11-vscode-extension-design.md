# v0.5.0 — Cursor/VS Code Extension Design

**Date**: 2026-06-11
**Status**: Approved
**Author**: UnyieldingClaw

---

## Summary

A Cursor/VS Code extension that runs the existing `ai-review-agent` swarm on staged git changes, then surfaces findings as inline diagnostics (editor squiggles + Problems panel) and a full markdown report in an Output Channel. User-initiated via the command palette. No monorepo restructuring — the extension shells out to the bundled CLI.

---

## 1. Architecture

### Repo Structure

```
vscode-extension/           # new subfolder in existing repo
├── package.json            # extension manifest + dependencies
├── tsconfig.json           # target: ES2020, module: commonjs
├── esbuild.config.js       # bundle extension source → dist/extension.js
├── .vscodeignore           # exclusions for .vsix packaging
├── src/
│   ├── extension.ts        # activation entry point, command registration
│   ├── runner.ts           # subprocess spawn + stdout parse
│   ├── diagnostics.ts      # Finding[] → DiagnosticCollection
│   ├── output.ts           # Finding[] → OutputChannel markdown
│   └── config.ts           # read VS Code settings, assemble CLI args
└── tests/
    ├── runner.test.ts
    ├── diagnostics.test.ts
    └── config.test.ts
```

### Components

| File | Responsibility |
|------|----------------|
| `extension.ts` | Activate extension, register command, own DiagnosticCollection + OutputChannel lifecycle |
| `runner.ts` | Spawn `node <cli-path> --format json`, collect stdout, parse `Finding[]`, kill on cancel |
| `diagnostics.ts` | Map `Finding` severity to `vscode.DiagnosticSeverity`, push to collection |
| `output.ts` | Format `Finding[]` as markdown, write to OutputChannel |
| `config.ts` | Read `aiReview.*` settings, resolve bundled CLI path, build CLI arg array |

### VS Code Settings

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `aiReview.ollamaUrl` | string | `http://localhost:11434` | Ollama base URL |
| `aiReview.model` | string | `devstral:latest` | Model name passed to CLI |
| `aiReview.agents` | string[] | `[]` (all agents) | Subset of agents to run |
| `aiReview.maxLines` | number | `2000` | Max diff lines (`--max-lines`) |
| `aiReview.timeout` | number | `120` | Per-agent timeout seconds (`--timeout`) |

### Command

`aiReview.reviewStagedChanges` — registered in `package.json` `contributes.commands`, invoked from the command palette as **"AI Review: Review Staged Changes"**.

---

## 2. Data Flow

```
User: "AI Review: Review Staged Changes"
  │
  ├─ config.ts: read settings, resolve CLI path
  ├─ runner.ts: spawn `node <cli-path> --format json --ollama-url <url> ...`
  │   ├─ check git diff --cached → exit with error if nothing staged
  │   └─ progress notification: "AI Review running… (Cancel)"
  │
  ├─ stdout: JSON Finding[] (single write at end of run)
  │
  ├─ diagnostics.ts: clear collection, push new diagnostics
  ├─ output.ts: clear channel, write markdown report, reveal channel
  └─ summary notification: "AI Review complete — N findings" + [View Report] button
```

**Key constraints:**
- CLI invoked as `node <absolute-path-to-cli>` — not a shell command — to avoid Windows PATH resolution issues.
- DiagnosticCollection is cleared **immediately before** pushing new findings (after the CLI returns), so old findings remain visible while the review is running and are replaced atomically when results arrive.
- Cancellation kills the child process via `childProcess.kill()`; no diagnostics change on cancel.
- Progress notification includes a **Cancel** button; clicking it resolves the cancellation token.

---

## 3. Bundling & Packaging

### Extension source bundling

esbuild compiles `src/extension.ts` → `dist/extension.js` (CommonJS, external: `vscode`).

```js
// esbuild.config.js
require('esbuild').build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
});
```

### CLI bundling inside `.vsix`

`ai-review-agent` is listed as a regular `dependency` in `vscode-extension/package.json`. The `.vsix` file includes `node_modules/ai-review-agent/dist/` because `@vscode/vsce` packages production dependencies by default.

```json
// vscode-extension/package.json (key fields)
{
  "publisher": "unyieldingclaw",
  "name": "ai-review-agent",
  "version": "0.5.0",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/extension.js",
  "dependencies": {
    "ai-review-agent": "^0.4.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.x",
    "esbuild": "^0.x",
    "typescript": "^5.x"
  }
}
```

### `.vscodeignore` — exclusions from `.vsix`

```
.vscode/**
node_modules/ai-review-agent/src/**
node_modules/ai-review-agent/tests/**
node_modules/ai-review-agent/calibration/**
node_modules/ai-review-agent/memory-bank/**
node_modules/ai-review-agent/.github/**
src/**
tests/**
*.map
esbuild.config.js
tsconfig.json
```

`node_modules/ai-review-agent/dist/` is **not** excluded — it's what the subprocess runs.

### Scripts

```json
{
  "scripts": {
    "compile": "node esbuild.config.js",
    "package": "vsce package",
    "publish": "vsce publish"
  }
}
```

### Estimated bundle size

- Extension source (`dist/extension.js`): ~50 KB
- `ai-review-agent/dist/`: ~2–3 MB
- Total `.vsix`: ~3–5 MB

---

## 4. Error Handling

All errors surface as VS Code notification messages. The Output Channel shows detailed context where relevant.

| Condition | User sees |
|-----------|-----------|
| Nothing staged (`git diff --cached` is empty) | Error notification: *"No staged changes found. Run `git add` first."* |
| Ollama not running / wrong URL | Error notification: *"Ollama is not running at \<url\>. Start it with `ollama serve`."* + **Open Settings** button |
| `git` not in PATH | Error notification: *"git not found. Ensure git is installed and in your PATH."* |
| Diff exceeds `maxLines` | CLI exits with descriptive message; extension shows it in OutputChannel + warning notification |
| Agent timeout (partial results) | CLI exits 0 with partial `Finding[]`; extension renders what it has; OutputChannel shows timeout lines from CLI stderr |
| JSON parse failure (malformed stdout) | OutputChannel shows raw CLI stderr; error notification: *"AI Review returned unexpected output. See Output panel for details."* |
| User cancels | Child process killed, progress dismissed, no diagnostics change |

**Severity mapping** (Finding → DiagnosticSeverity):

| Finding severity | VS Code severity |
|-----------------|-----------------|
| `critical` | `Error` |
| `high` | `Error` |
| `medium` | `Warning` |
| `low` | `Information` |

---

## 5. Testing

### Unit tests (no Ollama required)

Three test files, mocking the subprocess layer:

| File | What it covers |
|------|----------------|
| `tests/runner.test.ts` | Spawn mock, stdout parse, stderr Ollama-error detection, empty-staged-changes guard, cancel (kill called) |
| `tests/diagnostics.test.ts` | Severity mapping, line/col offset (Finding is 1-based → Diagnostic is 0-based), collection clear on re-run |
| `tests/config.test.ts` | Settings read, defaults applied when unset, CLI arg array assembly |

### Manual smoke test checklist (in Cursor)

1. Nothing staged → error notification "No staged changes found"
2. Ollama off → error notification with `ollama serve` hint and Open Settings button
3. Staged changes + Ollama running → squiggles appear, OutputChannel opens with full report
4. Click diagnostic in Problems panel → navigates to correct file and line
5. Run again → previous diagnostics cleared, new ones appear
6. Cancel mid-run → process killed, progress dismissed, no stale diagnostics

---

## 6. Rejected Alternatives

| Option | Why rejected |
|--------|-------------|
| Monorepo with pnpm workspaces | Too much restructuring risk for a first extension release; subprocess avoids touching existing codebase |
| Shared workspace dep (Option 3) | Half the monorepo complexity with fewer benefits |
| Webview output panel | OutputChannel gives 90% of the value at 10% the complexity |
| Quick-pick diff source selection | Adds decision fatigue for the common case; explicit second command can be added later if needed |
| Global `ai-review-agent` install | Requires user setup step; bundled install is zero-friction |

---

## 7. Out of Scope for v0.5.0

- Automatic review on save or commit hook
- Webview with interactive finding panel
- Multi-root workspace support
- Inline code actions ("Fix this finding")
- Settings UI beyond standard VS Code settings editor
- Anthropic/Claude provider (tracked separately)
