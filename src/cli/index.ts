#!/usr/bin/env node
import { Command } from 'commander'
import { execSync } from 'child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMarkdown, formatJson } from './formatter.js'
import type { AgentName } from '../core/schema.js'
import { shouldFail, FAIL_ON_OPTIONS } from './exitCode.js'
import type { FailOnLevel } from './exitCode.js'

const program = new Command()

program
  .name('ai-review-agent')
  .description('AI-powered code review using a local LLM swarm')
  .version('0.3.0')
  .option('--diff <path>', 'Path to a .diff file to review')
  .option('--dir <path>', 'Directory to diff against HEAD (default: cwd)')
  .option('--model <model>', 'Override Ollama model')
  .option('--agents <list>', 'Comma-separated list of agents to run')
  .option('--format <format>', 'Output format: markdown or json', 'markdown')
  .option('--out <path>', 'Write output to file instead of stdout')
  .option('--max-lines <n>', 'Truncate diff to this many lines (default: 2000)', parseInt)
  .option('--timeout <ms>', 'Per-agent timeout in milliseconds (default: 60000)', parseInt)
  .option('--fail-on <level>', `Exit 1 when any finding meets this severity (${FAIL_ON_OPTIONS.join('|')}; default: high)`, 'high')
  .option('--ignore <pattern>', 'Exclude files matching this glob pattern (repeatable)', collect, [] as string[])
  .option('--no-sanitize', 'Skip prompt-injection sanitization of the diff')
  .action(async (options: {
    diff?: string
    dir?: string
    model?: string
    agents?: string
    format: 'markdown' | 'json'
    out?: string
    maxLines?: number
    timeout?: number
    failOn: FailOnLevel
    ignore: string[]
    sanitize: boolean
  }) => {
    const projectPath = resolve(options.dir ?? process.cwd())
    const config = loadConfig(projectPath)

    if (options.model) config.model = options.model
    if (options.agents) config.agents = options.agents.split(',').map(a => a.trim()) as AgentName[]
    if (options.maxLines !== undefined) config.maxDiffLines = options.maxLines
    if (options.timeout !== undefined) config.agentTimeoutMs = options.timeout
    if (options.ignore.length > 0) config.ignorePaths = [...config.ignorePaths, ...options.ignore]
    if (!options.sanitize) config.sanitize = false

    const diff = getDiff(options.diff, options.dir)
    if (!diff.trim()) {
      console.error('No diff to review. Stage changes or provide --diff.')
      process.exit(1)
    }

    const provider = new OllamaProvider(config.ollamaUrl, config.model)
    const runner = new SwarmRunner(config, provider)

    process.stdout.write(`\n🔍 Running ai-review-agent with ${config.agents.length} agents...\n\n`)

    const result = await runner.run(
      { diff, projectPath },
      (agent) => process.stdout.write(`  ✓ ${agent}\n`)
    )

    if (result.testFiles.length > 0) {
      for (const tf of result.testFiles) {
        const outPath = join(projectPath, tf.path)
        mkdirSync(join(outPath, '..'), { recursive: true })
        writeFileSync(outPath, tf.content, 'utf-8')
      }
      process.stdout.write(`\n📝 Generated ${result.testFiles.length} test file(s) in ${config.testOutputDir}\n`)
    }

    const output = options.format === 'json' ? formatJson(result) : formatMarkdown(result)

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
