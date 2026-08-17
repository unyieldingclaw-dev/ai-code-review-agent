#!/usr/bin/env node
import { Command } from 'commander'
import updateNotifier from 'update-notifier'
import { spawnSync } from 'child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, resolve, dirname } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { runChunked } from '../core/chunkRunner.js'
import { loadConfig } from '../core/config.js'
import { isPathWithin } from '../core/filePath.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMarkdown, formatJson, formatSarif, formatGithubAnnotations } from './formatter.js'
import type { AgentName, AgentProgressEvent } from '../core/schema.js'
import {
  shouldFail,
  FAIL_ON_OPTIONS,
  hasAgentFailures,
  AGENT_FAILURE_EXIT_CODE,
  TRUNCATION_EXIT_CODE,
} from './exitCode.js'
import type { FailOnLevel } from './exitCode.js'
import { resolveProfile } from '../core/profiles.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { name, version } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
) as {
  name: string
  version: string
}

export const program = new Command()

program
  .name('ai-review-agent')
  .description('AI-powered code review using a local LLM swarm')
  .version(version)
  .option('--diff <path>', 'Path to a .diff file to review')
  .option('--dir <path>', 'Directory to diff against HEAD (default: cwd)')
  .option('--model <model>', 'Override Ollama model')
  .option('--ollama-url <url>', 'Override Ollama base URL')
  .option('--agents <list>', 'Comma-separated list of agents to run')
  .option(
    '--profile <name>',
    'Run a named agent subset: fast, full, change-review, ui, migration, security'
  )
  .option(
    '--format <format>',
    'Output format: markdown, json, sarif, or github-annotations',
    'markdown'
  )
  .option('--out <path>', 'Write output to file instead of stdout')
  .option('--max-lines <n>', 'Truncate diff to this many lines (default: 2000)', parseInt)
  .option(
    '--chunk',
    'Instead of truncating an oversized diff, split it into multiple full-coverage passes ' +
      '(multiplies LLM calls by chunk count -- off by default)'
  )
  .option(
    '--timeout <ms>',
    'Per-agent timeout in milliseconds (default: 180000, scaled up to 2x for large diffs unless set explicitly here)',
    parseInt
  )
  .option(
    '--retry-attempts <n>',
    'Number of attempts per agent before skipping (default: 2)',
    parseInt
  )
  .option('--retry-delay <ms>', 'Delay between retries in ms (default: 2000)', parseInt)
  .option(
    '--fail-on <level>',
    `Exit 1 when any finding meets this severity (${FAIL_ON_OPTIONS.join('|')}; default: high). ` +
      `Exit 2 takes priority over this if any agent failed.`,
    'high'
  )
  .option(
    '--fail-fast',
    'Stop swarm on first finding at or above --fail-on threshold (requires sequential execution -- has no effect with --parallel)'
  )
  .option(
    '--allow-truncation',
    'Exit 0 on a truncated-but-otherwise-clean run instead of exit code 3 -- use only if you have ' +
      'deliberately accepted partial diff coverage for this workflow'
  )
  .option(
    '--parallel',
    'Run specialist agents concurrently (faster on hardware where Ollama can genuinely overlap requests; disables --fail-fast early exit). Off by default -- verify it helps on your hardware before enabling'
  )
  .option(
    '--ignore <pattern>',
    'Exclude files matching this glob pattern (repeatable)',
    collect,
    [] as string[]
  )
  .option(
    '--no-sanitize',
    'Skip prompt-injection sanitization of the diff, and of memory-bank context when --context memory-bank is also set'
  )
  .option(
    '--suggest-tests',
    'Enable testgen agent and include suggestions in report (no files written)'
  )
  .option('--write-tests', 'Enable testgen agent and write generated test files to testOutputDir')
  .option(
    '--context <mode>',
    'Context mode: none (default) or memory-bank (loads memory-bank/ files per agent)',
    'none'
  )
  .option(
    '--context-budget <n>',
    'Max chars of memory-bank context per agent (default: 4000)',
    parseInt
  )
  .option(
    '--context-mode <mode>',
    'Context selection mode: static (default) or semantic (uses nomic-embed-text)',
    'static'
  )
  .option('--no-emoji', 'Disable emoji in output (for CI terminals without UTF-8 support)')
  .option(
    '--verify-evidence',
    'Verify Critical/High findings against their own cited evidence using a separate model (report-only in this version -- flags possibly-unsupported findings without dropping them; adds one LLM call per checked finding)'
  )
  .action(
    async (options: {
      diff?: string
      dir?: string
      model?: string
      ollamaUrl?: string
      agents?: string
      profile?: string
      format: 'markdown' | 'json' | 'sarif' | 'github-annotations'
      out?: string
      maxLines?: number
      chunk?: boolean
      timeout?: number
      retryAttempts?: number
      retryDelay?: number
      failOn: FailOnLevel
      failFast?: boolean
      allowTruncation?: boolean
      parallel?: boolean
      ignore: string[]
      sanitize: boolean
      suggestTests?: boolean
      writeTests?: boolean
      context: string
      contextBudget?: number
      contextMode?: string
      emoji: boolean
      verifyEvidence?: boolean
    }) => {
      try {
        const contextMode = options.context === 'memory-bank' ? 'memory-bank' : 'none'

        const projectPath = resolve(options.dir ?? process.cwd())
        const config = loadConfig(projectPath)

        if (config.provider !== 'ollama') {
          console.error(
            `Provider "${config.provider}" is configured but not implemented. Use provider "ollama".`
          )
          process.exit(1)
        }

        if (options.model) config.model = options.model
        if (options.ollamaUrl) config.ollamaUrl = options.ollamaUrl
        if (options.agents)
          config.agents = options.agents.split(',').map((a) => a.trim()) as AgentName[]
        if (options.profile && !options.agents) {
          try {
            config.agents = resolveProfile(options.profile)
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err))
            process.exit(1)
          }
        }
        if (options.maxLines !== undefined) config.maxDiffLines = options.maxLines
        // WHY conditional (only overrides toward true), same rationale as --verify-evidence
        // below: --chunk is opt-in (default false), so an unconditional overwrite would stomp
        // a project-config-file `true` back to false on every run that doesn't pass the flag.
        if (options.chunk) config.chunk = true
        if (options.timeout !== undefined) {
          config.agentTimeoutMs = options.timeout
          config.timeoutScalingEnabled = false
        }
        if (options.retryAttempts !== undefined) config.retryAttempts = options.retryAttempts
        if (options.retryDelay !== undefined) config.retryDelayMs = options.retryDelay
        if (options.ignore.length > 0)
          config.ignorePaths = [...config.ignorePaths, ...options.ignore]
        if (!options.sanitize) config.sanitize = false
        config.failOn = options.failOn
        config.failFast = !!options.failFast
        config.parallel = !!options.parallel
        // WHY conditional (only overrides toward true) rather than `!!options.verifyEvidence`
        // like --parallel/--fail-fast above: this is an opt-in feature (default false), so an
        // unconditional overwrite would silently stomp a project-config-file `true` back to
        // false on every run that doesn't also pass the flag. --parallel/--fail-fast's
        // unconditional pattern is pre-existing and out of scope to change here.
        if (options.verifyEvidence) config.verifyEvidence = true
        if (options.contextBudget !== undefined) config.contextBudgetChars = options.contextBudget
        if (options.contextMode === 'semantic') config.contextMode = 'semantic'

        // testgen opt-in: only add to agents if --suggest-tests or --write-tests is passed
        if ((options.suggestTests || options.writeTests) && !config.agents.includes('testgen')) {
          config.agents = [...config.agents, 'testgen']
        }

        const diff = getDiff(options.diff, options.dir)
        if (!diff.trim()) {
          console.error('No diff to review. Stage changes or provide --diff.')
          process.exit(1)
        }

        const provider = new OllamaProvider(config.ollamaUrl, config.model)
        // Deliberately a separate OllamaProvider instance/model from the main review's --
        // cross-model verification only works if the verifier has no memory of the original
        // claim. See docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md.
        // WHY `||` not `??`: verifierModel is an optional string field -- a config file setting
        // it to `""` should fall back to the default the same way `undefined` does, rather than
        // constructing an OllamaProvider with an empty model name.
        const verifierProvider = config.verifyEvidence
          ? new OllamaProvider(config.ollamaUrl, config.verifierModel || 'qwen3:latest')
          : undefined
        const runner = new SwarmRunner(config, provider, verifierProvider)

        const reviewingLabel = options.emoji !== false ? '🔍' : 'Reviewing'
        process.stderr.write(
          `\n${reviewingLabel} Running ai-review-agent with ${config.agents.length} agents...\n\n`
        )

        const onProgress = (event: AgentProgressEvent) => {
          if (event.phase === 'start') {
            process.stderr.write(`[${event.index}/${event.total}] ${event.name}  starting…\n`)
          } else {
            const elapsed = `${Math.round((event.elapsedMs ?? 0) / 1000)}s`
            const count = event.findings?.length ?? 0
            let summary = `${count} finding${count !== 1 ? 's' : ''}`
            if (count > 0 && event.findings) {
              const bySev: Record<string, number> = {}
              for (const f of event.findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1
              const parts = (['critical', 'high', 'medium', 'low'] as const)
                .filter((s) => bySev[s])
                .map((s) => `${bySev[s]} ${s}`)
              summary += ` (${parts.join(', ')})`
            }
            process.stderr.write(
              `[${event.index}/${event.total}] ${event.name}   ${elapsed} — ${summary}\n`
            )
            if (event.earlyExit) {
              const bolt = options.emoji !== false ? '⚡ ' : ''
              process.stderr.write(
                `${bolt}Fail-fast: stopping swarm after ${event.name} (threshold met)\n`
              )
            }
          }
        }

        // WHY diffLines is computed from `diff` (the full, untruncated diff returned by
        // getDiff()) rather than some post-truncation variable: cli/index.ts never truncates
        // the diff itself -- truncation happens inside SwarmRunner.run(). `diff` is the only
        // diff variable in scope here, so this check is exactly "does the raw diff exceed the
        // configured limit" -- the same condition SwarmRunner.run() will independently apply
        // if the --chunk branch below is skipped.
        const diffLines = diff.split('\n').length
        const result =
          config.chunk && diffLines > config.maxDiffLines
            ? await runChunked(
                runner,
                { diff, projectPath },
                config.maxDiffLines,
                config.maxFindings,
                onProgress,
                contextMode
              )
            : await runner.run({ diff, projectPath }, onProgress, contextMode)

        // Stamp integration metadata so callers can parse the contract version
        result.schemaVersion = 'ai-review-agent/v1'
        result.toolVersion = version
        result.profile = options.profile ?? null

        // Only write test files when --write-tests is explicitly passed
        if (options.writeTests && result.testFiles.length > 0) {
          let written = 0
          for (const tf of result.testFiles) {
            // Backstop against a malicious testOutputDir (config.ts applies zero validation to
            // it) or any other way a test file's path could escape projectPath -- path.join
            // does not clamp to projectPath, so this resolves the final path and refuses to
            // write anything outside it instead of trusting the path as given.
            const outPath = resolveWriteTestPath(projectPath, tf.path)
            if (!outPath) {
              console.error(
                `[ai-review] Refusing to write test file outside the project directory: ${tf.path}`
              )
              continue
            }
            mkdirSync(join(outPath, '..'), { recursive: true })
            writeFileSync(outPath, tf.content, 'utf-8')
            written++
          }
          const paperclip = options.emoji !== false ? '📝' : 'Generated'
          process.stdout.write(
            `\n${paperclip} Generated ${written} test file(s) in ${config.testOutputDir}\n`
          )
        } else if (options.suggestTests && result.testFiles.length > 0) {
          const lightbulb = options.emoji !== false ? '💡' : 'Note:'
          process.stdout.write(
            `\n${lightbulb} ${result.testFiles.length} test suggestion(s) included in report (use --write-tests to write files)\n`
          )
        }

        let output =
          options.format === 'json'
            ? formatJson(result)
            : options.format === 'sarif'
              ? formatSarif(result)
              : options.format === 'github-annotations'
                ? formatGithubAnnotations(result)
                : formatMarkdown(result, { noEmoji: options.emoji === false })

        if (
          result.earlyExit &&
          options.format !== 'json' &&
          options.format !== 'sarif' &&
          options.format !== 'github-annotations'
        ) {
          const bolt = options.emoji !== false ? '⚡ ' : ''
          output += `\n\n> ${bolt}**Fail-fast**: swarm stopped after \`${result.earlyExit.stoppedAt}\` (severity threshold met). Remaining agents were not run.\n`
        }

        if (options.out) {
          writeFileSync(options.out, output, 'utf-8')
          const check = options.emoji !== false ? '✅ ' : ''
          process.stdout.write(`\n${check}Report written to ${options.out}\n`)
        } else {
          process.stdout.write('\n' + output + '\n')
        }

        const hasBlocker = result.findings.some((f) => shouldFail(f.severity, options.failOn))
        if (hasAgentFailures(result.agentStatus)) {
          process.exit(AGENT_FAILURE_EXIT_CODE)
        }
        if (hasBlocker) {
          process.exit(1)
        }
        // Truncation ranks below a real blocker (checked above) but above "clean" -- a run that
        // silently skipped 60% of the diff must not report exit 0 by default. --allow-truncation
        // opts back into 0 for callers who've deliberately accepted partial coverage.
        if (result.truncation?.truncated && !options.allowTruncation) {
          process.exit(TRUNCATION_EXIT_CODE)
        }
        process.exit(0)
      } catch (err) {
        // Re-throw synthetic exits (e.g. process.exit mocks in tests) so they propagate correctly
        if (err instanceof Error && err.message.startsWith('process.exit(')) throw err
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`\nError: ${msg}\n`)
        if (
          msg.includes('not reachable') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ENOENT')
        ) {
          process.stderr.write(`Make sure Ollama is running: ollama serve\n`)
        }
        process.exit(1)
      }
    }
  )

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

// Resolves a generated test file's path against projectPath and returns null if the result
// would land outside it -- the backstop for --write-tests. path.join(projectPath, tf.path)
// does not clamp to projectPath (e.g. join('/repo', '../../../etc/passwd') escapes it cleanly),
// so a malicious testOutputDir or an unsanitized gap.file that slipped past runner.ts's
// coverage-gap filter could otherwise write anywhere the process user can write.
export function resolveWriteTestPath(projectPath: string, testFilePath: string): string | null {
  const resolvedProject = resolve(projectPath)
  const resolvedOut = resolve(join(projectPath, testFilePath))
  if (!isPathWithin(resolvedOut, resolvedProject)) return null
  return resolvedOut
}

function gitSync(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(result.stderr || `git exited with status ${result.status}`)
  return result.stdout
}

function getDiff(diffFile?: string, dir?: string): string {
  if (diffFile) {
    if (!existsSync(diffFile)) {
      console.error(`Diff file not found: ${diffFile}`)
      process.exit(1)
    }
    return readFileSync(diffFile, 'utf-8')
  }
  if (dir) {
    return gitSync(['-C', dir, 'diff', 'HEAD'])
  }
  const staged = gitSync(['diff', '--staged'])
  if (staged.trim()) return staged
  return gitSync(['diff'])
}

export function checkForUpdates(): void {
  updateNotifier({
    pkg: { name, version },
    updateCheckInterval: 1000 * 60 * 60 * 24 * 7, // 7 days -- never a live check per invocation
  }).notify({
    isGlobal: true, // this CLI is always installed via `npm install -g`
    message:
      'A newer version of {packageName} is available ({currentVersion} → {latestVersion}). Run: `{updateCommand}`',
  })
}

if (process.env.NODE_ENV !== 'test') {
  // WHY guarded the same way as program.parse(): keeps this out of the test run entirely
  // rather than relying on update-notifier's own TTY/network fail-open behavior during tests.
  checkForUpdates()
  program.parse()
}
