# Rules-File Integrity


Rule files such as `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, and anything under `.cursor/rules/*.mdc` or `.claude/commands/*.md` are **executable input to AI assistants**. They travel with repositories, survive context summarization, and are treated as authoritative directives by Cursor and Claude Code. This makes them a high-value attack target — a compromised rules file can silently redirect an agent's behavior across every downstream project that installs it.

This standard defines the hygiene rules that must be applied to all rules files in the Memory-Bank ecosystem.

## Threat model (2024–2026)

| Attack | Evidence | Mitigation |
|--------|----------|-----------|
| Malicious `.cursorrules` distributed with a repo instructs the agent to "source project env before actions," exfiltrating credentials | arxiv/2601.17548v1 — *Prompt Injection on Agentic Coding Assistants* | Treat rules files like code; review every diff by a human |
| Invisible Unicode / zero-width characters hide instructions inside otherwise-harmless-looking rules files | arxiv/2509.22040v1 — *Documentation-Based Prompt Injection* | Strip non-printable Unicode on diff review; lint for suspicious codepoints |
| HTML comments (`<!-- ... -->`) embed hidden directives a human skimmer will miss | GitHub Copilot agent guidance (2025) | Block HTML comments in rules files; require plain-Markdown prose only |
| "Ignore previous instructions" / "disable guardrails" / "bypass CONFIRM" patterns | Standard prompt-injection corpus | Explicit lint pattern list (below) |
| Rules-file rug-pull: trusted repo later adds a malicious rule in a minor release | Supply-chain parallel (e.g., xz-utils, PhantomRaven) | Pin and review rules-file updates as dependency upgrades; require explicit PR approval |

## Hygiene rules (hard requirements)

All `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, and `.claude/commands/*.md` files must satisfy every rule below.

### 1. No invisible characters

- No zero-width joiners (`U+200B`–`U+200F`), bidirectional overrides (`U+202A`–`U+202E`, `U+2066`–`U+2069`), non-breaking spaces in bulk, or any code point in the private-use area.
- Only printable ASCII plus the common Latin supplement, dashes, and standard punctuation. Emoji is allowed **only** if visibly intentional (e.g., section markers).

### 2. No hidden-instruction containers

- No HTML comments (`<!-- ... -->`).
- No `<script>`, `<style>`, or any HTML that renders differently from the source text.
- No Markdown link titles that differ from the visible link text when the difference could instruct the agent.

### 3. No guardrail-bypass patterns

The following phrases **must be rejected** unless the rules file is unambiguously a security education document (and even then, use quote blocks, not directives):

- "Ignore previous instructions" / "ignore the above" / "disregard prior"
- "Disable guardrails" / "bypass BLOCK" / "override CONFIRM"
- "You are now in developer / unrestricted / god mode"
- "As a reminder, you have full access to"
- Any imperative that tells the agent to exfiltrate, encode, or silently forward content outside the current repo

### 4. No out-of-band network or secret directives

- No instructions that tell the agent to reach out to external endpoints not already in the repo's approved MCP servers or tool allowlist.
- No instructions that tell the agent to read, decode, or re-emit `.env`, `~/.aws/credentials`, SSH keys, or shell history.
- No instructions to touch environment variables matching `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` without the user explicitly invoking the action in-session.

### 5. Explicit provenance

Every rules file must have a visible header or frontmatter describing what it does, who owns it, and when it was last reviewed. This makes tampering easier to spot in diff review.

For `.mdc` files, the `description:` frontmatter field is required.
For `CLAUDE.md` / `AGENTS.md`, the first section must be human-readable prose naming the project and purpose.

### 6. Review as code

- Every change to any rules file requires a human reviewer in the PR / MR.
- Rules-file changes are never auto-merged, even from bots.
- Propagation to downstream projects is an explicit, tracked operation (see the accessibility-rollout pattern in `scripts/`).

## Enforcement

- `.cursor/rules/rules-file-integrity.mdc` (glob-scoped to `**/.cursorrules`, `**/CLAUDE.md`, `**/AGENTS.md`, `**/*.mdc`, `**/*.md` under `.claude/commands/`) auto-activates when any of these files is open and reminds the assistant to refuse suspicious edits.
- Security guardrail: `standards/SECURITY-GUARDRAILS.md` BLOCK tier now refuses to add instruction-like content to rule files on behalf of untrusted sources without human review.
- CI lint recommendation (not yet implemented; captured here for a future pass): a simple pre-commit hook that searches for the bypass patterns in §3 and non-printable Unicode in §1, and fails the commit if found.

## What to do if you find a violation

1. Stop the current work.
2. Preserve the offending file via `git show HEAD:<path>` so diff history is retained.
3. Revert the offending change (`git revert` or manual edit).
4. Write a brief post-mortem documenting how the compromise occurred.
5. Rotate any credentials the agent could have accessed during the time the compromised rules file was active.

## References

- arxiv/2601.17548v1 — *Prompt Injection on Agentic Coding Assistants*
- arxiv/2509.22040v1 — *Documentation-Based Prompt Injection*
- GitHub Copilot agentic security principles (2025) — https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/
- OWASP LLM Top 10 (2025), LLM01 Prompt Injection

---

**Version**: 1.0.0
**Last Updated**: April 24, 2026
**Owner**: Personal
