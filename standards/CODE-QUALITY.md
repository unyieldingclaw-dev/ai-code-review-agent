# Code Quality Standard

Generic code quality rules for AI-generated code, with an extension system for language-specific patterns.

## Overview

AI coding assistants can generate inconsistent code if not given clear guidelines. This standard ensures:
- Verification before claiming completion
- Consistent commenting practices
- Proper error handling
- Clean code structure

## Generic Core Rules

These rules apply to **all languages**.

### 1. Verification

**Never claim "done" without evidence.**

| Rule | Implementation |
|------|----------------|
| Run tests after changes | Execute test suite, report results |
| Check for lint errors | Run linter, fix issues |
| Verify build succeeds | Run build command, confirm no errors |
| Confirm functionality | Describe what was tested |

```
❌ "Done! I've implemented the feature."

✅ "Done! I've implemented the feature.
    - Tests passing: 47/47
    - Lint: No errors
    - Build: Successful
    - Tested: Created user, verified in database"
```

### 2. Comments

**Comment the WHY, not the WHAT.**

| Rule | Example |
|------|---------|
| No obvious comments | ❌ `// Import the module` |
| WHY comments for non-obvious logic | ✅ `// Use UTC to avoid timezone bugs in scheduling` |
| No commented-out code | ❌ `// oldFunction()` |
| Document breaking changes | ✅ `// BREAKING: Changed from sync to async` |
| Rationale must trace to observable behavior, documented constraint, or explicit project guidance | ❌ `// Using Set here for significant performance gains` ✅ `// Set prevents duplicate hook registration — settings loader may merge repeated entries on reload` |
| No speculative performance or optimization claims | ❌ `// Parallelized for performance` ✅ `// Parallelized because the upstream API enforces a 5s per-call timeout; sequential execution exceeds dashboard SLA` |
| Do not document rationale you cannot support with observable behavior, documented constraints, or explicit project guidance — this covers historical intent, optimization claims, and architectural explanations equally | ❌ `// Legacy compatibility` (unsupported — no linked ticket, no observable constraint) ✅ [omit the comment rather than invent a reason] |

```python
# ❌ BAD - Obvious comment
# Loop through users
for user in users:
    process(user)

# ✅ GOOD - Explains WHY
# Process sequentially to avoid rate limiting on external API
for user in users:
    process(user)
```

> **AI-assisted development amplifies the risk of plausible but unsupported rationale** —
> invented optimization claims, speculative architectural history, and authoritative-sounding
> fiction. These provenance standards apply regardless of whether a change is authored by
> a human or an AI system.
>
> **Absence of rationale is preferable to speculative rationale.** When the reason is not
> traceable to observable behavior, documentation, or explicit project guidance, the comment
> should not exist. Most AI-generated technical debt now comes from plausible explanatory
> fiction, not missing comments.

### 3. Structure

**Keep code organized and maintainable.**

| Rule | Rationale |
|------|-----------|
| Imports at top of file | Predictable location, easy to find |
| No inline imports | Avoid hidden dependencies |
| Prefer editing over creating files | Reduce code sprawl |
| Small incremental changes | Easier to review and debug |
| Single responsibility | Functions do one thing well |

### 4. Error Handling

**Handle all error cases explicitly.**

| Rule | Implementation |
|------|----------------|
| Never swallow exceptions silently | Always log or re-raise |
| Meaningful error messages | Include context, not just "Error" |
| Handle edge cases | Empty inputs, null values, boundaries |
| Graceful degradation | Partial results better than crash |

```python
# ❌ BAD - Silent swallow
try:
    result = api_call()
except:
    pass

# ✅ GOOD - Explicit handling
try:
    result = api_call()
except ConnectionError as e:
    logger.warning("API unavailable, using cached data", error=str(e))
    result = get_cached_result()
except ValueError as e:
    logger.error("Invalid API response", error=str(e))
    raise
```

### 5. Documentation

**Keep documentation in sync with code.**

| Rule | When |
|------|------|
| Update docs with behavior changes | Any user-facing change |
| Document breaking changes | Any API/interface change |
| Clear function signatures | Parameters, return types, exceptions |
| README for new features | Major additions |

### 6. File Management

**Be conservative with file creation.**

| Rule | Rationale |
|------|-----------|
| Prefer editing existing files | Reduces complexity |
| Don't create empty placeholder files | Creates noise |
| Don't generate binary/hash content | Expensive and unhelpful |
| Group related code | Avoid single-function files |

### 7. Dead Code & Cleanup Authority

**Identifying dead code and removing it are separate authority levels.**

| Authority | When allowed | Required evidence |
|-----------|-------------|-------------------|
| **Observe** | Always | State why it appears unused and what references were checked |
| **Remove** | Only with deterministic proof or explicit human confirmation | Proof that no execution path reaches it (static analysis + runtime + all platform branches) |

**The key constraint:** Lack of observed execution is not deterministic proof of non-use.

Code that appears unused during local analysis may be:
- A shell fallback for an alternate platform or runtime
- A CI-only branch activated by an env variable
- A hook script referenced by external config
- An extension point loaded dynamically by convention
- A compatibility shim that activates only on certain OS versions

**Default posture for infra, scripting, and governance code:** Observe-only. Shell scripts, platform branches, CI conditions, and hook scripts carry the highest risk of false dead-code detection. Do not remove without a human confirmation that the code path is truly unreachable.

**Observation format:** When flagging suspected dead code, state:
1. Why it appears unused (what signals suggest it's dead)
2. What references were checked (grep, call-site analysis, CI config, hook config)
3. Confidence level and the specific contexts that would need to be verified to be certain

**Example:**

```
# Suspected dead code: install_legacy_wrapper() — no call sites found via grep,
# not referenced in mb.sh invoke_* dispatch table.
# NOT removed: didn't check init-memory-bank.sh wrapper scripts or external CI callers.
# Recommend: human confirms before deletion.
```

**What this is not:** This section does not prohibit refactoring or cleanup. It constrains *autonomous deletion of code whose reachability cannot be proven*. Cleanup with human confirmation, cleanup of code the implementer just wrote, and cleanup where the full call graph is known — all fine.

## Language Extensions

Add language-specific rules in `standards/extensions/<language>.md`.

### Extension Template

```markdown
# [Language] Extension for Code Quality Standard

## Formatting
- Tool: [formatter name]
- Config: [config file if any]
- Rules: [key formatting rules]

## Type Safety
- Tool: [type checker name]
- Rules: [type annotation requirements]

## Testing
- Framework: [test framework]
- Coverage: [coverage requirements]
- Patterns: [test naming, structure]

## Anti-Patterns
- [Language-specific things to avoid]
- [Common AI mistakes in this language]

## IDE Integration
- [How to enable in Cursor/Claude Code]
```

### Available Extensions

| Language | File | Key Tools |
|----------|------|-----------|
| Python | [python.md](extensions/python.md) | black, isort, mypy, pytest |
| TypeScript | [typescript.md](extensions/typescript.md) | prettier, eslint, tsc |
| Template | [_template.md](extensions/_template.md) | For new languages |

## Implementation

### Cursor IDE

Create `.cursor/rules/code-quality.mdc`:

```yaml
---
alwaysApply: true
---

# Code Quality Standards

## Verification (ALWAYS do these)
- Run tests after making changes
- Check for lint errors after editing
- Verify build succeeds before claiming done
- Never claim "done" without running verification

## Comments
- No obvious comments ("// Import module", "// Define function")
- Add WHY comments for non-obvious logic
- No commented-out code
- Document breaking changes

## Structure
- Keep imports at top of file
- No inline imports
- Prefer editing existing files over creating new ones
- Make small incremental changes

## Error Handling
- Never swallow exceptions silently
- Provide meaningful error messages
- Handle edge cases explicitly
- Prefer graceful degradation

## Documentation
- Update docs when behavior changes
- Document breaking changes
- Ensure function signatures are clear
```

### Claude Code

Add to `CLAUDE.md`:

```markdown
## Code Quality

### Before Claiming Done
- Run tests and report results
- Check for lint errors
- Verify build succeeds

### Comments
- WHY comments only, not obvious WHAT comments
- No commented-out code

### Structure
- Imports at top
- Prefer editing over creating files
- Small incremental changes

### Errors
- Handle all error cases
- Meaningful error messages
- Never swallow exceptions
```

## Quality Checklist

Use this checklist before completing work:

```markdown
## Code Quality Checklist

### Verification
- [ ] Tests pass (run `pytest` / `npm test`)
- [ ] No lint errors (run `flake8` / `eslint`)
- [ ] Build succeeds (run `npm run build`)
- [ ] Functionality verified manually

### Code Review
- [ ] No obvious/redundant comments
- [ ] WHY comments for complex logic
- [ ] No commented-out code
- [ ] Imports organized at top

### Error Handling
- [ ] All error cases handled
- [ ] Meaningful error messages
- [ ] Edge cases covered

### Documentation
- [ ] README updated if needed
- [ ] Breaking changes documented
- [ ] Function signatures clear
```

## Common AI Mistakes

| Mistake | Prevention |
|---------|------------|
| Claiming done without testing | Require test output in response |
| Creating duplicate files | Search before creating |
| Obvious comments everywhere | Explicit "no obvious comments" rule |
| Swallowing exceptions | Require error handling patterns |
| Large monolithic changes | Prefer incremental approach |
| Missing error handling | Require explicit handling |

## Metrics

Track code quality with:

| Metric | Target | Tool |
|--------|--------|------|
| Test coverage | >80% new code | pytest-cov, nyc |
| Lint errors | 0 | flake8, eslint |
| Type coverage | >90% | mypy, tsc |
| Complexity | <10 per function | radon, eslint |

## Enforcement

### Soft Enforcement (AI Rules)
- AI follows these guidelines
- Can be overridden by user

### Hard Enforcement (CI/CD)
- Pre-commit hooks for linting
- CI pipeline for tests
- Code review requirements
- Branch protection

Recommended pre-commit config:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: lint
        name: lint
        entry: npm run lint
        language: system
        pass_filenames: false
      - id: test
        name: test
        entry: npm test
        language: system
        pass_filenames: false
```

## Success Indicators

Code quality is improving when:
- ✅ Tests consistently pass
- ✅ No lint errors in PRs
- ✅ Code reviews are faster
- ✅ Fewer bugs in AI-generated code
- ✅ Consistent style across codebase
- ✅ New team members understand code quickly

## Karpathy Coding Principles

Four principles from Andrej Karpathy on writing code with or without AI assistance:

1. **Think Before Coding** — Don't assume. Surface tradeoffs, state assumptions explicitly, and push back when a simpler approach exists. If something is unclear, stop and ask before implementing.

2. **Simplicity First** — Minimum code that solves the problem, nothing speculative. No unrequested features, abstractions, or flexibility. If 200 lines could be 50, rewrite it.

3. **Surgical Changes** — Touch only what you must. Don't improve adjacent code, don't refactor things that aren't broken, and match existing style. Every changed line should trace directly to the user's request.

4. **Goal-Driven Execution** — Define success criteria and loop until verified. Transform vague tasks into testable goals; for multi-step work, state a brief plan with a verify step for each action.
