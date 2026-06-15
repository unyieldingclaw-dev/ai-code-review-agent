import { readFileSync } from 'fs'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { SecurityAgent } from '../src/core/agents/security.js'
import { PerformanceAgent } from '../src/core/agents/performance.js'
import { CorrectnessAgent } from '../src/core/agents/correctness.js'
import { DesignAgent } from '../src/core/agents/design.js'
import { DependenciesAgent } from '../src/core/agents/dependencies.js'
import { AdversarialAgent } from '../src/core/agents/adversarial.js'
import { IntegrationScoutAgent } from '../src/core/agents/integrationScout.js'
import { CoverageAnalystAgent } from '../src/core/agents/coverageAnalyst.js'
import { TestGenAgent } from '../src/core/agents/testGen.js'
import { BreakingChangeAgent } from '../src/core/agents/breakingChange.js'
import { LicenseComplianceAgent } from '../src/core/agents/licenseCompliance.js'
import { ErrorHandlingAgent } from '../src/core/agents/errorHandling.js'
import { ObservabilityAgent } from '../src/core/agents/observability.js'
import { MigrationSafetyAgent } from '../src/core/agents/migrationSafety.js'
import { SecretsAgent } from '../src/core/agents/secrets.js'
import { ComplexityAgent } from '../src/core/agents/complexity.js'
import { OrchestratorAgent } from '../src/core/agents/orchestrator.js'
import { BaseAgent } from '../src/core/agents/base.js'
import type { Finding } from '../src/core/schema.js'

interface CalibrationCase {
  name: string
  fixtureFile: string
  expectedKeyword: string
  baitKeyword: string
}

const CASES: CalibrationCase[] = [
  { name: 'security',        fixtureFile: 'calibration/fixtures/security.diff',        expectedKeyword: 'injection',      baitKeyword: 'CONFIG_KEY' },
  { name: 'performance',     fixtureFile: 'calibration/fixtures/performance.diff',      expectedKeyword: 'N+1',            baitKeyword: 'sumArray' },
  { name: 'correctness',     fixtureFile: 'calibration/fixtures/correctness.diff',      expectedKeyword: 'off-by-one',     baitKeyword: 'isAdult' },
  { name: 'design',          fixtureFile: 'calibration/fixtures/design.diff',           expectedKeyword: 'responsibility', baitKeyword: 'formatCurrency' },
  { name: 'dependencies',    fixtureFile: 'calibration/fixtures/dependencies.diff',     expectedKeyword: 'wildcard',       baitKeyword: 'color-thief' },
  { name: 'adversarial',     fixtureFile: 'calibration/fixtures/adversarial.diff',      expectedKeyword: 'empty',          baitKeyword: 'trimOrDefault' },
  { name: 'integration',     fixtureFile: 'calibration/fixtures/integration.diff',      expectedKeyword: 'integration',    baitKeyword: 'buildPayload' },
  { name: 'coverage',        fixtureFile: 'calibration/fixtures/coverage.diff',         expectedKeyword: 'processRefund',  baitKeyword: 'getVersion' },
  { name: 'breaking-change', fixtureFile: 'calibration/fixtures/breaking-change.diff',  expectedKeyword: 'parameter',      baitKeyword: '_formatUser' },
  { name: 'license',         fixtureFile: 'calibration/fixtures/license.diff',          expectedKeyword: 'lgpl',           baitKeyword: 'chalk' },
  { name: 'error-handling',  fixtureFile: 'calibration/fixtures/error-handling.diff',   expectedKeyword: 'swallowed',       baitKeyword: 'loadUserPreferences' },
  { name: 'observability',   fixtureFile: 'calibration/fixtures/observability.diff',    expectedKeyword: 'logging',         baitKeyword: 'formatDate' },
  { name: 'migration-safety',fixtureFile: 'calibration/fixtures/migration-safety.diff', expectedKeyword: 'not null',        baitKeyword: 'idx_users_email' },
  { name: 'secrets',         fixtureFile: 'calibration/fixtures/secrets.diff',          expectedKeyword: 'password',        baitKeyword: 'REPLACE_WITH_REAL_KEY' },
  { name: 'complexity',      fixtureFile: 'calibration/fixtures/complexity.diff',        expectedKeyword: 'complexity',      baitKeyword: 'formatAddress' },
]

async function main() {
  const provider = new OllamaProvider(DEFAULT_CONFIG.ollamaUrl, DEFAULT_CONFIG.model)
  const ping = await provider.ping()
  if (!ping.ok) {
    console.error(`❌ Ollama not available: ${ping.error}`)
    process.exit(1)
  }

  const orch = new OrchestratorAgent(provider, DEFAULT_CONFIG)
  const agentMap: Record<string, BaseAgent> = {
    'security':        new SecurityAgent(provider, DEFAULT_CONFIG),
    'performance':     new PerformanceAgent(provider, DEFAULT_CONFIG),
    'correctness':     new CorrectnessAgent(provider, DEFAULT_CONFIG),
    'design':          new DesignAgent(provider, DEFAULT_CONFIG),
    'dependencies':    new DependenciesAgent(provider, DEFAULT_CONFIG),
    'adversarial':     new AdversarialAgent(provider, DEFAULT_CONFIG),
    'integration':     new IntegrationScoutAgent(provider, DEFAULT_CONFIG),
    'coverage':        new CoverageAnalystAgent(provider, DEFAULT_CONFIG),
    'breaking-change':  new BreakingChangeAgent(provider, DEFAULT_CONFIG),
    'license':          new LicenseComplianceAgent(provider, DEFAULT_CONFIG),
    'error-handling':   new ErrorHandlingAgent(provider, DEFAULT_CONFIG),
    'observability':    new ObservabilityAgent(provider, DEFAULT_CONFIG),
    'migration-safety': new MigrationSafetyAgent(provider, DEFAULT_CONFIG),
    'secrets':          new SecretsAgent(provider, DEFAULT_CONFIG),
    'complexity':       new ComplexityAgent(provider, DEFAULT_CONFIG),
  }

  let passed = 0
  let failed = 0

  for (const c of CASES) {
    process.stdout.write(`\nRunning calibration: ${c.name}...\n`)
    const diff = readFileSync(c.fixtureFile, 'utf-8')
    const rawFindings: Finding[] = await agentMap[c.name].run({ diff })
    const findings = orch.synthesize(rawFindings)

    const hasLegitimate = findings.some(f =>
      f.title.toLowerCase().includes(c.expectedKeyword.toLowerCase()) ||
      f.detail.toLowerCase().includes(c.expectedKeyword.toLowerCase())
    )
    const hasBait = findings.some(f =>
      f.title.includes(c.baitKeyword) || f.detail.includes(c.baitKeyword)
    )

    if (hasLegitimate && !hasBait) {
      console.log(`  ✅ PASS — found '${c.expectedKeyword}', rejected '${c.baitKeyword}'`)
      passed++
    } else {
      if (!hasLegitimate) console.log(`  ❌ FAIL — missed '${c.expectedKeyword}'`)
      if (hasBait) console.log(`  ❌ FAIL — false positive '${c.baitKeyword}'`)
      failed++
    }
  }

  // TestGen: verify test generation from gaps
  {
    process.stdout.write(`\nRunning calibration: testgen...\n`)
    const diff = readFileSync('calibration/fixtures/testgen.diff', 'utf-8')
    const testGen = new TestGenAgent(provider, DEFAULT_CONFIG)
    const { testFiles } = await testGen.runWithGaps(
      { diff },
      [{ file: 'src/billing/invoice.ts', functionName: 'calculateTax', lineStart: 1, lineEnd: 9,
         description: 'Calculates tax by multiplying subtotal by taxRate, rounds to 2 decimal places. Validates taxRate is 0-1.' }]
    )
    const hasTestContent = testFiles.length > 0 && testFiles[0].content.toLowerCase().includes('calculatetax')
    if (hasTestContent) {
      console.log(`  ✅ PASS — generated test file with calculateTax coverage`)
      passed++
    } else {
      console.log(`  ❌ FAIL — no test content generated for calculateTax`)
      failed++
    }
  }

  console.log(`\nCalibration: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
