# Task Contract Guide

Task contracts are the mechanism by which Claude declares its intent before a multi-file change. A contract is a JSON file written to `.claude/contracts/active-task.json` before work begins and updated on completion or cancellation. The pre-tool-use hook reads this file and warns if a write targets a file outside the declared scope.

## When a Contract Is Required

A contract is required before starting any task that:

- Touches 4 or more files, **or**
- Touches a sensitive domain: auth, payments, data deletion, CI changes, schema migrations, **or**
- Implies a multi-session refactor or migration

Skip the contract for: single-file edits, typos, config-value changes, changes clearly under 20 lines.

## Contract Schema

```json
{
  "task": "Short description of what is being built or changed",
  "status": "active",
  "created_at": "2026-01-01T09:00:00Z",
  "expires_at": "2026-01-01T17:00:00Z",
  "scope": [
    { "file": "src/path/to/file.ts", "op": "create" },
    { "file": "src/path/to/other.ts", "op": "edit" },
    { "file": "tests/unit/file.test.ts", "op": "create" }
  ]
}
```

### Field Reference

| Field        | Type                                        | Required | Description                                                                                                |
| ------------ | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `task`       | string                                      | ✅       | One-sentence description of the work                                                                       |
| `status`     | `"active"` \| `"complete"` \| `"cancelled"` | ✅       | Lifecycle state                                                                                            |
| `created_at` | ISO 8601 datetime                           | ✅       | When the contract was created                                                                              |
| `expires_at` | ISO 8601 datetime                           | ✅       | When the contract expires (typically 8 hours from creation)                                                |
| `scope`      | `Array<{file, op}>`                         | ✅       | Files in scope. Each entry has a `file` path (relative to repo root) and an `op` of `"create"` or `"edit"` |

### Status Values

| Value         | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `"active"`    | Contract is in force. Hook enforces scope.          |
| `"complete"`  | Task finished successfully. Scope enforcement ends. |
| `"cancelled"` | Task was stopped mid-way. Scope enforcement ends.   |

### Op Values

| Value      | Meaning                                     |
| ---------- | ------------------------------------------- |
| `"create"` | File does not yet exist and will be created |
| `"edit"`   | File already exists and will be modified    |

## Creating a Contract

When a task requires a contract, Claude will propose a **Task Contract Proposal** before touching any files:

```
Task Contract Proposal

Task: Add gitleaks scan to release.yml

Scope:
- .github/workflows/release.yml (edit)

Type "approved" to begin, or tell me what to adjust.
```

On approval, Claude writes `.claude/contracts/active-task.json` with `status: "active"` and `expires_at` set to 8 hours from now.

## Completing a Contract

When the task is done, Claude updates `status` to `"complete"`:

```json
{
  "task": "Add gitleaks scan to release.yml",
  "status": "complete",
  ...
}
```

## Cancelling a Contract

If you say "cancel contract" or "stop" mid-task, Claude writes `"status": "cancelled"` to the contract file.

## Hook Behavior

The `check-contract.sh` / `check-contract.ps1` hook fires on every Write or Edit tool call:

- If no `active-task.json` exists, or `status` is not `"active"`: hook exits 0 silently (no enforcement)
- If `status` is `"active"` and the target file is in `scope`: hook exits 0 silently
- If `status` is `"active"` and the target file is **not** in `scope`: hook prints a warning and Claude should pause to confirm with the user before proceeding
- If `active-task.json` is malformed JSON: hook prints a warning (does not block — fail-open to avoid disrupting work)

## Notes

- `.claude/contracts/` is gitignored — contract files are session state, not project history
- `expires_at` is informational; the hook does not check clock time
- Omit `created_at` if you want minimal contracts; it is informational only
- The `scope` array should include every file that will be touched, including test files and documentation updates
