---
allowed-tools:
  - Bash(git diff *)
  - Bash(git diff HEAD)
  - Bash(git status *)
  - Bash(find * -type f *)
  - Bash(grep -r *)
  - Bash(grep -l *)
  - Bash(grep -c *)
  - Glob(**/**)
  - Read
description: Audit test coverage for changed files (or full project with --all). Reports missing test files, empty test files, framework config, and CI test step.
---

Audit test coverage for the project. Read the argument passed to this command:

- No argument → scope to `git diff HEAD --name-only` (changed files)
- `--all` → scan entire project source tree
- A path (e.g. `src/`) → scan that folder only

If the diff is empty in default mode, report "No changed source files to audit." and stop.

---

## Step 1 — Determine Scope

**Default mode:** Run `git diff HEAD --name-only`. Filter results to source files only:
- Exclude files whose path contains `test`, `spec`, or `__tests__`
- Exclude `.md`, `.json`, `.yml`, `.yaml`, `.toml`, `.cfg`, `.ini`, `.lock`, `.txt` files
- Exclude paths containing `node_modules/`, `.git/`, `dist/`, `build/`, `.venv/`

**`--all` mode:** Use `find . -type f` (or `Glob`) to enumerate all source files in the project, applying the same exclusions.

**Path mode:** Enumerate source files under the given path using the same exclusions.

---

## Step 2 — Auto-Detect Framework

Check for framework signals in this priority order. Stop at the first match.

| Signal | Detected framework |
|--------|-------------------|
| `jest.config.{ts,js,mjs,cjs}` exists | Jest |
| `vitest.config.{ts,js}` exists | Vitest |
| `package.json` contains `jest` or `vitest` or `mocha` in scripts or devDependencies | Jest / Vitest / Mocha |
| `requirements.txt` or `pyproject.toml` contains `pytest` | pytest |
| `setup.cfg` contains `[tool:pytest]` | pytest |
| `go.mod` exists | Go (stdlib) |
| `Gemfile` or `.rspec` exists | Ruby/RSpec |
| `Cargo.toml` exists | Rust (stdlib) |

If no framework is detected: note `[LOW] No test framework detected` and continue using fallback conventions (any file whose name contains `test` or `spec`).

---

## Step 3 — Source-to-Test File Mapping

For each source file in scope, check whether a corresponding test file exists using the framework's conventions:

| Framework | Source | Test locations to check |
|-----------|--------|------------------------|
| Python/pytest | `src/auth/login.py` | `tests/test_login.py`, `tests/auth/test_login.py`, `src/auth/test_login.py` |
| JS/TS (Jest/Vitest/Mocha) | `src/auth/login.ts` | `src/auth/login.test.ts`, `src/auth/login.spec.ts`, `src/auth/__tests__/login.test.ts` (swap extension for `.js`) |
| Go | `auth/login.go` | `auth/login_test.go` (same directory only) |
| Ruby/RSpec | `lib/auth/login.rb` | `spec/auth/login_spec.rb` |
| Rust | `src/auth/login.rs` | same file (tests are inline); check for `#[test]` inside the source file |
| Fallback | any file | any file matching `*test*` or `*spec*` within 3 directory levels |

If no test file is found: record `[HIGH]` for that source file.

---

## Step 4 — Non-Empty Test File Check

For each test file found, grep for at least one test declaration:

| Framework | Pattern to grep for |
|-----------|-------------------|
| Python/pytest | `def test_` |
| Jest / Vitest / Mocha | `it(`, `test(`, `describe(` |
| Go | `func Test` |
| Ruby/RSpec | `it `, `describe ` |
| Rust | `#[test]` |

If the test file exists but none of these patterns are found: record `[MEDIUM]` — test file exists but contains no test functions.

---

## Step 5 — Framework Config Check (once per project)

Verify that a test runner configuration file exists:

| Framework | Expected config |
|-----------|----------------|
| Jest | `jest.config.{ts,js,mjs,cjs}` or `"jest"` key in `package.json` |
| Vitest | `vitest.config.{ts,js}` or `"vitest"` key in `package.json` |
| pytest | `pytest.ini`, `pyproject.toml` with `[tool.pytest.ini_options]`, or `setup.cfg` with `[tool:pytest]` |
| Go | No config required — skip this check |
| RSpec | `.rspec` or `spec/spec_helper.rb` |
| Rust | No config required — skip this check |

If a framework was detected but no config file is found: record `[LOW] Framework detected but no config file found`.

---

## Step 6 — CI Test Step Check (once per project)

Glob for CI config files: `.github/workflows/*.yml`, `.circleci/config.yml`, `Jenkinsfile`, `.gitlab-ci.yml`.

- If **no CI config exists**: record `[LOW] No CI configuration found`.
- If **CI configs exist**, grep them for test invocation patterns:
  - `npm test`, `npm run test`, `yarn test`, `npx vitest`, `npx jest`
  - `pytest`, `python -m pytest`
  - `go test`
  - `rspec`, `bundle exec rspec`
  - `cargo test`
- If **CI configs exist but no test step found**: record `[MEDIUM] CI configuration found but no test step detected`.

---

## Output Format

Print a report in this format:

```
## Test Audit — [diff: N files] or [full: path — N files]
Framework detected: <name> (<config file> ✓) or None
Framework config:   ✓ <file> or ✗ missing
CI test step:       ✓ <file> or ✗ not found

### File Coverage
| Source File | Test File | Has Tests | Severity |
|-------------|-----------|-----------|----------|
| src/auth/login.ts | src/auth/login.test.ts ✓ | ✓ | — |
| src/payments/charge.ts | ✗ missing | — | [HIGH] |
| src/utils/format.ts | src/utils/format.spec.ts ✓ | ✗ empty | [MEDIUM] |

### Summary
N issues found: N [HIGH], N [MEDIUM], N [LOW]
- [HIGH]   src/payments/charge.ts — no test file found
- [MEDIUM] src/utils/format.ts — test file has no test functions
- [LOW]    No CI configuration found
```

If all checks pass, output:
```
✅ All checked files have test coverage. Framework config and CI test step present.
```

---

## Severity Reference

| Severity | Condition |
|----------|-----------|
| [HIGH] | Source file in scope has no corresponding test file |
| [MEDIUM] | Test file exists but contains no test functions or blocks |
| [MEDIUM] | CI configuration exists but invokes no test command |
| [LOW] | No test framework detected |
| [LOW] | Framework detected but no config file found |
| [LOW] | No CI configuration in project |
