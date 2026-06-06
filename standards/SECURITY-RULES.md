---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - security/rules
  - security/registry
last-reviewed: 2026-05-31
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Security Rules Registry

Rule IDs used by `/security-review` and the security-reviewer agent.
Reference this file when interpreting findings or extending coverage.

| ID | Severity | Pattern | Description |
|----|----------|---------|-------------|
| SEC-001 | CRITICAL | Hardcoded secrets | API keys, passwords, tokens, or credentials in source code |
| SEC-002 | CRITICAL | Command injection | Unsanitized user input passed to shell commands |
| SEC-003 | CRITICAL | SQL injection | User input concatenated directly into SQL strings |
| SEC-004 | HIGH | Unvalidated external input | Data from HTTP requests, files, or env vars used without validation |
| SEC-005 | HIGH | Missing auth checks | Endpoints or operations lacking required authentication |
| SEC-006 | HIGH | Insecure deserialization | pickle.loads(), yaml.load() without Loader=, eval() on untrusted data |
| SEC-007 | MEDIUM | XSS | Unescaped user input rendered into HTML output |
| SEC-008 | MEDIUM | Exposed error details | Stack traces, internal paths, or system info returned to users |
| SEC-009 | MEDIUM | Unsafe dynamic execution | eval(), exec(), or os.system() with any variable input |

## Adding Project-Specific Rules

Projects may extend this registry by appending rules starting at SEC-101.
Do not modify SEC-001 through SEC-099 — those are PMB-managed.

Example:

| SEC-101 | HIGH | Internal API direct call | Never call internal-api.example.com directly from client code |
