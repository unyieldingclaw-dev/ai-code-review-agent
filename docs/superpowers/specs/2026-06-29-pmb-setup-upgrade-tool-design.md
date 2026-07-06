---
title: PMB Setup/Upgrade Tool
date: 2026-06-29
status: approved
---

# PMB Setup/Upgrade Tool — Design Spec

## Purpose

A single double-clickable `.bat` file that fully initializes or upgrades a project's Memory Bank (PMB) with no manual commands required. Lives in the PMB repo; targets any project folder via a folder picker dialog.

---

## Files

Three files in the PMB repo:

```
mb-setup.bat          ← double-click launcher (never changes)
scripts/mb-setup.ps1  ← all logic
mb-schema.json        ← source of truth for required files, fields, thresholds
```

---

## `mb-schema.json` Structure

Defines what a valid PMB looks like. Updated here when PMB evolves — script logic never needs to change.

```json
{
  "version": "1.2",
  "requiredFiles": [
    {
      "name": "projectbrief.md",
      "type": "stable",
      "requiredFrontmatter": ["authority", "last-reviewed"],
      "minContentLines": 5
    },
    {
      "name": "systemPatterns.md",
      "type": "stable",
      "requiredFrontmatter": ["last-reviewed"],
      "minContentLines": 5
    },
    {
      "name": "techContext.md",
      "type": "stable",
      "requiredFrontmatter": ["last-reviewed"],
      "minContentLines": 5
    },
    {
      "name": "activeContext.md",
      "type": "volatile",
      "requiredFrontmatter": ["last-reviewed"],
      "minContentLines": 3
    },
    {
      "name": "progress.md",
      "type": "volatile",
      "requiredFrontmatter": ["last-reviewed"],
      "minContentLines": 3
    }
  ]
}
```

**File types:**

- `stable` — re-scaffoldable; merge preserves content but updates structure
- `volatile` — living documents; only missing frontmatter fields are added, content never touched

---

## Script Flow (`mb-setup.ps1`)

### 1. Folder Selection

- If a folder is dragged onto `mb-setup.bat` → use that path (no dialog)
- Otherwise → show Windows GUI folder picker (`Shell.Application`)
- Validate that the selected path is a directory; exit with error if not

### 2. Load Schema

Read `mb-schema.json` from the same directory as the script. Fail fast with a clear error if schema is missing or malformed.

### 3. Detect Mode

| Condition                          | Mode        |
| ---------------------------------- | ----------- |
| No `memory-bank/` folder in target | **INIT**    |
| `memory-bank/` exists              | **UPGRADE** |

---

### INIT Mode

1. Create `memory-bank/` directory
2. Scaffold all files listed in schema from templates (stub content + full frontmatter)
3. Copy `README.md` into `memory-bank/`
4. Proceed to Verify

---

### UPGRADE Mode

**Step 1 — Analyze current state (read-only):**

Display what was found:

```
Files present:    ✅ projectbrief.md  ✅ systemPatterns.md  ❌ newfile.md
Frontmatter gaps: systemPatterns.md missing "confidence" field
Obsolete files:   oldfile.md (no longer in schema)
```

**Step 2 — Display upgrade plan:**

```
Will add:    newfile.md (scaffold from template)
Will merge:  systemPatterns.md (add missing frontmatter fields)
Will remove: oldfile.md (requires confirmation)
Will skip:   activeContext.md, progress.md (volatile — content preserved)
```

**Step 3 — Confirmation prompt:**

```
Proceed with upgrade? (Y/N)
```

Abort cleanly on N.

**Step 4 — Execute plan:**

- Missing files → scaffold from template (full)
- Stable files with gaps → merge: preserve content, inject missing frontmatter fields
- Volatile files with gaps → inject missing frontmatter fields only, never touch content
- Obsolete files → prompt individually before deleting

---

### 4. Verify (runs after both INIT and UPGRADE)

Checks run against the schema:

1. **File presence** — all required files exist
2. **Content quality** — each file meets `minContentLines` threshold
3. **Frontmatter integrity** — each file has all `requiredFrontmatter` fields

---

### 5. Summary Report

```
=== PMB Setup Complete ===

✅ Created:  projectbrief.md, systemPatterns.md, techContext.md
✅ Updated:  activeContext.md (frontmatter only)
⚠️  Skipped:  progress.md (already current)
❌ Failed:   (none)

Verification: 5/5 files pass all checks.

Press any key to close...
```

Any verify failures are listed with specific fix hints.

---

## Non-Goals

- Does not launch Claude Code after setup
- Does not touch `.claude/` settings or hooks
- Does not validate content quality semantically (only line count thresholds)

---

## Future / Nice-to-Have

- **C: Drag-and-drop** — folder dragged onto `.bat` skips the picker dialog (minimal extra work in PS1 via `$args[0]`)
- Schema versioning with migration notes when `mb-schema.json` version bumps

---

## Implementation Location

This tool is implemented in the **PMB repo**, not ACR. Templates for each file should be stored alongside the script (e.g., `scripts/templates/projectbrief.md`, etc.).
