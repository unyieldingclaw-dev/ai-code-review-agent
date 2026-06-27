import type { LLMProvider } from './llm/provider.js'
import type { ReviewConfig } from './config.js'
import type {
  AgentName,
  Severity,
  Finding,
  ReviewInput,
  ReviewResult,
  CoverageGap,
  GeneratedTestFile,
  AgentProgressEvent,
  SanitizerMetadata,
} from './schema.js'
import { SEVERITY_RANK } from './schema.js'
import { loadAgentContext, loadAgentContextSemantic } from './contextLoader.js'
import type { ContextResult } from './contextLoader.js'
import { loadIgnorePatterns, filterDiff } from './ignoreFilter.js'
import { evaluatePolicy, extractChangedFiles } from './policyFilter.js'
import { sanitizeDiff } from './sanitizer.js'
import { BreakingChangeAgent } from './agents/breakingChange.js'
import { LicenseComplianceAgent } from './agents/licenseCompliance.js'
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
import { ErrorHandlingAgent } from './agents/errorHandling.js'
import { ObservabilityAgent } from './agents/observability.js'
import { MigrationSafetyAgent, hasMigrationFiles } from './agents/migrationSafety.js'
import { SecretsAgent } from './agents/secrets.js'
import { ComplexityAgent } from './agents/complexity.js'

function withTimeout<T>(promise: Promise<T>, ms: number, agentName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent ${agentName} timed out after ${ms}ms`)), ms)
    ),
  ])
}

async function withRetryTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  agentName: string,
  attempts: number,
  backoffMs: number
): Promise<T> {
  let lastErr: Error = new Error('no attempts made')
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), timeoutMs, agentName)
    } catch (err) {
      lastErr = err as Error
      if (i < attempts - 1) {
        console.warn(
          `[ai-review] Agent ${agentName} failed (attempt ${i + 1}/${attempts}): ${lastErr.message} — retrying in ${backoffMs}ms`
        )
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }
  throw lastErr
}

function buildAgents(config: ReviewConfig, provider: LLMProvider): BaseAgent[] {
  const builders = new Map<AgentName, () => BaseAgent>([
    ['security', () => new SecurityAgent(provider, config)],
    ['performance', () => new PerformanceAgent(provider, config)],
    ['correctness', () => new CorrectnessAgent(provider, config)],
    ['design', () => new DesignAgent(provider, config)],
    ['dependencies', () => new DependenciesAgent(provider, config)],
    ['adversarial', () => new AdversarialAgent(provider, config)],
    ['integration', () => new IntegrationScoutAgent(provider, config)],
    ['breaking-change', () => new BreakingChangeAgent(provider, config)],
    ['license', () => new LicenseComplianceAgent(provider, config)],
    ['error-handling', () => new ErrorHandlingAgent(provider, config)],
    ['observability', () => new ObservabilityAgent(provider, config)],
    ['migration-safety', () => new MigrationSafetyAgent(provider, config)],
    ['secrets', () => new SecretsAgent(provider, config)],
    ['complexity', () => new ComplexityAgent(provider, config)],
  ])
  return config.agents
    .filter((a) => a !== 'testgen' && a !== 'coverage')
    .flatMap((a) => {
      const build = builders.get(a)
      if (!build) {
        console.warn(`[ai-review] Unknown agent "${a}" — skipping`)
        return []
      }
      return [build()]
    })
}

function shouldEarlyExit(config: ReviewConfig, allFindings: Finding[]): boolean {
  if (!config.failFast) return false
  const level = config.failOn ?? 'high'
  if (level === 'never') return false
  if (level === 'any') return allFindings.length > 0
  return allFindings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[level as Severity])
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

  // Handles ignore filtering, sanitization, and diff truncation.
  // Returns the (possibly modified) input and sanitizer metadata.
  private async preprocessDiff(
    input: ReviewInput
  ): Promise<{ input: ReviewInput; sanitizerMeta: SanitizerMetadata }> {
    // Path exclusions — filter files matching .aiignore or config.ignorePaths
    if (input.projectPath || this.config.ignorePaths.length > 0) {
      const patterns = loadIgnorePatterns(input.projectPath ?? '', this.config.ignorePaths)
      if (patterns.excludes.length > 0) {
        input = { ...input, diff: filterDiff(input.diff, patterns) }
      }
    }

    // Prompt injection sanitization — strip LLM-manipulating patterns from added lines
    let sanitizerMeta: SanitizerMetadata
    if (this.config.sanitize !== false) {
      const sanitizeResult = sanitizeDiff(input.diff)
      for (const w of sanitizeResult.warnings) {
        console.warn(`[ai-review] ${w}`)
      }
      if (sanitizeResult.applied) {
        input = { ...input, diff: sanitizeResult.sanitized }
      }
      sanitizerMeta = {
        enabled: true,
        applied: sanitizeResult.applied,
        redactedLines: sanitizeResult.redactedLines,
        warnings: sanitizeResult.warnings,
      }
    } else {
      process.stderr.write(
        '[ai-review] WARNING: --no-sanitize is active. Prompt injection from diff content is not prevented.\n'
      )
      sanitizerMeta = { enabled: false, applied: false, redactedLines: 0, warnings: [] }
    }

    // Diff size guard — truncate oversized diffs before sending to agents
    const diffLines = input.diff.split('\n').length
    if (diffLines > this.config.maxDiffLines) {
      console.warn(
        `[ai-review] diff is ${diffLines} lines (limit ${this.config.maxDiffLines}). ` +
          `Truncating to first ${this.config.maxDiffLines} lines.`
      )
      input = {
        ...input,
        diff: input.diff.split('\n').slice(0, this.config.maxDiffLines).join('\n'),
      }
    }

    return { input, sanitizerMeta }
  }

  // Runs the coverage agent with progress reporting and error handling.
  // Returns findings, coverage gaps, and whether an early exit was triggered.
  private async runCoverageAgent(
    agent: CoverageAnalystAgent,
    input: ReviewInput,
    ctx: (name: AgentName) => Promise<ReviewInput>,
    total: number,
    index: number,
    onProgress?: (e: AgentProgressEvent) => void
  ): Promise<{ findings: Finding[]; gaps: CoverageGap[]; earlyExit: boolean }> {
    const timeout = this.config.agentTimeoutMs
    const retryAttempts = this.config.retryAttempts
    const retryDelayMs = this.config.retryDelayMs

    onProgress?.({ phase: 'start', name: 'coverage', index, total })
    const startMs = Date.now()
    try {
      const coverageResult = await withRetryTimeout(
        async () => agent.runForCoverage(await ctx('coverage')),
        timeout,
        'coverage',
        retryAttempts,
        retryDelayMs
      )
      const findings = coverageResult.findings
      const gaps = coverageResult.gaps
      const earlyExit = shouldEarlyExit(this.config, findings)
      onProgress?.({
        phase: 'end',
        name: 'coverage',
        index,
        total,
        findings,
        elapsedMs: Date.now() - startMs,
        earlyExit,
      })
      return { findings, gaps, earlyExit }
    } catch (err) {
      console.warn(`[ai-review] Agent coverage timed out or failed: ${(err as Error).message}`)
      onProgress?.({
        phase: 'end',
        name: 'coverage',
        index,
        total,
        findings: [],
        elapsedMs: Date.now() - startMs,
      })
      return { findings: [], gaps: [], earlyExit: false }
    }
  }

  // Sequential execution loop — runs agents one at a time, stopping on early exit.
  private async runAgentsSequential(
    agents: BaseAgent[],
    ctx: (name: AgentName) => Promise<ReviewInput>,
    baseIndex: number,
    total: number,
    onProgress?: (e: AgentProgressEvent) => void
  ): Promise<{ findings: Finding[]; earlyExitAgent?: AgentName }> {
    const timeout = this.config.agentTimeoutMs
    const retryAttempts = this.config.retryAttempts
    const retryDelayMs = this.config.retryDelayMs

    const findings: Finding[] = []
    let earlyExitAgent: AgentName | undefined
    let index = baseIndex

    for (const agent of agents) {
      index++
      onProgress?.({ phase: 'start', name: agent.name, index, total })
      const startMs = Date.now()
      try {
        const agentFindings = await withRetryTimeout(
          async () => agent.run(await ctx(agent.name)),
          timeout,
          agent.name,
          retryAttempts,
          retryDelayMs
        )
        findings.push(...agentFindings)
        const shouldStop = shouldEarlyExit(this.config, findings)
        onProgress?.({
          phase: 'end',
          name: agent.name,
          index,
          total,
          findings: agentFindings,
          elapsedMs: Date.now() - startMs,
          earlyExit: shouldStop,
        })
        if (shouldStop) {
          earlyExitAgent = agent.name
          break
        }
      } catch (err) {
        console.warn(
          `[ai-review] Agent ${agent.name} timed out or failed: ${(err as Error).message}`
        )
        onProgress?.({
          phase: 'end',
          name: agent.name,
          index,
          total,
          findings: [],
          elapsedMs: Date.now() - startMs,
        })
      }
    }

    return { findings, earlyExitAgent }
  }

  // Parallel execution block — runs all agents concurrently, collects findings.
  private async runAgentsParallel(
    agents: BaseAgent[],
    ctx: (name: AgentName) => Promise<ReviewInput>,
    baseIndex: number,
    total: number,
    onProgress?: (e: AgentProgressEvent) => void
  ): Promise<Finding[]> {
    const timeout = this.config.agentTimeoutMs
    const retryAttempts = this.config.retryAttempts
    const retryDelayMs = this.config.retryDelayMs

    const findings: Finding[] = []

    agents.forEach((agent, i) => {
      onProgress?.({ phase: 'start', name: agent.name, index: baseIndex + i + 1, total })
    })

    await Promise.allSettled(
      agents.map(async (agent, i) => {
        const agentIndex = baseIndex + i + 1
        const startMs = Date.now()
        try {
          const agentFindings = await withRetryTimeout(
            async () => agent.run(await ctx(agent.name)),
            timeout,
            agent.name,
            retryAttempts,
            retryDelayMs
          )
          findings.push(...agentFindings)
          onProgress?.({
            phase: 'end',
            name: agent.name,
            index: agentIndex,
            total,
            findings: agentFindings,
            elapsedMs: Date.now() - startMs,
          })
        } catch (err) {
          console.warn(
            `[ai-review] Agent ${agent.name} timed out or failed: ${(err as Error).message}`
          )
          onProgress?.({
            phase: 'end',
            name: agent.name,
            index: agentIndex,
            total,
            findings: [],
            elapsedMs: Date.now() - startMs,
          })
        }
      })
    )

    return findings
  }

  // Aggregates findings into bySeverity and byAgent counts for the result summary.
  private buildSummary(findings: Finding[], durationMs: number): ReviewResult['summary'] {
    const bySeverity = findings.reduce(
      (acc, f) => {
        acc[f.severity] = (acc[f.severity] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const byAgent = findings.reduce(
      (acc, f) => {
        acc[f.agent] = (acc[f.agent] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    return { totalFindings: findings.length, bySeverity, byAgent, durationMs }
  }

  async run(
    input: ReviewInput,
    onProgress?: (event: AgentProgressEvent) => void,
    contextMode: 'none' | 'memory-bank' = 'none'
  ): Promise<ReviewResult> {
    const ping = await this.provider.ping()
    if (!ping.ok) throw new Error(ping.error ?? 'LLM provider not available')

    // Preprocess: ignore filtering, sanitization, truncation
    const preprocessed = await this.preprocessDiff(input)
    input = preprocessed.input
    const sanitizerMeta = preprocessed.sanitizerMeta

    const start = Date.now()
    const allFindings: Finding[] = []
    let coverageGaps: CoverageGap[] = []
    let testFiles: GeneratedTestFile[] = []

    // Context tracking — accumulate across all agents for the final metadata block
    const allFilesLoaded: string[] = []
    let anyTruncated = false
    let totalTokens = 0

    // Helper: build per-agent ReviewInput with optional context prepended
    const withContext = async (agentName: AgentName): Promise<ReviewInput> => {
      if (contextMode !== 'memory-bank' || !input.projectPath) return input
      const ctx: ContextResult =
        this.config.contextMode === 'semantic'
          ? await loadAgentContextSemantic(
              input.projectPath,
              input.diff,
              this.config.ollamaUrl,
              this.config.contextBudgetChars
            )
          : loadAgentContext(input.projectPath, agentName, this.config.contextBudgetChars)
      if (ctx.filesLoaded.length > 0) {
        allFilesLoaded.push(...ctx.filesLoaded)
        if (ctx.truncated) anyTruncated = true
        totalTokens += ctx.estimatedTokens
      }
      return ctx.content ? { ...input, context: ctx.content } : input
    }

    // Determine which agents will run — hoist before coverage so total is known upfront
    const activeConfig =
      this.config.agents.includes('migration-safety') && !hasMigrationFiles(input.diff)
        ? { ...this.config, agents: this.config.agents.filter((a) => a !== 'migration-safety') }
        : this.config

    // Policy filtering — per-agent include/exclude path rules
    const changedFiles = extractChangedFiles(input.diff)
    const { allowed: allowedAgents, policy: policyResult } = evaluatePolicy(
      activeConfig.agents,
      changedFiles,
      this.config
    )
    const policyConfig =
      allowedAgents.length !== activeConfig.agents.length
        ? { ...activeConfig, agents: allowedAgents }
        : activeConfig

    const agents = buildAgents(policyConfig, this.provider)
    const hasCoverage = allowedAgents.includes('coverage')
    const hasTestgen = allowedAgents.includes('testgen')
    const total = agents.length + (hasCoverage ? 1 : 0) + (hasTestgen ? 1 : 0)

    let index = 0
    let earlyExitAgent: AgentName | undefined

    // Run CoverageAnalyst first if enabled (TestGen depends on it)
    if (hasCoverage) {
      index++
      const coverageAgent = new CoverageAnalystAgent(this.provider, this.config)
      const coverageResult = await this.runCoverageAgent(
        coverageAgent,
        input,
        withContext,
        total,
        index,
        onProgress
      )
      allFindings.push(...coverageResult.findings)
      coverageGaps = coverageResult.gaps
      if (coverageResult.earlyExit) earlyExitAgent = 'coverage'
    }

    // Run specialist agents — parallel or sequential
    if (!earlyExitAgent) {
      const baseIndex = hasCoverage ? 1 : 0
      if (this.config.parallel) {
        const parallelFindings = await this.runAgentsParallel(
          agents,
          withContext,
          baseIndex,
          total,
          onProgress
        )
        allFindings.push(...parallelFindings)
        index += agents.length
      } else {
        const seqResult = await this.runAgentsSequential(
          agents,
          withContext,
          baseIndex,
          total,
          onProgress
        )
        allFindings.push(...seqResult.findings)
        index = baseIndex + agents.length
        earlyExitAgent = seqResult.earlyExitAgent
      }
    }

    // Run TestGen if enabled — skip entirely on early exit
    if (!earlyExitAgent && hasTestgen) {
      index++
      onProgress?.({ phase: 'start', name: 'testgen', index, total })
      const startMs = Date.now()
      if (coverageGaps.length > 0) {
        try {
          const testResult = await withRetryTimeout(
            async () => this.testGen.runWithGaps(await withContext('testgen'), coverageGaps),
            this.config.agentTimeoutMs,
            'testgen',
            this.config.retryAttempts,
            this.config.retryDelayMs
          )
          testFiles = testResult.testFiles
        } catch (err) {
          console.warn(`[ai-review] Agent testgen timed out or failed: ${(err as Error).message}`)
        }
      }
      onProgress?.({
        phase: 'end',
        name: 'testgen',
        index,
        total,
        findings: [],
        elapsedMs: Date.now() - startMs,
      })
    }

    const findings = this.orchestrator.synthesize(allFindings)

    return {
      findings,
      testFiles,
      summary: this.buildSummary(findings, Date.now() - start),
      ...(earlyExitAgent ? { earlyExit: { stoppedAt: earlyExitAgent } } : {}),
      ...(contextMode === 'memory-bank'
        ? {
            context: {
              mode: 'memory-bank' as const,
              filesLoaded: [...new Set(allFilesLoaded)],
              truncated: anyTruncated,
              estimatedTokens: totalTokens,
            },
          }
        : {}),
      sanitizer: sanitizerMeta,
      ...(policyResult.agentsSkipped.length > 0 ? { policy: policyResult } : {}),
    }
  }
}
