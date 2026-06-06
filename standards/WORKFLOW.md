# Workflow Standard

Structured feature development from idea to committed code. Prevents the most common AI coding failure mode: writing code before understanding what to build.

## The Problem

AI assistants default to writing code immediately. This produces:
- Code that solves the wrong problem
- Designs that don't survive contact with the actual codebase
- Security issues discovered after implementation
- Sessions that burn context on rework

## The Solution

A 7-phase workflow that front-loads understanding and defers code until the design is locked.

## Phases

### Phase 1 — Brainstorm

**Trigger:** Any non-trivial feature, bug fix with unclear root cause, or architectural change.

**What happens:**
- Explore the codebase to understand existing patterns
- Ask clarifying questions one at a time to understand purpose, constraints, success criteria
- Propose 2–3 approaches with trade-offs
- Get design approved before writing any code

**Output:** Verbal agreement on approach.

**Skip when:** Single-file fix, typo, config value change, renaming, or the change is obvious and < 20 lines.

---

### Phase 2 — Spec

**What happens:**
- Write the validated design to `docs/specs/YYYY-MM-DD-<topic>.md`
- Include: context (why), architecture, components, data flow, error handling, verification steps
- Self-review: no TBDs, no contradictions, no ambiguity
- Get user approval before proceeding

**Output:** `docs/specs/YYYY-MM-DD-<topic>.md` committed to git.

**Skip when:** The change is too small to warrant a spec (single function, obvious fix).

---

### Phase 3 — Plan

**What happens:**
- Map out every file to be created or modified
- Break implementation into bite-sized tasks (2–5 minutes each)
- Each task includes: exact file paths, complete code, exact test commands, expected output
- No placeholders — if a step changes code, show the code

**Output:** `docs/plans/YYYY-MM-DD-<feature>.md` committed to git.

**Skip when:** No spec was needed.

---

### Phase 4 — Implement (TDD)

**Verification-First:** Before asking Claude to start implementing, state upfront:
- Test cases or expected outputs (even informal: "function should return X given Y")
- The success criteria (what does "done" look like?)
- Any constraints (must not change the API, must stay under N ms, etc.)

This is the single highest-leverage prompt engineering habit — it cuts correction cycles significantly.

For each task in the plan:

```
1. Write the failing test
2. Run it — verify it fails with the expected error
3. Write the minimal code to make it pass
4. Run it — verify it passes
5. Commit
```

Never write implementation before the failing test exists.

**Commit frequency:** After each passing test or logical unit. Never accumulate more than one unit of work in a commit.

---

### Phase 5 — Simplify

After implementation is complete:
- Review all changed files for clarity, consistency, and maintainability
- Remove dead code, redundant logic, unnecessary abstraction
- Rename for clarity where needed
- Do NOT change behavior — only improve readability

**Output:** Clean, committed code.

---

### Phase 6 — Security Review

Scan the current diff against 9 patterns:

| Severity | Patterns |
|----------|---------|
| `[CRITICAL]` | Hardcoded secrets, command injection, SQL injection |
| `[HIGH]` | Unvalidated external input, missing auth checks, insecure deserialization |
| `[MEDIUM]` | XSS, exposed error details, unsafe eval/exec |
| `[LOW]` | Patterns safe now but risky under future changes |

**Resolution:** All `[CRITICAL]` and `[HIGH]` findings must be resolved before proceeding. `[MEDIUM]` and `[LOW]` are documented in the PR.

---

### Phase 7 — Commit

```bash
git add <specific files — never git add -A blindly>
git commit -m "feat: <what was built and why in one line>"
```

Never commit `.env`, credentials, or unrelated changes.

---

## Quick Reference

| Phase | Skip when | Output |
|-------|-----------|--------|
| 1. Brainstorm | Trivial change | Agreed approach |
| 2. Spec | No spec needed | docs/specs/*.md |
| 3. Plan | No spec needed | docs/plans/*.md |
| 4. Implement | — | Committed, tested code |
| 5. Simplify | — | Clean committed code |
| 6. Security Review | — | Resolved findings |
| 7. Commit | — | Clean commit |

## Claude Code Integration

If using the Superpowers plugin, each phase maps to a skill:

| Phase | Skill |
|-------|-------|
| Brainstorm | `superpowers:brainstorming` |
| Plan | `superpowers:writing-plans` |
| Implement | `superpowers:executing-plans` or `superpowers:subagent-driven-development` |
| Simplify | `code-simplifier` plugin |
| Security Review | `security` plugin or `/security-review` command |

Run `/feature-dev` in Claude Code to trigger the full workflow automatically.

## Cursor Integration

Add to `.cursor/rules/workflow.mdc`:

```yaml
---
alwaysApply: true
---

# Development Workflow

For any non-trivial feature: brainstorm → spec → plan → implement (TDD) → simplify → security review → commit.

**Skip to Phase 4** for: single-file fixes, typos, config changes, or changes < 20 lines.

Never write code before the design is approved.
Never commit without running tests.
Never merge with [CRITICAL] or [HIGH] security findings.
```
