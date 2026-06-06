import type { LLMProvider } from './llm/provider.js'
import type { ReviewConfig } from './config.js'
import type { AgentName, Finding, ReviewInput, ReviewResult, CoverageGap, GeneratedTestFile } from './schema.js'
import { BaseAgent } from './agents/base.js'
import { SecurityAgent } from './agents/security.js'
import { PerformanceAgent } from './agents/performance.js'
import { CorrectnessAgent } from './agents/correctness.js'
import { DesignAgent } from './agents/design.js'
import { DependenciesAgent } from './agents/dependencies.js'
import { CoverageAnalystAgent } from './agents/coverageAnalyst.js'
import { TestGenAgent } from './agents/testGen.js'
import { AdversarialAgent } from './agents/adversarial.js'
import { IntegrationScoutAgent } from './agents/integrationScout.js'
import { OrchestratorAgent } from './agents/orchestrator.js'

function withTimeout<T>(promise: Promise<T>, ms: number, agentName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent ${agentName} timed out after ${ms}ms`)), ms)
    )
  ])
}

function buildAgents(config: ReviewConfig, provider: LLMProvider): BaseAgent[] {
  const map: Record<Exclude<AgentName, 'testgen' | 'coverage'>, () => BaseAgent> = {
    security: () => new SecurityAgent(provider, config),
    performance: () => new PerformanceAgent(provider, config),
    correctness: () => new CorrectnessAgent(provider, config),
    design: () => new DesignAgent(provider, config),
    dependencies: () => new DependenciesAgent(provider, config),
    adversarial: () => new AdversarialAgent(provider, config),
    integration: () => new IntegrationScoutAgent(provider, config)
  }
  return config.agents
    .filter((a): a is Exclude<AgentName, 'testgen' | 'coverage'> => a !== 'testgen' && a !== 'coverage')
    .map(a => map[a]())
}

export class SwarmRunner {
  private readonly orchestrator: OrchestratorAgent
  private readonly testGen: TestGenAgent

  constructor(
    private readonly config: ReviewConfig,
    private readonly provider: LLMProvider
  ) {
    this.orchestrator = new OrchestratorAgent(provider, config)
    this.testGen = new TestGenAgent(provider, config)
  }

  async run(
    input: ReviewInput,
    onProgress?: (agent: AgentName) => void
  ): Promise<ReviewResult> {
    const ping = await this.provider.ping()
    if (!ping.ok) throw new Error(ping.error ?? 'LLM provider not available')

    // Diff size guard — truncate oversized diffs before sending to agents
    const diffLines = input.diff.split('\n').length
    if (diffLines > this.config.maxDiffLines) {
      console.warn(
        `[ai-review] diff is ${diffLines} lines (limit ${this.config.maxDiffLines}). ` +
        `Truncating to first ${this.config.maxDiffLines} lines.`
      )
      input = { ...input, diff: input.diff.split('\n').slice(0, this.config.maxDiffLines).join('\n') }
    }

    const start = Date.now()
    const allFindings: Finding[] = []
    let coverageGaps: CoverageGap[] = []
    let testFiles: GeneratedTestFile[] = []

    const timeout = this.config.agentTimeoutMs

    // Run CoverageAnalyst first if enabled (TestGen depends on it)
    if (this.config.agents.includes('coverage')) {
      onProgress?.('coverage')
      const coverageAgent = new CoverageAnalystAgent(this.provider, this.config)
      try {
        const coverageResult = await withTimeout(coverageAgent.runForCoverage(input), timeout, 'coverage')
        allFindings.push(...coverageResult.findings)
        coverageGaps = coverageResult.gaps
      } catch (err) {
        console.warn(`[ai-review] Agent coverage timed out or failed: ${(err as Error).message}`)
      }
    }

    // Run remaining specialist agents
    const agents = buildAgents(this.config, this.provider)
    for (const agent of agents) {
      onProgress?.(agent.name)
      try {
        const findings = await withTimeout(agent.run(input), timeout, agent.name)
        allFindings.push(...findings)
      } catch (err) {
        console.warn(`[ai-review] Agent ${agent.name} timed out or failed: ${(err as Error).message}`)
      }
    }

    // Run TestGen if enabled — always fire onProgress, only call LLM when there are gaps
    if (this.config.agents.includes('testgen')) {
      onProgress?.('testgen')
      if (coverageGaps.length > 0) {
        try {
          const testResult = await withTimeout(this.testGen.runWithGaps(input, coverageGaps), timeout, 'testgen')
          testFiles = testResult.testFiles
        } catch (err) {
          console.warn(`[ai-review] Agent testgen timed out or failed: ${(err as Error).message}`)
        }
      }
    }

    const findings = this.orchestrator.synthesize(allFindings)

    const bySeverity = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    const byAgent = findings.reduce((acc, f) => {
      acc[f.agent] = (acc[f.agent] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      findings,
      testFiles,
      summary: {
        totalFindings: findings.length,
        bySeverity,
        byAgent,
        durationMs: Date.now() - start
      }
    }
  }
}
