import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseGitleaksOutput } from '../gitleaksParser.js'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AgentName, Finding, ReviewInput, ToolAvailability } from '../schema.js'

// A hardcoded secret must be a literal value -- a boolean, a bare identifier reference, or a
// constructor/function call can never itself BE a secret, regardless of what the identifier is
// named (e.g. "bool _obscurePassword = true;"). Deterministic backstop for the LLM fallback path
// below (the gitleaks branch above needs no such backstop -- it's a real tool, not a guess):
// verified via live measurement (calibration/fixtures/secrets-value-shape.diff, manually run 10x
// against real Ollama before/after) that the systemPrompt's equivalent instruction alone made no
// measurable difference to devstral's hallucination rate (5/10 before, 5/10 after) -- prompt
// wording is kept as a cheap first layer, but this filter is what actually catches it.
//
// Deliberately narrow (drops only a *known* non-secret shape, not "keep only if it looks like a
// secret"): the reverse would silently drop real credentials that are legitimately unquoted --
// PEM/certificate blocks, URI-embedded credentials, and config-file formats (YAML/.env/etc.) all
// commonly carry unquoted secret values. MIN_LITERAL_LENGTH excludes trivial 1-3 char quoted
// tokens (flags/enum values) that can't plausibly be a real credential.
const MIN_LITERAL_LENGTH = 4
const QUOTED_STRING_LITERAL = new RegExp(`(["'\`])[^"'\`\\n]{${MIN_LITERAL_LENGTH},}\\1`)
const PEM_OR_URI_CREDENTIAL = /-----BEGIN |:\/\/[^/\s]*:[^/\s@]*@/
const CONFIG_FILE_EXTENSION = /\.(ya?ml|env|properties|ini|toml|conf|cfg)$/i

function hasCredentialShapedValue(finding: Pick<Finding, 'evidence' | 'file'>): boolean {
  if (PEM_OR_URI_CREDENTIAL.test(finding.evidence)) return true
  if (CONFIG_FILE_EXTENSION.test(finding.file)) return true // unquoted secrets are normal here
  return QUOTED_STRING_LITERAL.test(finding.evidence)
}

export class SecretsAgent extends BaseAgent {
  readonly toolKey = 'gitleaks' as const

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
    let fallbackAvailability: ToolAvailability = 'unavailable-llm-fallback'
    if (files.length > 0) {
      const allFindings: Finding[] = []
      let gitleaksRan = false
      const skipped: string[] = []
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
        if (output === null) {
          // gitleaks produced no stdout for this file: either it isn't installed, or it exited
          // non-zero on this specific file (unreadable, locked, or a shape it rejects). runTool
          // already logs the latter to stderr, but skipping silently here meant a file that was
          // never scanned was indistinguishable from one scanned and found clean.
          skipped.push(file)
          continue
        }
        gitleaksRan = true
        allFindings.push(...parseGitleaksOutput(output, this.name))
      }
      // WHY a partial scan does not return here: if gitleaks succeeded on some files and produced
      // nothing for others, gitleaksRan is true from the successes alone and this reported a
      // COMPLETED secret scan -- while the file holding an actual credential may be one of the
      // ones silently skipped. Falling through to the LLM path instead means the whole diff still
      // gets looked at, including the files gitleaks could not read.
      //
      // The reported availability is 'partial' rather than 'unavailable-llm-fallback' when gitleaks
      // ran on at least one file: it did run, so telling the reader it was unavailable would send
      // them to install a tool they already have instead of asking why files were skipped.
      //
      // This deliberately reverses the note that stood here after a56d007, which deferred 'partial'
      // because it "ripples into the markdown/SARIF/MCP consumers". That estimate was checked
      // rather than re-inherited and was wrong: formatter.ts is the ONLY site that branches on the
      // value -- sarif.ts passes the object through opaquely, src/mcp/ never reads it, and
      // runner.ts's recordToolAvailability is value-agnostic, so widening the union touched neither
      // SARIF nor MCP. Adding 'not-applicable' (44a3d17) likewise needed only schema.ts.
      // The tradeoff is an LLM call in a case that previously skipped one; reachability is low
      // (the file must exist -- files are existence-filtered above -- yet be unreadable by
      // gitleaks), so this trades a rare extra call for never silently under-scanning.
      if (gitleaksRan && skipped.length === 0) {
        this.lastToolAvailability = 'used'
        return allFindings
      }
      if (skipped.length > 0) {
        fallbackAvailability = gitleaksRan ? 'partial' : 'unavailable-llm-fallback'
        console.error(
          `[secrets] gitleaks produced no output for ${skipped.length} of ${files.length} ` +
            `file(s) -- falling back to the LLM so they are not left unscanned: ${skipped.join(', ')}`
        )
      }
    }
    this.lastToolAvailability = fallbackAvailability
    const findings = await super.run(input, signal)
    return findings.filter((f) => {
      if (hasCredentialShapedValue(f)) return true
      console.error(
        `[secrets] dropped finding "${f.title}" -- evidence has no credential-shaped value ` +
          `(likely a hallucination on a name like "password"/"secret" whose actual value isn't ` +
          `a real credential): ${JSON.stringify(f.evidence)}`
      )
      return false
    })
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
A variable or field NAMED "password"/"secret"/"token"/"key" is not itself a finding -- check the
VALUE actually assigned to it. Only flag it if that value is a hardcoded credential-shaped string
(a real-looking key, token, or password literal). Do NOT flag a boolean, a UI-state flag, a
reference to another variable/controller/function, or an empty/placeholder value just because the
identifier's name contains one of those words (e.g. "bool obscurePassword = true;" or
"final _passwordCtrl = TextEditingController();" are UI state, not credentials).

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
- source: always "heuristic" — this prompt only runs when gitleaks wasn't available; a genuine
  gitleaks finding is reported directly from its own output and never reaches this prompt at all`
  }
}
