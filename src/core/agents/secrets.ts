import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseGitleaksOutput } from '../gitleaksParser.js'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AgentName, Finding, ReviewInput, ToolAvailability } from '../schema.js'

export class SecretsAgent extends BaseAgent {
  public lastToolAvailability?: ToolAvailability

  get name(): AgentName {
    return 'secrets'
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    // WHY join with projectPath before existsSync: extractChangedFiles returns paths relative to
    // the reviewed repo, not this process's own cwd -- when the caller points elsewhere (CLI
    // --dir, MCP repo_path), checking existsSync(f) directly silently resolved against the wrong
    // directory, dropping every real file and falling back to the LLM with no signal why.
    const projectPath = input.projectPath ?? '.'
    const files = extractChangedFiles(input.diff).filter((f) => existsSync(join(projectPath, f)))
    if (files.length > 0) {
      const allFindings: Finding[] = []
      let gitleaksRan = false
      for (const file of files) {
        const output = await runTool(
          'gitleaks',
          [
            'detect',
            '--no-git',
            '--source',
            file,
            '-f',
            'json',
            '-r',
            '-',
            '--exit-code',
            '0',
            '--no-banner',
            '--redact',
          ],
          undefined,
          false,
          projectPath
        )
        if (output === null) continue // gitleaks not installed
        gitleaksRan = true
        allFindings.push(...parseGitleaksOutput(output, this.name))
      }
      if (gitleaksRan) {
        this.lastToolAvailability = 'used'
        return allFindings
      }
    }
    this.lastToolAvailability = 'unavailable-llm-fallback'
    return super.run(input, signal)
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in secrets and credentials detection.
Analyze the diff for hardcoded secrets, credentials, and sensitive values:

- API keys and tokens: hardcoded strings matching common key formats (but not example/placeholder values)
- Passwords and passphrases in source code or config files
- Private keys, certificates, or cryptographic material
- Database connection strings with embedded credentials
- OAuth secrets, webhook secrets, or signing keys
- Cloud provider credentials (AWS, GCP, Azure key patterns)

Focus only on NEW lines added in the diff (lines starting with +).
Do NOT flag commented-out code, documentation examples, or clearly fake placeholder values.
Do NOT flag environment variable references like process.env.SECRET_KEY.
Do NOT flag file paths, marker files, or config file locations (e.g. ".claude/.review-ok",
"$root/config/settings.json") -- a path is not a credential regardless of nearby variable names
like "marker" or "key".
Do NOT flag hash algorithm invocations or their output (sha256sum, shasum, Get-FileHash,
git diff | sha256sum, or variables merely named "hash"/"expected"/"checksum") -- computing or
comparing a hash is not a secret.

severity: "critical" for private keys or certificates
severity: "high" for API keys, tokens, or passwords
severity: "medium" for connection strings or other credential patterns

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":90,"file":"path/to/file","line":42,"title":"Short title","detail":"What the secret is","suggestion":"How to remediate","domain":"Secrets","evidence":"<the specific added line containing the credential pattern>","impact":"<credential exposure risk — e.g. unauthorized API access, data breach, account takeover if secret is leaked via repo history>","recommendation":"<move to environment variable or secrets manager, with corrected code example>","blocking":false,"source":"heuristic"}]

Additional rules:
- evidence: quote the specific diff line(s) that triggered this finding
- recommendation: write corrected code, not just a description
- blocking: true for critical/high, false for medium/low
- source: "heuristic" for pattern-based detection; "gitleaks" if an external tool flagged it`
  }
}
