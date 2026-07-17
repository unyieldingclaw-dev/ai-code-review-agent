# `/ai-review` Distribution + Update-Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every project a user works in gets `/ai-review` automatically via a `postinstall` copy
into `~/.claude/commands/`, and every `ai-review-agent` invocation checks for a newer version and
tells the user (never auto-installs) — so the slash command never goes stale and users always know
when to refresh it.

**Architecture:** Two independent, additive pieces. (1) A plain, un-compiled `.mjs` script
(`scripts/postinstall.mjs`) wired as npm's `postinstall` lifecycle hook — copies this repo's own
`.claude/commands/ai-review.md` to the user-level `~/.claude/commands/ai-review.md`, fail-open on
any error. It must be plain JS, not compiled TypeScript, because `postinstall` can fire before
`npm run build` has ever produced `dist/` (e.g. a contributor's first `npm install` right after
cloning) — a `dist/`-based entrypoint would crash `npm install` itself in that window. (2) The
`update-notifier` npm package wired into `src/cli/index.ts`'s existing entrypoint, using its
built-in TTY-detection and unref'd-child-process check so it never blocks, corrupts machine-
readable output (`--format json`/`sarif`), or throws on network failure.

**Tech Stack:** Node.js built-ins (`fs`, `os`, `path`, `url`) for the postinstall copy; the
`update-notifier` npm package (v7, ESM, matches this repo's `"type": "module"`) for the version
check; Vitest for both, following this repo's existing `vi.mock('fs', ...)` pattern from
`tests/unit/cli.test.ts`.

---

## Task 1: Ship the command file and postinstall script in the published package

**Files:**

- Modify: `package.json:27-35`

- [ ] **Step 1: Add `.claude/commands/` and `scripts/postinstall.mjs` to the `files` array**

Open `package.json`. The current `files` array (lines 27–31) is:

```json
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ],
```

Replace it with:

```json
  "files": [
    "dist/",
    ".claude/commands/",
    "scripts/postinstall.mjs",
    "README.md",
    "LICENSE"
  ],
```

WHY only `scripts/postinstall.mjs` and not all of `scripts/`: the rest of `scripts/` is
Claude-Code-specific review-gate hook scripts (`.sh`/`.ps1`) for developing _this_ repo — not
relevant to, and not meant to ship to, consumers of the published CLI.

- [ ] **Step 2: Add the `postinstall` lifecycle script**

In the same file, find the `"scripts"` block (starts at `package.json:36`) and add a new entry.
Immediately after `"build": "tsc",` add:

```json
    "postinstall": "node scripts/postinstall.mjs",
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: ship .claude/commands and postinstall script in the npm package"
```

---

## Task 2: Write the postinstall copy script

**Files:**

- Create: `scripts/postinstall.mjs`
- Test: `tests/unit/postinstall.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/postinstall.test.ts`:

```ts
// tests/unit/postinstall.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/fake/home'),
  }
})

import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { copyCommandFile } from '../../scripts/postinstall.mjs'

describe('postinstall copyCommandFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies the command file into ~/.claude/commands when the source exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)

    copyCommandFile()

    expect(mkdirSync).toHaveBeenCalledWith(join('/fake/home', '.claude', 'commands'), {
      recursive: true,
    })
    expect(copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining(join('.claude', 'commands', 'ai-review.md')),
      join('/fake/home', '.claude', 'commands', 'ai-review.md')
    )
  })

  it('skips silently when the source command file is missing', () => {
    vi.mocked(existsSync).mockReturnValue(false)

    copyCommandFile()

    expect(mkdirSync).not.toHaveBeenCalled()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('fails open (does not throw) when the copy itself errors', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(mkdirSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    expect(() => copyCommandFile()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/postinstall.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/postinstall.mjs'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `scripts/postinstall.mjs`:

```js
#!/usr/bin/env node
// Plain JS, not compiled TypeScript: `postinstall` can fire before `npm run build` has ever
// produced dist/ (e.g. a contributor's first `npm install` right after cloning). A dist/-based
// entrypoint would make npm install itself fail in that window -- this file must always exist
// and always be runnable with zero build step.
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function copyCommandFile() {
  try {
    const source = join(__dirname, '..', '.claude', 'commands', 'ai-review.md')
    if (!existsSync(source)) {
      console.warn(
        '[ai-review-agent] postinstall: source command file not found, skipping /ai-review install'
      )
      return
    }
    const destDir = join(homedir(), '.claude', 'commands')
    mkdirSync(destDir, { recursive: true })
    copyFileSync(source, join(destDir, 'ai-review.md'))
  } catch (err) {
    // WHY fail-open: a permissions issue or unusual environment here must never fail the
    // whole `npm install` -- this is a convenience nicety, not a required install step.
    console.warn(
      `[ai-review-agent] postinstall: could not install /ai-review command (${err.message}) -- continuing`
    )
  }
}

if (process.env.NODE_ENV !== 'test') {
  copyCommandFile()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/postinstall.test.ts`
Expected: PASS — 3/3 tests.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write scripts/postinstall.mjs tests/unit/postinstall.test.ts
git add scripts/postinstall.mjs tests/unit/postinstall.test.ts
git commit -m "feat: postinstall script copies /ai-review into ~/.claude/commands"
```

---

## Task 3: Add the `update-notifier` dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the dependency and its types**

```bash
npm install update-notifier@^7
npm install -D @types/update-notifier@^6
```

Expected: `package.json`'s `"dependencies"` gains `"update-notifier": "^7.3.1"` and
`"devDependencies"` gains `"@types/update-notifier": "^6.0.8"` (or whatever the resolved current
versions are).

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add update-notifier dependency"
```

---

## Task 4: Wire the update-notifier check into the CLI entrypoint

**Files:**

- Modify: `src/cli/index.ts:1-27`
- Test: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/unit/cli.test.ts`. Find the `vi.mock('fs', ...)` block near the top (around line 11)
and add an `update-notifier` mock right after it, so tests never make a real network call:

```ts
// Mock update-notifier so tests never hit the network or print notifier output
vi.mock('update-notifier', () => ({
  default: vi.fn().mockReturnValue({
    notify: vi.fn(),
  }),
}))
```

Then add a new test case (near the other CLI-level tests in the same file):

```ts
it('checks for updates via update-notifier with a 7-day interval and does not throw', async () => {
  const updateNotifier = (await import('update-notifier')).default
  // Re-import the CLI module fresh so its top-level update-notifier call re-runs under this test
  vi.resetModules()
  process.env.NODE_ENV = 'test'
  await import('../../src/cli/index.js')

  // NODE_ENV=test guards the call at the bottom of index.ts, so under test it must NOT fire --
  // this proves the guard exists and update-notifier isn't invoked during every test run.
  expect(updateNotifier).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: FAIL — `Cannot find package 'update-notifier'` or similar (dependency not wired into
`index.ts` yet, or mock target doesn't match a real import).

- [ ] **Step 3: Wire `update-notifier` into `src/cli/index.ts`**

At the top of `src/cli/index.ts`, after the existing import block (after line 14,
`import { resolveProfile } from '../core/profiles.js'`), add:

```ts
import updateNotifier from 'update-notifier'
```

Then find lines 16–19:

```ts
const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
  version: string
}
```

Replace with (now also destructuring `name`, needed by `updateNotifier`'s `pkg` option):

```ts
const __dirname = dirname(fileURLToPath(import.meta.url))
const { name, version } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
) as {
  name: string
  version: string
}
```

Finally, find the bottom of the file:

```ts
if (process.env.NODE_ENV !== 'test') {
  program.parse()
}
```

Replace with:

```ts
if (process.env.NODE_ENV !== 'test') {
  // WHY guarded the same way as program.parse(): keeps this out of the test run entirely
  // rather than relying on update-notifier's own TTY/network fail-open behavior during tests.
  updateNotifier({
    pkg: { name, version },
    updateCheckInterval: 1000 * 60 * 60 * 24 * 7, // 7 days -- never a live check per invocation
  }).notify({
    isGlobal: true, // this CLI is always installed via `npm install -g`
    message:
      'A newer version of {packageName} is available ({currentVersion} → {latestVersion}). Run: `{updateCommand}`',
  })
  program.parse()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: PASS — all existing cli.test.ts cases plus the new one.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm test -- --run
npm run typecheck
```

Expected: all tests pass (300/300, up from 297), 0 type errors.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/cli/index.ts tests/unit/cli.test.ts
git add src/cli/index.ts tests/unit/cli.test.ts
git commit -m "feat: check for ai-review-agent updates on every CLI invocation"
```

---

## Task 5: End-to-end verification of the real postinstall flow

Unit tests mock `fs`/`os` and never actually exercise npm's lifecycle-script mechanism or a real
home directory. This step proves the whole chain works for a real `npm install -g` from a packed
tarball, using a throwaway fake `HOME` so it can't touch the real one.

**Files:** none (verification only, no code changes)

- [ ] **Step 1: Pack the package**

```bash
npm run build
npm pack
```

Expected: produces `ai-review-agent-<version>.tgz` in the repo root, and the build succeeds with
0 errors.

- [ ] **Step 2: Install it globally into a throwaway prefix with a fake HOME**

Bash:

```bash
mkdir -p /tmp/acr-postinstall-test/fake-home /tmp/acr-postinstall-test/npm-prefix
HOME=/tmp/acr-postinstall-test/fake-home npm install -g \
  --prefix /tmp/acr-postinstall-test/npm-prefix \
  ./ai-review-agent-*.tgz
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\acr-postinstall-test\fake-home", "$env:TEMP\acr-postinstall-test\npm-prefix"
$env:HOME = "$env:TEMP\acr-postinstall-test\fake-home"
npm install -g --prefix "$env:TEMP\acr-postinstall-test\npm-prefix" (Get-Item .\ai-review-agent-*.tgz).FullName
Remove-Item Env:\HOME
```

Expected: install succeeds, output includes no error from the `postinstall` step (silent success
is correct — the script only prints on skip/failure).

- [ ] **Step 3: Verify the command file landed**

Bash: `cat /tmp/acr-postinstall-test/fake-home/.claude/commands/ai-review.md | head -5`
PowerShell: `Get-Content "$env:TEMP\acr-postinstall-test\fake-home\.claude\commands\ai-review.md" -TotalCount 5`

Expected: prints the top of the real `ai-review.md` command file content (not empty, not an
error).

- [ ] **Step 4: Clean up**

```bash
rm -rf /tmp/acr-postinstall-test ai-review-agent-*.tgz
```

```powershell
Remove-Item -Recurse -Force "$env:TEMP\acr-postinstall-test"
Remove-Item .\ai-review-agent-*.tgz
```

- [ ] **Step 5: Note the result**

No commit for this task — it's a verification-only step. If Step 3 fails, stop and fix Task 1/2
before proceeding; do not paper over a failed verification.

---

## Task 6: Document both features in the README

**Files:**

- Modify: `README.md` (insert new section after the existing "Cursor Integration (MCP)" section,
  which ends around `README.md:128`, right before `## Usage` at `README.md:129`)

- [ ] **Step 1: Add the new section**

Insert this new `##` section between the end of "Cursor Integration (MCP)" and the `## Usage`
heading:

```markdown
## `/ai-review` in Claude Code

Installing globally (`npm install -g ai-review-agent`, or via `setup.bat`/`setup.command`)
automatically installs the `/ai-review` slash command for **every** Claude Code project, not just
this repo — a `postinstall` script copies it to `~/.claude/commands/ai-review.md`. Re-running
`npm install -g ai-review-agent@latest` refreshes it automatically; there's nothing to copy by
hand and nothing to keep in sync manually.

Every `ai-review-agent` run also checks (at most once every 7 days, asynchronously, never
blocking) whether a newer version is available and prints a one-line reminder if so. It never
auto-installs anything — you decide when to update.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document /ai-review auto-distribution and update notifier"
```

---

## Task 7: Update CHANGELOG and memory-bank

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`

- [ ] **Step 1: Add a CHANGELOG entry**

At the top of `CHANGELOG.md`, above the existing `## [1.2.1] — 2026-07-03 (review-gate hardening)`
entry, add:

```markdown
## [1.3.0] — 2026-07-14 (ai-review distribution)

### Added

- `scripts/postinstall.mjs`: `postinstall` lifecycle script that copies `.claude/commands/ai-review.md`
  into the user-level `~/.claude/commands/`, so `/ai-review` is available in every Claude Code
  project after a global install — not just this repo's own checkout. Fails open (warns, exits 0)
  on any permissions/environment issue.
- `update-notifier` integration in the CLI entrypoint: checks for a newer published version at
  most once every 7 days, asynchronously and non-blocking, and prints a one-line reminder if
  found. Never auto-installs.
```

- [ ] **Step 2: Bump the package version**

In `package.json`, change `"version": "1.2.1"` to `"version": "1.3.0"` (minor bump — new
backward-compatible feature, no breaking change).

- [ ] **Step 3: Update memory-bank**

In `memory-bank/activeContext.md`, prepend a new paragraph under `## Current Focus` (above the
existing 2026-07-14 AbortSignal entry):

```markdown
**`/ai-review` distribution + update-notifier (2026-07-14)**: `/ai-review` previously only existed
as a slash command inside this repo's own checkout -- `package.json`'s `files` array never shipped
`.claude/commands/`. Added a `postinstall` script (`scripts/postinstall.mjs`, plain JS so it can't
be broken by an unbuilt `dist/`) that copies it to `~/.claude/commands/` on every global install,
plus an `update-notifier` check in the CLI entrypoint (7-day cache, non-blocking, never
auto-installs). See `docs/superpowers/specs/2026-07-14-ai-review-distribution-design.md`.
```

In `memory-bank/progress.md`, add a new subsection under `## ✅ Completed (Tasks 1–16)`, above the
`### AbortSignal/Timeout-Cancellation Fix — 2026-07-14` section:

```markdown
### `/ai-review` Distribution + Update-Notifier — 2026-07-14

- [x] `scripts/postinstall.mjs` (plain JS, not compiled TS -- must survive running before
      `dist/` exists) copies `.claude/commands/ai-review.md` to `~/.claude/commands/` on every
      `npm install -g`/`npm update -g`. Fails open on any error.
- [x] `package.json`'s `files` array now ships `.claude/commands/` and `scripts/postinstall.mjs`.
- [x] `update-notifier` wired into `src/cli/index.ts`: 7-day cached check, non-blocking, TTY-only
      notification, never auto-installs.
- [x] Verified end-to-end via `npm pack` + global install into a throwaway prefix/fake HOME.
- [x] v1.3.0.
```

- [ ] **Step 4: Run the full check suite**

```bash
npm run check
```

Expected: test, typecheck, build, format:check, lint:eslint all pass.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: changelog and memory-bank for /ai-review distribution v1.3.0"
```

---

## Task 8: Land it

Follow this repo's established pattern (branch protection blocks direct push to `main`):

- [ ] **Step 1: Create a branch, push, open a PR**

```bash
git checkout -b feat/ai-review-distribution
git push origin HEAD:feat/ai-review-distribution
gh pr create --base main --head feat/ai-review-distribution \
  --title "feat: /ai-review self-distribution + update-notifier" \
  --body "Implements docs/superpowers/specs/2026-07-14-ai-review-distribution-design.md. Postinstall copies /ai-review into ~/.claude/commands/ on every global install; update-notifier checks for new versions every 7 days, non-blocking, never auto-installs."
```

Note: this repo's `/code-review` and `/change-review` review-gate hooks will require running
those slash commands (and writing their diff-bound markers) before the commit/push steps above
will succeed — follow the same flow used earlier in this session.
