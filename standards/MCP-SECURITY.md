# MCP Security Standard

**Version**: 1.0.0
**Applies to**: Any project using Model Context Protocol (MCP) servers

## What Is MCP

Model Context Protocol (MCP) lets AI coding assistants connect to external tools: databases,
APIs, file systems, cloud services. A single MCP server can expose significant access.

## Threat Model

### Tool Poisoning

Malicious instructions can be embedded in an MCP server's tool metadata (the description
field that the AI reads to understand what a tool does). The AI may act on these instructions
without the user seeing them.

**Mitigation:** Only connect to MCP servers you control or have reviewed. Pin server versions.
Review tool descriptions when adding a new server.

### Credential Exposure in mcp.json

MCP config files often require API keys. Hardcoding them in `mcp.json` means:
- The key appears in version control history if the file is ever committed
- The key is readable by any process that can read the file

**Mitigation:** Use environment variable references in all MCP config files.

### Over-Privileged Tool Access

MCP servers often request broad permissions. A file-system MCP server granted access to `~/`
can read SSH keys, `.env` files, and credential stores.

**Mitigation:** Scope each MCP server to the minimum directory or resource it needs.

## Required Practices

### Credentials — Use Environment Variables

In `mcp.json` or `.mcp.json`:

```json
{
  "mcpServers": {
    "my-service": {
      "command": "npx",
      "args": ["-y", "@my-org/mcp-server"],
      "env": {
        "API_KEY": "${MY_SERVICE_API_KEY}"
      }
    }
  }
}
```

Never:
```json
"API_KEY": "sk-live-abc123..."
```

### Allowlist MCP Servers

Maintain an approved list of MCP servers at the team level. New servers require:
1. Code review of the server's source or published manifest
2. Security review of what data the server can access
3. Least-privilege scope configuration

### Gitignore mcp.json if It Contains Any Sensitive Config

```gitignore
# If your mcp.json references local paths or has non-env-var values:
.mcp.json
mcp.json
```

Commit a `mcp.json.example` with all values replaced by `${ENV_VAR_NAME}`.

### Treat MCP Tool Results as Untrusted Input

MCP server output reaches the AI's context. A compromised server can inject instructions.
Apply the same scrutiny to MCP tool results as to user input from external sources.

For task boundary setting and broader agentic safety guidance during live sessions, see `standards/AGENTIC-SAFETY.md`.

---

**References:**
- [Model Context Protocol Security — Red Hat](https://www.redhat.com/en/blog/model-context-protocol-mcp-understanding-security-risks-and-controls)
- [11 Emerging AI Security Risks with MCP — Checkmarx](https://checkmarx.com/zero-post/11-emerging-ai-security-risks-with-mcp-model-context-protocol/)
- [MCP Security Critical Vulnerabilities — eSentire](https://www.esentire.com/blog/model-context-protocol-security-critical-vulnerabilities-every-ciso-should-address-in-2025)
