---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - security/trust
  - security/classification
last-reviewed: 2026-05-31
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Trust Classification

Defines trust levels for content sources in agentic workflows.
Referenced by the security-reviewer agent and `AGENTIC-SAFETY.md`.

No runtime enforcement. Trust level is informational context for security findings.

## Trust Levels

| Level | Definition |
|-------|-----------|
| TRUSTED | Content the operator explicitly controls and reviewed |
| SEMI_TRUSTED | Content in the repository but potentially modified by contributors |
| UNTRUSTED | External content not reviewed by the operator |

## Source Classification

| Source | Trust Level | Rationale |
|--------|-------------|-----------|
| Standards files (`standards/`) | TRUSTED | Operator-controlled, version-controlled |
| Commands (`.claude/commands/`) | TRUSTED | Operator-controlled, version-controlled |
| Agents (`.claude/agents/`) | TRUSTED | Operator-controlled, version-controlled |
| CLAUDE.md | TRUSTED | Operator-controlled, version-controlled |
| Memory bank files | SEMI_TRUSTED | Operator-controlled but partially AI-generated |
| Project source code | SEMI_TRUSTED | In-repo but may include external contributions |
| Config files | SEMI_TRUSTED | In-repo, usually operator-controlled |
| PR descriptions | UNTRUSTED | User-supplied, not reviewed before processing |
| Issue comments | UNTRUSTED | User-supplied, not reviewed before processing |
| User prompts (runtime) | UNTRUSTED | Direct user input during session |
| Fetched web content | UNTRUSTED | External, not operator-controlled |
| MCP tool results | UNTRUSTED | External service responses |

## Application in Security Findings

Include trust level when reporting prompt-injection or rules-file-integrity findings:

```
[CRITICAL] Rule: SEC-003
Evidence: `query = "SELECT * FROM users WHERE id = " + user_id`
Confidence: High
File: api.py:42
Issue: SQL injection via UNTRUSTED user input concatenated into query string
Fix: Use parameterized queries: cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

Runtime enforcement belongs in the hook/CI layer. This standard is advisory.

## Relationship to Other Standards

- `AGENTIC-SAFETY.md` — indirect prompt injection defense during live tasks
- `SECURITY-GUARDRAILS.md` — BLOCK/CONFIRM/WARN tiers for dangerous operations
- `RULES-FILE-INTEGRITY.md` — injection via rules files specifically
