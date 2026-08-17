import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName, FailOnLevel, Severity } from './schema.js'

export interface ReviewConfig {
  model: string
  provider: 'ollama'
  ollamaUrl: string
  maxFindings: number
  agents: AgentName[]
  testOutputDir: string
  maxDiffLines: number
  agentTimeoutMs: number
  timeoutScalingEnabled: boolean
  retryAttempts: number
  retryDelayMs: number
  ignorePaths: string[]
  sanitize: boolean
  contextBudgetChars: number
  contextMode?: 'static' | 'semantic'
  complexityThreshold?: number
  failFast: boolean
  failOn: FailOnLevel
  parallel: boolean
  // WHY opt-in, off by default: splitting an oversized diff into multiple maxDiffLines-sized
  // passes achieves full coverage instead of silently dropping lines past the truncation point,
  // but multiplies LLM calls by chunk count -- imposing that cost on every oversized diff by
  // default would conflict with this project's default-path efficiency goal. Read only by
  // cli/index.ts and chunkRunner.ts -- SwarmRunner.run() has no knowledge of this field. See
  // docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
  chunk: boolean
  agentPolicy?: Partial<
    Record<
      AgentName,
      {
        include?: string[] // agent only runs if a changed file matches at least one pattern
        exclude?: string[] // agent is skipped if ALL changed files match exclude patterns
      }
    >
  >
  verifyEvidence?: boolean
  verifierModel?: string
  // Minimum severity runEvidenceChecks will check. Default 'high' (critical+high only) keeps the
  // original design's scoping (docs/superpowers/specs/2026-08-10-evidence-grounding-verification-
  // design.md's Non-Goals: no evidence lower-severity findings cause comparable real-world harm,
  // and checking every finding scales latency with total finding count instead of what's actually
  // at stake). Configurable rather than hardcoded so a caller who wants deeper coverage can opt in
  // and accept that added cost themselves, without it changing for everyone else -- see
  // CHANGELOG.md's entry for this field for the measurement behind keeping the default unchanged.
  verifyEvidenceSeverity?: Severity
}

export const DEFAULT_CONFIG: ReviewConfig = {
  model: 'devstral:latest',
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  maxFindings: 15,
  agents: [
    'security',
    'performance',
    'correctness',
    'design',
    'dependencies',
    'coverage',
    'adversarial',
    'integration',
    'breaking-change',
    'license',
    'error-handling',
    'observability',
    'migration-safety',
    'secrets',
    'complexity',
  ],
  testOutputDir: './ai-review-tests',
  maxDiffLines: 2000,
  // 60s was too tight for devstral:latest (23.6B) on VRAM-constrained hardware where it's
  // partially CPU-offloaded — a realistic diff-sized prompt can take well over a minute to
  // generate. 180s aligns with the 5-minute ceiling OllamaProvider already assumed
  // (DEFAULT_TIMEOUT_MS) without being needlessly long for fast hardware.
  agentTimeoutMs: 180000,
  // WHY on by default: a diff at the maxDiffLines truncation point takes meaningfully longer
  // for the model to process than a small one, but agentTimeoutMs was flat regardless of size
  // -- a real bug report hit this (488s wall time, all 4 agents timing out, on a diff truncated
  // to 2000 lines). Scaling up to 2x agentTimeoutMs as diff size approaches maxDiffLines gives
  // large diffs more headroom without changing behavior for small ones. Disabled automatically
  // when --timeout is passed explicitly -- an explicit override means the user wants exactly
  // that value, not a scaled one.
  timeoutScalingEnabled: true,
  retryAttempts: 2,
  retryDelayMs: 2000,
  ignorePaths: [],
  sanitize: true,
  contextBudgetChars: 4000,
  contextMode: 'static',
  failFast: false,
  failOn: 'high',
  // WHY false by default: a "parallel by default" change was implemented and empirically tested
  // in depth (2026-07-25) before being reverted -- see memory-bank/systemPatterns.md's "Parallel
  // Execution" section for the full investigation and data. Short version: an initial 4-request,
  // trivial-prompt test showed a ~1.63x speedup, but that didn't hold at the real default scale
  // (14 agents) or with realistic diff-sized prompts -- concurrent requests queue almost fully
  // serially on this VRAM-constrained hardware (confirmed with both Node's fetch and curl,
  // ruling out a client-side artifact), and each queued request's client-side timeout clock
  // keeps running while it waits its turn, causing most of the swarm to spuriously time out.
  // `--parallel` remains available as an explicit opt-in for hardware where it's been verified
  // to actually help.
  parallel: false,
  chunk: false,
  // WHY false by default: cross-model LLM verification (a separate model checks whether a
  // finding's own cited evidence actually supports its claim) scored 13/13 on this project's
  // validation cases -- but those cases were designed by the same person who wrote the
  // verification prompt, with full knowledge of the failure pattern being tested for. That
  // proves the mechanism works on the shapes tested; it does not prove the false-rejection rate
  // is this low on messy real diffs. See the design spec's Validation and Rollout sections
  // (docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md) for the full
  // caveat and the report-only Stage 1 this gates behind. Graduates to on-by-default once real
  // `--verify-evidence` usage validates the false-rejection rate in practice, mirroring how
  // `parallel` above only became a real option after real-scale testing, not a small trial.
  verifyEvidence: false,
  verifierModel: 'qwen3:latest',
  verifyEvidenceSeverity: 'high',
  // WHY security/adversarial specifically, not project-wide: these are the two agents verified
  // (by reading their prompts) to have zero file-type awareness and a demonstrated real-world
  // failure mode -- misreading a .md file's prose description of a vulnerability pattern as
  // executable code. breaking-change/license were checked too and neither prompt references .md
  // files at all, so there's no evidence either way for them; this stays narrowly scoped to where
  // the bug was actually reproduced rather than guessing more broadly. Deterministic (not a
  // prompt instruction) because this project has prior evidence prompt-tightening alone
  // underperforms for this class of problem (secrets/dependencies/adversarial history). See
  // docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 3 -- including
  // the documented config-shallow-merge caveat: a project's own agentPolicy setting for ANY agent
  // replaces this default entirely (loadConfig does a shallow merge). Re-specify these excludes
  // in your own ai-review.config.json if you set agentPolicy for any agent and want to keep them.
  agentPolicy: {
    security: { exclude: ['**/*.md'] },
    adversarial: { exclude: ['**/*.md'] },
  },
}

export function loadConfig(projectPath: string): ReviewConfig {
  const configPath = join(projectPath, 'ai-review.config.json')
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const partial = JSON.parse(raw) as Partial<ReviewConfig>
    return { ...DEFAULT_CONFIG, ...partial }
  } catch (err) {
    console.error(
      `[config] failed to parse ${configPath}, falling back to defaults: ${(err as Error).message}`
    )
    return { ...DEFAULT_CONFIG }
  }
}
