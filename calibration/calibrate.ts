import { readFileSync } from 'fs'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import { extractChangedFiles } from '../src/core/policyFilter.js'
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
  // Key into agentMap. Defaults to `name` -- only needed when a single agent has more than one
  // case (name must stay unique per case for the printed log line, agentMap keys don't).
  agentName?: string
  fixtureFile: string
  // Either (expectedKeyword + baitKeyword) for "must find X, must not find Y", or expectEmpty
  // for "this fixture has nothing this agent should report on -- must return zero findings".
  expectedKeyword?: string
  baitKeyword?: string
  expectEmpty?: boolean
}

const BORDER = '╔════════════════════════════════════════════════════════════╗'
const BORDER_BOT = '╚════════════════════════════════════════════════════════════╝'

function pad(t: string, w: number): string {
  return t + ' '.repeat(Math.max(0, w - t.length))
}

function printBox(lines: string[]): void {
  process.stderr.write('\n' + BORDER + '\n')
  for (const l of lines) process.stderr.write(`║  ${pad(l, 56)}║\n`)
  process.stderr.write(BORDER_BOT + '\n\n')
}

const CASES: CalibrationCase[] = [
  {
    name: 'security',
    fixtureFile: 'calibration/fixtures/security.diff',
    expectedKeyword: 'injection',
    baitKeyword: 'CONFIG_KEY',
  },
  {
    name: 'performance',
    fixtureFile: 'calibration/fixtures/performance.diff',
    expectedKeyword: 'N+1',
    baitKeyword: 'sumArray',
  },
  {
    name: 'correctness',
    fixtureFile: 'calibration/fixtures/correctness.diff',
    expectedKeyword: 'off-by-one',
    baitKeyword: 'isAdult',
  },
  {
    name: 'design',
    fixtureFile: 'calibration/fixtures/design.diff',
    expectedKeyword: 'responsibility',
    baitKeyword: 'formatCurrency',
  },
  {
    // This fixture touches package.json, so once projectPath is set below, DependenciesAgent's
    // run() override routes it through the real npm-audit tool path instead of the LLM -- the
    // agent no longer sees this fixture's fabricated "lodash wildcard" text at all, so the
    // expectations here assert against real npm audit output (a known vulnerability report),
    // not the diff's own bait content.
    name: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies.diff',
    expectedKeyword: 'vulnerability',
    baitKeyword: 'wildcard',
  },
  {
    // Regression case for a real hallucination bug: dependencies.ts's prompt used to carry a
    // concrete "lodash wildcard version" example as its REQUIRED OUTPUT FORMAT, which the model
    // reproduced near-verbatim (including its literal unfilled placeholder text) when a diff had
    // nothing dependency-related to report. This fixture has zero dependency content -- the
    // agent must return nothing, not echo the prompt's old example.
    name: 'dependencies-clean',
    agentName: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies-clean.diff',
    expectEmpty: true,
  },
  {
    name: 'adversarial',
    fixtureFile: 'calibration/fixtures/adversarial.diff',
    expectedKeyword: 'empty',
    baitKeyword: 'trimOrDefault',
  },
  {
    name: 'integration',
    fixtureFile: 'calibration/fixtures/integration.diff',
    expectedKeyword: 'integration',
    baitKeyword: 'buildPayload',
  },
  {
    name: 'coverage',
    fixtureFile: 'calibration/fixtures/coverage.diff',
    expectedKeyword: 'processRefund',
    baitKeyword: 'getVersion',
  },
  {
    name: 'breaking-change',
    fixtureFile: 'calibration/fixtures/breaking-change.diff',
    expectedKeyword: 'parameter',
    baitKeyword: '_formatUser',
  },
  {
    name: 'license',
    fixtureFile: 'calibration/fixtures/license.diff',
    expectedKeyword: 'lgpl',
    baitKeyword: 'chalk',
  },
  {
    // Regression case for the same class of hallucination bug as dependencies-clean above:
    // license.ts's prompt used to carry a concrete "package.json:14" line number in its REQUIRED
    // OUTPUT FORMAT example (plus a concrete MongoDB mention in its SSPL rule text), which the
    // model could echo back as a fabricated finding on a diff with nothing to report. This
    // fixture only adds a permissive-licensed (MIT) package -- the agent must return nothing.
    name: 'license-clean',
    agentName: 'license',
    fixtureFile: 'calibration/fixtures/license-clean.diff',
    expectEmpty: true,
  },
  {
    name: 'error-handling',
    fixtureFile: 'calibration/fixtures/error-handling.diff',
    expectedKeyword: 'swallowed',
    baitKeyword: 'loadUserPreferences',
  },
  {
    name: 'observability',
    fixtureFile: 'calibration/fixtures/observability.diff',
    expectedKeyword: 'logging',
    baitKeyword: 'formatDate',
  },
  {
    name: 'migration-safety',
    fixtureFile: 'calibration/fixtures/migration-safety.diff',
    expectedKeyword: 'not null',
    baitKeyword: 'idx_users_email',
  },
  {
    name: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets.diff',
    expectedKeyword: 'password',
    baitKeyword: 'REPLACE_WITH_REAL_KEY',
  },
  {
    // Regression case for a real false positive reported against a Flutter/Dart project: a
    // "password"-named identifier is not itself a finding -- the agent must check the VALUE
    // assigned to it (see secrets.ts's value-shape rule). This fixture has zero real secrets --
    // just a boolean UI-toggle flag and a controller reference, both merely named "password".
    name: 'secrets-value-shape',
    agentName: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets-value-shape.diff',
    expectEmpty: true,
  },
  {
    // SecretsAgent's run() override routes any diff whose changed file exists on disk through
    // gitleaks instead of the LLM. gitleaksParser maps title/detail from gitleaks' own rule
    // metadata (RuleID/Description), not fixture-specific text -- --redact means `evidence` is
    // always the literal string "REDACTED", so the keyword must match what gitleaks itself
    // reports for this rule, not the fixture's own "not a real secret" comment.
    name: 'secrets-gitleaks',
    agentName: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets-gitleaks.diff',
    expectedKeyword: 'generic api key',
    baitKeyword: 'AWS_SESSION_TOKEN',
  },
  {
    name: 'complexity',
    fixtureFile: 'calibration/fixtures/complexity.diff',
    expectedKeyword: 'complexity',
    baitKeyword: 'formatAddress',
  },
]

async function main() {
  // Override which model calibration runs against without editing config.ts -- e.g. to bake
  // off a candidate model's finding quality: CALIBRATION_MODEL=qwen3:latest npm run calibrate
  const model = process.env.CALIBRATION_MODEL || DEFAULT_CONFIG.model
  const provider = new OllamaProvider(DEFAULT_CONFIG.ollamaUrl, model)

  // Check 1: Ollama reachable
  const ping = await provider.ping()
  if (!ping.ok) {
    printBox([
      'CALIBRATION SKIPPED — Ollama not reachable',
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. npm run calibrate',
    ])
    process.exit(1)
  }

  // Check 2: Required model is pulled
  try {
    const res = await fetch(`${DEFAULT_CONFIG.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    const data = (await res.json()) as { models: Array<{ name: string }> }
    if (!data.models.some((m) => m.name === model)) {
      printBox([
        'CALIBRATION SKIPPED — model not available',
        '',
        `  Required model: ${model}`,
        '  Ollama is running but this model is not pulled.',
        '',
        'Solution:',
        `  ollama pull ${model}`,
        '  then: npm run calibrate',
      ])
      process.exit(1)
    }
  } catch {
    printBox(['CALIBRATION SKIPPED — could not verify model list'])
    process.exit(1)
  }

  const orch = new OrchestratorAgent(DEFAULT_CONFIG)
  const agentMap: Record<string, BaseAgent> = {
    security: new SecurityAgent(provider, DEFAULT_CONFIG),
    performance: new PerformanceAgent(provider, DEFAULT_CONFIG),
    correctness: new CorrectnessAgent(provider, DEFAULT_CONFIG),
    design: new DesignAgent(provider, DEFAULT_CONFIG),
    dependencies: new DependenciesAgent(provider, DEFAULT_CONFIG),
    adversarial: new AdversarialAgent(provider, DEFAULT_CONFIG),
    integration: new IntegrationScoutAgent(provider, DEFAULT_CONFIG),
    coverage: new CoverageAnalystAgent(provider, DEFAULT_CONFIG),
    'breaking-change': new BreakingChangeAgent(provider, DEFAULT_CONFIG),
    license: new LicenseComplianceAgent(provider, DEFAULT_CONFIG),
    'error-handling': new ErrorHandlingAgent(provider, DEFAULT_CONFIG),
    observability: new ObservabilityAgent(provider, DEFAULT_CONFIG),
    'migration-safety': new MigrationSafetyAgent(provider, DEFAULT_CONFIG),
    secrets: new SecretsAgent(provider, DEFAULT_CONFIG),
    complexity: new ComplexityAgent(provider, DEFAULT_CONFIG),
  }

  let passed = 0
  let failed = 0

  for (const c of CASES) {
    process.stdout.write(`\nRunning calibration: ${c.name}...\n`)
    const diff = readFileSync(c.fixtureFile, 'utf-8')
    try {
      const rawFindings: Finding[] = await agentMap[c.agentName ?? c.name].run({
        diff,
        projectPath: process.cwd(),
      })
      // Exercise the same file-existence defense runner.ts applies in real usage, so
      // calibration reflects actual end-to-end behavior, not just the raw agent's output.
      const findings = orch.synthesize(rawFindings, extractChangedFiles(diff))

      if (c.expectEmpty) {
        if (findings.length === 0) {
          console.log(`  ✅ PASS — correctly reported no findings`)
          passed++
        } else {
          console.log(
            `  ❌ FAIL — expected zero findings, got ${findings.length}: ` +
              findings.map((f) => `"${f.title}"`).join(', ')
          )
          failed++
        }
        continue
      }

      const hasLegitimate = findings.some(
        (f) =>
          f.title.toLowerCase().includes(c.expectedKeyword!.toLowerCase()) ||
          f.detail.toLowerCase().includes(c.expectedKeyword!.toLowerCase())
      )
      const hasBait = findings.some(
        (f) => f.title.includes(c.baitKeyword!) || f.detail.includes(c.baitKeyword!)
      )

      if (hasLegitimate && !hasBait) {
        console.log(`  ✅ PASS — found '${c.expectedKeyword}', rejected '${c.baitKeyword}'`)
        passed++
      } else {
        if (!hasLegitimate) console.log(`  ❌ FAIL — missed '${c.expectedKeyword}'`)
        if (hasBait) console.log(`  ❌ FAIL — false positive '${c.baitKeyword}'`)
        failed++
      }
    } catch (err) {
      console.log(`  ❌ FAIL — agent error: ${(err as Error).message}`)
      failed++
    }
  }

  // TestGen: verify test generation from gaps
  {
    process.stdout.write(`\nRunning calibration: testgen...\n`)
    try {
      const diff = readFileSync('calibration/fixtures/testgen.diff', 'utf-8')
      const testGen = new TestGenAgent(provider, DEFAULT_CONFIG)
      const { testFiles } = await testGen.runWithGaps({ diff }, [
        {
          file: 'src/billing/invoice.ts',
          functionName: 'calculateTax',
          lineStart: 1,
          lineEnd: 9,
          description:
            'Calculates tax by multiplying subtotal by taxRate, rounds to 2 decimal places. Validates taxRate is 0-1.',
        },
      ])
      const hasTestContent =
        testFiles.length > 0 && testFiles[0].content.toLowerCase().includes('calculatetax')
      if (hasTestContent) {
        console.log(`  ✅ PASS — generated test file with calculateTax coverage`)
        passed++
      } else {
        console.log(`  ❌ FAIL — no test content generated for calculateTax`)
        failed++
      }
    } catch (err) {
      console.log(`  ❌ FAIL — agent error: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\nCalibration [${model}]: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
