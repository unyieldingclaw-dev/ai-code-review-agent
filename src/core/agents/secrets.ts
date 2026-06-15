import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import type { LLMProvider } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { AgentName, Finding, ReviewInput } from '../schema.js'

export class SecretsAgent extends BaseAgent {
  constructor(
    provider: LLMProvider,
    config: ReviewConfig
  ) {
    super(provider, config)
  }

  get name(): AgentName { return 'secrets' }

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

severity: "critical" for private keys or certificates
severity: "high" for API keys, tokens, or passwords
severity: "medium" for connection strings or other credential patterns

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":90,"file":"path/to/file","line":42,"title":"Short title","detail":"What the secret is","suggestion":"How to remediate"}]`
  }

  async run(input: ReviewInput): Promise<Finding[]> {
    // Respect preferredSecretsScanner config: if 'none', skip straight to LLM
    if (this.config.preferredSecretsScanner === 'none') {
      return super.run(input)
    }

    // Try to run gitleaks to check if tool is available
    const gitleaksFound = await runTool('gitleaks', ['version'])

    // If gitleaks is not available (returns null), fall back to LLM-only
    if (gitleaksFound === null) {
      return super.run(input)
    }

    // Gitleaks found — use LLM for analysis (full tool integration is future work)
    return super.run(input)
  }
}
