# Supply Chain Security Standard

**Version**: 1.0.0
**Applies to**: All AI-assisted development

## The Risk: Slopsquatting

AI coding assistants hallucinate package names. Research across 17 LLMs (2025) found that
~20% of AI-generated code samples referenced packages that do not exist. Of those, 43%
recurred across multiple queries — meaning attackers can predict which names to register.

This attack is called **slopsquatting**: a malicious actor registers the hallucinated package
name on PyPI/npm/Maven so that `pip install <hallucinated-name>` installs malware.

No confirmed in-the-wild exploitation as of April 2026, but the pattern is well-established.

## Required Controls

### 1. Verify Before Installing

Before installing any AI-suggested package:

```bash
# Python — check PyPI
pip index versions <package-name>

# Node — check npm
npm view <package-name> version

# Check the repo URL exists and looks legitimate
pip show <package-name>  # after install
```

If the package does not exist on the official registry, do not install it.

### 2. Use Internal Mirrors (Enterprise)

Route all package installs through an approved internal mirror (Artifactory, Nexus, etc.).
Packages not in the mirror require explicit security review before approval.

```bash
# Example: configure pip to use internal mirror
pip install --index-url https://your-artifactory/api/pypi/pypi/simple <package>
```

### 3. SCA Scanning

Run Software Composition Analysis on all dependencies, especially after AI-assisted sessions:

```bash
# Python
pip-audit  # or: safety check

# Node
npm audit

# Both — integrate in CI before merge
```

### 4. Rules File Integrity

When adopting `.cursor/rules/*.mdc` or `CLAUDE.md` files from community sources or cloned
repositories:

1. Review file contents before allowing them to load
2. Check for non-ASCII characters (potential Unicode injection):
   ```bash
   # Reject files with non-ASCII in rule headers
   grep -P "[\x80-\xFF]" .cursor/rules/*.mdc && echo "WARNING: non-ASCII found"
   ```
3. Add to your pre-commit hook:
   ```bash
   # .git/hooks/pre-commit (add this check)
   if grep -rqP "[\x80-\xFF]" .cursor/rules/ 2>/dev/null; then
     echo "ERROR: Non-ASCII characters found in .cursor/rules/ — possible injection"
     exit 1
   fi
   ```

## Soft vs. Hard Enforcement

| Control | Soft (AI rule) | Hard (CI gate) |
|---------|---------------|----------------|
| Verify package exists | ✅ In security.mdc + CLAUDE.md | ⚠️ No automated check |
| SCA scan | ❌ Not in AI rules | ✅ Add to CI pipeline |
| Rules file integrity | ❌ Not in AI rules | ✅ Pre-commit hook above |
| Internal mirror | ❌ Not in AI rules | ✅ pip/npm config |

**Minimum CI requirement:** SCA scan (`pip-audit` or `npm audit`) on every merge request
that modifies `requirements*.txt`, `package*.json`, or `*.lock` files.

See also: `standards/SECURITY-GUARDRAILS.md` § Enforcement Levels for how these controls map across all AI soft rules and CI hard gates.

---

**References:**
- [Slopsquatting: AI Hallucinations and the New Software Supply Chain Risk — FOSSA](https://fossa.com/blog/slopsquatting-ai-hallucinations-new-software-supply-chain-risk/)
- [AI-hallucinated code dependencies become new supply chain risk — BleepingComputer](https://www.bleepingcomputer.com/news/security/ai-hallucinated-code-dependencies-become-new-supply-chain-risk/)
- [Rules File Backdoor — Backslash Security](https://www.backslash.security/blog/claude-code-security-best-practices)
