---
allowed-tools:
  - Bash(git diff *)
  - Bash(git diff HEAD)
  - Grep(**/**)
description: Scan current diff for security vulnerabilities across 9 patterns
---

Review the output of `git diff HEAD` for security vulnerabilities. Check every changed line against these 9 patterns:

**[CRITICAL]**
1. Hardcoded secrets — API keys, passwords, tokens, or credentials in source code
2. Command injection — unsanitized user input passed to shell commands (subprocess, os.system, exec)
3. SQL injection — user input concatenated directly into SQL strings

**[HIGH]**
4. Unvalidated external input — data from HTTP requests, files, or env vars used in logic without validation
5. Missing auth checks — endpoints or operations that should require authentication but don't
6. Insecure deserialization — pickle.loads(), yaml.load() without Loader=, eval() on untrusted data

**[MEDIUM]**
7. XSS — unescaped user input rendered into HTML output
8. Exposed error details — stack traces, internal paths, or system info returned to the user
9. Unsafe dynamic execution — eval(), exec(), or os.system() with any variable input

**[LOW]**
- Patterns safe now but that could become security issues if surrounding code changes

For each finding report:
- Severity: [CRITICAL] / [HIGH] / [MEDIUM] / [LOW]
- File path and line number
- What the issue is
- Recommended fix (specific, not generic)

If no issues found: "No security issues found in current diff."
