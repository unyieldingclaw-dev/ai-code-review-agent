import { readFileSync } from 'fs'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { SecurityAgent } from '../src/core/agents/security.js'
import { PerformanceAgent } from '../src/core/agents/performance.js'
import { CorrectnessAgent } from '../src/core/agents/correctness.js'
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
  { name: 'Security',    fixtureFile: 'calibration/fixtures/security.diff',    expectedKeyword: 'injection', baitKeyword: 'CONFIG_KEY' },
  { name: 'Performance', fixtureFile: 'calibration/fixtures/performance.diff', expectedKeyword: 'N+1',       baitKeyword: 'sumArray' },
  { name: 'Correctness', fixtureFile: 'calibration/fixtures/correctness.diff', expectedKeyword: 'off-by-one', baitKeyword: 'isAdult' }
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
    Security:    new SecurityAgent(provider, DEFAULT_CONFIG),
    Performance: new PerformanceAgent(provider, DEFAULT_CONFIG),
    Correctness: new CorrectnessAgent(provider, DEFAULT_CONFIG)
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
      console.log(`  ✅ PASS — found legitimate issue, rejected false positive`)
      passed++
    } else {
      if (!hasLegitimate) console.log(`  ❌ FAIL — missed legitimate ${c.expectedKeyword} finding`)
      if (hasBait) console.log(`  ❌ FAIL — false positive not filtered (${c.baitKeyword})`)
      failed++
    }
  }

  console.log(`\nCalibration: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
