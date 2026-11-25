# Secrets Management (Ephemeral by Default)


This standard defines where secrets (API keys, tokens, passwords, certificates, connection strings) must live, when they must rotate, and what is never allowed. It extends `standards/SECURITY-GUARDRAILS.md`: the BLOCK tier refuses to commit secrets; this standard defines what to do with secrets **at runtime**, particularly when AI agents are active.

## Why this matters

In March 2026, the LiteLLM supply-chain breach harvested `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, and `.bash_history` from **40,000+ Python builds**. The AI tool read the developer's environment because the developer had put long-lived credentials in shell env vars visible to agent sessions. Rotation was the only remediation. The attack surface is identical for any AI coding tool with filesystem or env-read access.

## Principles (hard requirements)

### 1. Never commit a secret

(Already enforced by `.cursor/rules/security.mdc` BLOCK tier. Repeated here for completeness.)

- No `.env`, no `*.pem`, no `*.key`, no `id_rsa`, no `credentials.json`, no Azure/AWS/GCP credential files.
- `.gitignore` must block `.env*`, `*.pem`, `*.key`, `id_*`, `credentials*`.
- Pre-commit hooks should scan staged content for secret patterns (AWS access keys, Slack tokens, high-entropy strings).

### 2. Use a centralized secrets store

Secrets must live in a secrets manager, not in files or long-lived environment variables:

- **Preferred:** HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or your preferred equivalent.
- **Acceptable for dev only:** a developer-scoped keychain (`keyring` on macOS, Credential Manager on Windows, `libsecret` on Linux) combined with short-lived tokens.
- **Never acceptable:** committed `.env` files, plaintext config stored in a wiki, credentials in `mcp.json`, credentials in a Cursor rules file, credentials in memory-bank files.

### 3. Short-lived > long-lived

- Issue short-lived tokens wherever the provider supports them (AWS STS, GCP workload identity, OIDC, Vault dynamic secrets).
- Long-lived tokens need a documented rotation SLA and an owner.
- **Recommended defaults:** dev tokens ≤ 12 hours, CI tokens ≤ 1 hour, production service tokens ≤ 24 hours with automatic rotation.

### 4. Agent-safe posture

When an AI coding agent (Claude Code, Cursor, or any MCP-connected tool) is active:

- The shell the agent runs in **must not** export long-lived credentials as environment variables. If the agent reads env, it can re-emit env.
- Secrets needed for the session must be **injected as short-lived tokens** that expire within the session window.
- After any agent session that may have read credentials (even inadvertently via a tool call or log inspection), **rotate** them. Do not evaluate whether it was "actually read" — rotation is the default.
- Shell history files (`~/.bash_history`, `~/.zsh_history`, `~/.psql_history`, `~/.sqlite_history`, etc.) must not contain credential-bearing commands. Use `unset HISTFILE` or prefix sensitive commands with a space where the shell is configured to skip such lines.

### 5. If `.env` is unavoidable

Some frameworks make `.env` hard to avoid in local dev. When you must:

- **Scope** it to the project folder only (never `~/.env`).
- **Populate** it from the secrets manager at session start, not from a committed template with real values.
- **Rotate** its contents on session end or whenever the agent session completes.
- **Exclude** it from all read paths exposed to an MCP server or tool.
- **Audit** by grepping for the patterns after a task: `grep -rE "(API_KEY|SECRET|TOKEN|PASSWORD)\s*=" .` should return zero matches outside `.env.example`.

### 6. MCP-specific rules

(Expanding on `standards/MCP-SECURITY.md`.)

- MCP server configs (`mcp.json`, `~/.claude/mcp.json`, equivalents) reference secrets by environment variable name, never by value.
- When starting an MCP server that needs credentials, pass them via the parent process's ephemeral env, not the user's long-lived env.
- Audit the MCP server's tool definitions on install and after updates — a compromised tool description can instruct an agent to re-emit secrets.

## Practical workflows

### Dev laptop with Claude Code / Cursor

```
1. Log in to the secrets manager CLI (e.g., `vault login`, `aws sso login`) — this issues a short-lived token.
2. Launch the IDE/agent session inside a shell spawned from that authenticated context.
3. The secrets manager CLI provides short-lived service credentials on demand (e.g., `aws s3 ls` uses the STS token).
4. At session end, the short-lived token expires naturally. Nothing to clean up.
```

### CI / CD pipeline

- CI runner authenticates to the secrets manager via OIDC / workload identity — no long-lived keys stored in CI.
- Job receives short-lived credentials scoped to its task.
- Credentials are never echoed to build logs. Mask patterns at the runner level.

### Incident: secret may have been exposed

Minimum steps:

1. Rotate the affected credentials **immediately**, regardless of confidence level.
2. Preserve evidence (logs, commit diff, shell history snapshot if available).
3. Revoke the token at the provider side, not just locally.
4. File the incident; write the post-mortem.

## What never belongs near an agent

- Root-level API keys (AWS root, GitHub PAT with broad scope, `glpat-*` tokens in the remote URL) — even in a terminal the agent can't see, if the agent can `git remote -v` the leak vector exists.
- Long-lived database passwords in `~/.pgpass`, `~/.my.cnf`, etc., if the agent can read the file system.
- SSH keys in `~/.ssh` — if the agent can ask a tool to read a file, it can read these.

If the agent must operate against these systems, proxy the access through a short-lived credential issued by the secrets manager.

## References

- LiteLLM March 2026 supply-chain breach — agent harvested env vars and shell history from 40k+ Python builds.
- OWASP LLM Top 10 (2025) — LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency.
- GitHub Copilot agentic security principles — https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/
- `standards/MCP-SECURITY.md` for MCP-specific credential rules.
- `standards/SECURITY-GUARDRAILS.md` for BLOCK-tier refusal of committed secrets.

---

**Version**: 1.0.0
**Last Updated**: April 24, 2026
**Owner**: Personal
