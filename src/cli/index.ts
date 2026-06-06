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

const program = new Command()

program
  .name('ai-review')
  .description('AI-powered code review and deep testing agent')
  .version('0.1.0')

program
  .command('review', { isDefault: true })
  .description('Review code changes')
  .option('--diff <path>', 'Path to a .diff file to review')
  .option('--path <path>', 'Directory to diff against HEAD')
  .option('--model <model>', 'Override Ollama model')
  .option('--agents <list>', 'Comma-separated list of agents to run')
  .option('--format <format>', 'Output format: markdown or json', 'markdown')
  .option('--out <path>', 'Write output to file instead of stdout')
  .action(async (options: {
    diff?: string
    path?: string
    model?: string
    agents?: string
    format: 'markdown' | 'json'
    out?: string
  }) => {
    const projectPath = resolve(options.path ?? process.cwd())
    const config = loadConfig(projectPath)

    if (options.model) config.model = options.model
    if (options.agents) config.agents = options.agents.split(',').map(a => a.trim()) as AgentName[]

    const diff = getDiff(options.diff, options.path)
    if (!diff.trim()) {
      console.error('No diff to review. Stage changes or provide --diff.')
      process.exit(1)
    }

    const provider = new OllamaProvider(config.ollamaUrl, config.model)
    const runner = new SwarmRunner(config, provider)

    process.stdout.write(`\n🔍 Running ai-review with ${config.agents.length} agents...\n\n`)

    const result = await runner.run(
      { diff, projectPath },
      (agent) => process.stdout.write(`  ✓ ${agent}\n`)
    )

    // Write generated test files
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

    // Exit 1 if any critical/high findings (useful for CI)
    const hasBlocker = result.findings.some(f => f.severity === 'critical' || f.severity === 'high')
    process.exit(hasBlocker ? 1 : 0)
  })

function getDiff(diffFile?: string, pathOverride?: string): string {
  if (diffFile) {
    if (!existsSync(diffFile)) {
      console.error(`Diff file not found: ${diffFile}`)
      process.exit(1)
    }
    return readFileSync(diffFile, 'utf-8')
  }
  if (pathOverride) {
    return execSync(`git -C "${pathOverride}" diff HEAD`, { encoding: 'utf-8' })
  }
  // Default: staged diff
  const staged = execSync('git diff --staged', { encoding: 'utf-8' })
  if (staged.trim()) return staged
  // Fall back to unstaged
  return execSync('git diff', { encoding: 'utf-8' })
}

program.parse()
