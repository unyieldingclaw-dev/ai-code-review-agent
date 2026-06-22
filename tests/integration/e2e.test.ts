// tests/integration/e2e.test.ts
//
// Full pipeline test against a live Ollama instance.
//
// Skip gate: set INTEGRATION=1 to opt in.
// If Ollama or the required model is unavailable, tests skip with a visible
// error message and concrete solution printed to stderr.
//
// Run: INTEGRATION=1 npm run test:integration
import { describe, it, expect, beforeAll } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { checkOllamaModel } from '../helpers/requireOllama.js'
import type { ReviewResult } from '../../src/core/schema.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? DEFAULT_CONFIG.ollamaUrl
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_CONFIG.model

// Check Ollama + model availability. Message prints to stderr before skipIf fires.
const ollamaCheck = await checkOllamaModel(OLLAMA_URL, OLLAMA_MODEL)
const SKIP = !process.env.INTEGRATION || ollamaCheck.skip

// Deliberately bad diff: hardcoded secret + weak hash + SQL injection.
// Any security agent should find at least one of these.
const SAMPLE_DIFF = `\
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,16 @@
+import { createHash } from 'crypto'
+import { db } from './db'
+
+const API_SECRET = 'hardcoded_secret_key_abc123'
+
+export function validateToken(token: string): boolean {
+  return token === API_SECRET
+}
+
+export function hashPassword(password: string): string {
+  return createHash('md5').update(password).digest('hex')
+}
+
+export async function getUserByEmail(email: string) {
+  return db.query(\`SELECT * FROM users WHERE email = '\${email}'\`)
+}
`

// Use two fast agents to keep the run under ~4 minutes.
const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  ollamaUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  agents: ['security', 'correctness'] as typeof DEFAULT_CONFIG.agents,
  maxFindings: 10
}

describe.skipIf(SKIP)(
  'E2E — full pipeline against live Ollama',
  () => {
    let result: ReviewResult

    beforeAll(async () => {
      const provider = new OllamaProvider(OLLAMA_URL, OLLAMA_MODEL)
      const runner = new SwarmRunner(TEST_CONFIG, provider)
      result = await runner.run({ diff: SAMPLE_DIFF })
    }, 300_000) // 5-minute cap for the swarm run

    it('produces at least one finding', () => {
      expect(result.findings).toBeInstanceOf(Array)
      expect(result.findings.length).toBeGreaterThan(0)
    })

    it('summary counters are consistent', () => {
      expect(result.summary.totalFindings).toBe(result.findings.length)
      expect(result.summary.durationMs).toBeGreaterThan(0)
    })

    it('every finding conforms to the Finding schema', () => {
      const SEVERITIES = ['critical', 'high', 'medium', 'low']
      const BASES = ['VERIFIED', 'INFERRED', 'SPECULATIVE']
      for (const f of result.findings) {
        expect(SEVERITIES, `unexpected severity on finding ${f.id}`).toContain(f.severity)
        expect(BASES, `unexpected basis on finding ${f.id}`).toContain(f.basis)
        expect(typeof f.title).toBe('string')
        expect(f.title.length).toBeGreaterThan(0)
        expect(typeof f.detail).toBe('string')
        expect(typeof f.suggestion).toBe('string')
      }
    })

    it('security agent flags at least one issue in the diff', () => {
      const securityFindings = result.findings.filter(f => f.agent === 'security')
      expect(
        securityFindings.length,
        'expected security agent to flag hardcoded secret, weak hash, or SQL injection'
      ).toBeGreaterThan(0)
    })
  }
)
