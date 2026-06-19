#!/usr/bin/env node
import { Command } from 'commander'
import { execSync } from 'child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMarkdown, formatJson } from './formatter.js'
import type { AgentName, AgentProgressEvent } from '../core/schema.js'
import { shouldFail, FAIL_ON_OPTIONS } from './exitCode.js'
import type { FailOnLevel } from './exitCode.js'

const program = new Command()

program
  .name('ai-review-agent')
  .description('AI-powered code review using a local LLM swarm')
  .version('0.9.4')
  .option('--diff <path>', 'Path to a .diff file to review')
  .option('--dir <path>', 'Directory to diff against HEAD (default: cwd)')
  .option('--model <model>', 'Override Ollama model')
  .option('--ollama-url <url>', 'Override Ollama base URL')
  .option('--agents <list>', 'Comma-separated list of agents to run')
  .option('--format <format>', 'Output format: markdown or json', 'markdown')
  .option('--out <path>', 'Write output to file instead of stdout')
  .option('--max-lines <n>', 'Truncate diff to this many lines (default: 2000)', parseInt)
  .option('--timeout <ms>', 'Per-agent timeout in milliseconds (default: 60000)', parseInt)
  .option('--retry-attempts <n>', 'Number of attempts per agent before skipping (default: 2)', parseInt)
  .option('--retry-delay <ms>', 'Delay between retries in ms (default: 2000)', parseInt)
  .option('--fail-on <level>', `Exit 1 when any finding meets this severity (${FAIL_ON_OPTIONS.join('|')}; default: high)`, 'high')
  .option('--fail-fast', 'Stop swarm on first finding at or above --fail-on threshold')
  .option('--parallel', 'Run specialist agents in parallel (faster; disables fail-fast early exit)')
  .option('--ignore <pattern>', 'Exclude files matching this glob pattern (repeatable)', collect, [] as string[])
  .option('--no-sanitize', 'Skip prompt-injection sanitization of the diff')
  .action(async (options: {
    diff?: string
    dir?: string
    model?: string
    ollamaUrl?: string
    agents?: string
    format: 'markdown' | 'json'
    out?: string
    maxLines?: number
    timeout?: number
    retryAttempts?: number
    retryDelay?: number
    failOn: FailOnLevel
    failFast?: boolean
    parallel?: boolean
    ignore: string[]
    sanitize: boolean
  }) => {
    const projectPath = resolve(options.dir ?? process.cwd())
    const config = loadConfig(projectPath)

    if (options.model) config.model = options.model
    if (options.ollamaUrl) config.ollamaUrl = options.ollamaUrl
    if (options.agents) config.agents = options.agents.split(',').map(a => a.trim()) as AgentName[]
    if (options.maxLines !== undefined) config.maxDiffLines = options.maxLines
    if (options.timeout !== undefined) config.agentTimeoutMs = options.timeout
    if (options.retryAttempts !== undefined) config.retryAttempts = options.retryAttempts
    if (options.retryDelay !== undefined) config.retryDelayMs = options.retryDelay
    if (options.ignore.length > 0) config.ignorePaths = [...config.ignorePaths, ...options.ignore]
    if (!options.sanitize) config.sanitize = false
    config.failOn = options.failOn
    config.failFast = !!options.failFast
    config.parallel = !!options.parallel

    const diff = getDiff(options.diff, options.dir)
    if (!diff.trim()) {
      console.error('No diff to review. Stage changes or provide --diff.')
      process.exit(1)
    }

    const provider = new OllamaProvider(config.ollamaUrl, config.model)
    const runner = new SwarmRunner(config, provider)

    process.stderr.write(`\n🔍 Running ai-review-agent with ${config.agents.length} agents...\n\n`)

    const result = await runner.run(
      { diff, projectPath },
      (event: AgentProgressEvent) => {
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
              .filter(s => bySev[s])
              .map(s => `${bySev[s]} ${s}`)
            summary += ` (${parts.join(', ')})`
          }
          process.stderr.write(`[${event.index}/${event.total}] ${event.name}   ${elapsed} — ${summary}\n`)
          if (event.earlyExit) {
            process.stderr.write(`⚡ Fail-fast: stopping swarm after ${event.name} (threshold met)\n`)
          }
        }
      }
    )

    if (result.testFiles.length > 0) {
      for (const tf of result.testFiles) {
        const outPath = join(projectPath, tf.path)
        mkdirSync(join(outPath, '..'), { recursive: true })
        writeFileSync(outPath, tf.content, 'utf-8')
      }
      process.stdout.write(`\n📝 Generated ${result.testFiles.length} test file(s) in ${config.testOutputDir}\n`)
    }

    let output = options.format === 'json' ? formatJson(result) : formatMarkdown(result)

    if (result.earlyExit && options.format !== 'json') {
      output += `\n\n> ⚡ **Fail-fast**: swarm stopped after \`${result.earlyExit.stoppedAt}\` (severity threshold met). Remaining agents were not run.\n`
    }

    if (options.out) {
      writeFileSync(options.out, output, 'utf-8')
      process.stdout.write(`\n✅ Report written to ${options.out}\n`)
    } else {
      process.stdout.write('\n' + output + '\n')
    }

    const hasBlocker = result.findings.some(f => shouldFail(f.severity, options.failOn))
    process.exit(hasBlocker ? 1 : 0)
  })

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
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
    return execSync(`git -C "${dir}" diff HEAD`, { encoding: 'utf-8' })
  }
  const staged = execSync('git diff --staged', { encoding: 'utf-8' })
  if (staged.trim()) return staged
  return execSync('git diff', { encoding: 'utf-8' })
}

program.parse()
