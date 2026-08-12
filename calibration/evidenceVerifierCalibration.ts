// Permanent regression guard for evidenceVerifier.ts's judgment quality against real Ollama
// models -- the cleaned-up, TypeScript port of the scratch verify-poc.mjs script used to
// validate this design (see docs/superpowers/specs/2026-08-10-evidence-grounding-verification-
// design.md's Validation section). Carries forward the full 13-case set (5 evidence-contradicts-
// claim cases and 3 genuinely-correct controls from round 1, plus 5 more added in round 2) that
// qwen3:latest scored 13/13 on. Run manually or via CI when changing the verifier's prompt or
// evaluating a new candidate verifier model -- NOT part of the default test suite, since it
// makes real Ollama calls and takes minutes to run.
import { verifyEvidence } from '../src/core/evidenceVerifier.js'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import type { Finding } from '../src/core/schema.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODELS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['qwen3:latest']

function makeFinding(title: string, detail: string, evidence: string): Finding {
  return {
    id: 'calibration-0',
    agent: 'security',
    domain: 'Security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'calibration.ts',
    line: 1,
    title,
    detail,
    evidence,
    impact: 'n/a',
    recommendation: 'n/a',
    suggestion: 'n/a',
    blocking: false,
    source: 'llm',
  }
}

interface Case {
  label: string
  title: string
  detail: string
  evidence: string
  expected: 'SUPPORTED' | 'NOT_SUPPORTED'
}

const cases: Case[] = [
  {
    label: 'bad-1-observability-log-exists',
    title: 'Lock failure not logged',
    detail:
      'Lock acquisition failures are not logged, making debugging difficult when locks fail silently.',
    evidence: 'echo "WARN: could not acquire session-claims lock, skipping" >&2',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-2-file-handle-closed-by-with',
    title: 'File handle never closed',
    detail:
      'The temp file handle is never explicitly closed, risking file descriptor exhaustion under heavy load.',
    evidence: "with open(tmp, 'w') as f:\n    f.write(payload)",
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-3-guard-present',
    title: 'Missing claim-id guard',
    detail:
      'Calling release without --claim-id silently does nothing, with no error or exit code to signal the failure to the caller.',
    evidence: 'if [ -z "$claim_id" ]; then echo "Usage: release --claim-id <id>" >&2; exit 2; fi',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-4-unbound-var-fix-flagged-as-bug',
    title: 'Unbound variable risk',
    detail:
      "This line risks an unbound variable error under 'set -u' if $2 is not provided, since it's referenced without a default.",
    evidence: 'local value="${2:-}"; shift 2 2>/dev/null || shift',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-5-additive-change-called-breaking',
    title: 'Breaking change',
    detail:
      'This is a breaking change that will break existing callers relying on the current SessionStart behavior.',
    evidence:
      '+ "SessionStart": [{"matcher": "*", "hooks": [{"type": "command", "command": "scripts/init.sh"}]}]\n(this is a new key added to a hooks config object; nothing existing was removed or modified)',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'good-1-real-sql-injection',
    title: 'SQL injection',
    detail:
      'User input is concatenated directly into a SQL query without parameterization, allowing SQL injection.',
    evidence: 'const query = "SELECT * FROM users WHERE id = " + userId',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-2-real-null-deref',
    title: 'Null dereference',
    detail:
      'This function dereferences user.profile without checking whether user could be null, risking a runtime TypeError.',
    evidence: 'function getName(user: User | null) {\n  return user.profile.name.toUpperCase()\n}',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-3-real-nested-complexity',
    title: 'Deep nesting',
    detail: 'This function has 5+ levels of nested conditionals, making it hard to test and reason about.',
    evidence:
      'if (a) {\n  if (b) {\n    if (c) {\n      if (d) {\n        if (e) {\n          doThing()\n        }\n      }\n    }\n  }\n}',
    expected: 'SUPPORTED',
  },
  {
    label: 'bad-6-messy-diff-context-retry-bound-exists',
    title: 'Unbounded retry loop',
    detail:
      'This retry loop has no maximum attempt limit and could loop forever if the network never recovers.',
    evidence:
      '  async function fetchWithRetry(url, maxRetries) {\n' +
      '+   for (let attempt = 0; attempt < maxRetries; attempt++) {\n' +
      '+     try {\n' +
      '+       return await fetchWithTimeout(url)\n' +
      '+     } catch (err) {\n' +
      '+       if (attempt === maxRetries - 1) throw err\n' +
      '+       await sleep(backoffMs * (attempt + 1))\n' +
      '+     }\n' +
      '+   }\n' +
      '  }',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-7-wrong-hash-algorithm-claimed',
    title: 'Weak password hashing',
    detail:
      'Passwords are hashed with a fast, insecure algorithm (MD5), making them vulnerable to brute-force attacks.',
    evidence: 'const hash = await bcrypt.hash(password, 12)',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'good-4-real-xss',
    title: 'Stored XSS',
    detail: 'User-supplied HTML is rendered without sanitization, allowing stored XSS.',
    evidence: 'commentEl.innerHTML = comment.text // comment.text comes directly from user input',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-5-real-toctou-race',
    title: 'TOCTOU race',
    detail:
      'Two concurrent requests could both pass the balance check before either debits the account, allowing an overdraft.',
    evidence:
      '  const balance = await getBalance(accountId)\n' +
      '+ if (balance >= amount) {\n' +
      '+   await debit(accountId, amount) // no lock or transaction between the check and the debit\n' +
      '+ }',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-6-real-missing-await',
    title: 'Missing await',
    detail:
      'This async cleanup call is not awaited, so the function can return before cleanup actually completes.',
    evidence:
      'async function cleanup() { /* ... */ }\n\nfunction handler() {\n  cleanup() // missing await\n  return result\n}',
    expected: 'SUPPORTED',
  },
]

async function main(): Promise<void> {
  let anyFailed = false
  for (const model of MODELS) {
    const provider = new OllamaProvider(OLLAMA_URL, model)
    let correct = 0
    console.log(`\n=== ${model} ===`)
    for (const c of cases) {
      const start = Date.now()
      const result = await verifyEvidence(makeFinding(c.title, c.detail, c.evidence), provider)
      const got = result.verified ? 'SUPPORTED' : 'NOT_SUPPORTED'
      const pass = got === c.expected
      if (pass) correct++
      else anyFailed = true
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(
        `[${elapsed}s] ${c.label}: expected=${c.expected} got=${got} ${pass ? 'PASS' : 'FAIL'}` +
          (pass ? '' : ` -- ${result.reason}`)
      )
    }
    console.log(`${model}: ${correct}/${cases.length}`)
  }
  if (anyFailed) process.exit(1)
}

main()
