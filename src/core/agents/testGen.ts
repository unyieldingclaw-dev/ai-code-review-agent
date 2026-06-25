import type { LLMProvider, Message } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { CoverageGap, GeneratedTestFile, ReviewInput, TestFramework } from '../schema.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export class TestGenAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: ReviewConfig
  ) {}

  async runWithGaps(
    input: ReviewInput,
    gaps: CoverageGap[]
  ): Promise<{ testFiles: GeneratedTestFile[] }> {
    if (gaps.length === 0) return { testFiles: [] }

    const framework = this.detectFramework(input.projectPath)
    const testFiles: GeneratedTestFile[] = []

    // Group gaps by file to minimize API calls
    const byFile = new Map<string, CoverageGap[]>()
    for (const gap of gaps) {
      const existing = byFile.get(gap.file) ?? []
      existing.push(gap)
      byFile.set(gap.file, existing)
    }

    for (const [file, fileGaps] of byFile) {
      const testFile = await this.generateTestFile(file, fileGaps, framework, input)
      if (testFile) testFiles.push(testFile)
    }

    return { testFiles }
  }

  private async generateTestFile(
    sourceFile: string,
    gaps: CoverageGap[],
    framework: TestFramework,
    input: ReviewInput
  ): Promise<GeneratedTestFile | null> {
    const gapDescriptions = gaps
      .map(
        (g) =>
          `- Function: ${g.functionName} (lines ${g.lineStart}-${g.lineEnd})\n  What it does: ${g.description}`
      )
      .join('\n')

    const messages: Message[] = [
      {
        role: 'system',
        content: `You are a test generation agent. Write complete, runnable test code using ${framework}.
Output ONLY valid ${framework} test code. No explanation, no markdown fences, no prose.
Tests must: import the module under test, cover the happy path, cover the error/edge case, use descriptive test names.`,
      },
      {
        role: 'user',
        content: `Generate tests for these uncovered functions in ${sourceFile}:\n\n${gapDescriptions}\n\nContext from diff:\n\`\`\`diff\n${input.diff.slice(0, 8000)}\n\`\`\``,
      },
    ]

    const raw = await this.provider.chat(messages, { think: false })
    const content = raw.replace(/```[a-z]*\s*/gi, '').trim()
    if (!content || content.length < 50) return null

    const testPath = this.deriveTestPath(sourceFile, framework)
    return { path: testPath, content, framework }
  }

  private detectFramework(projectPath?: string): TestFramework {
    if (!projectPath) return 'vitest'
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
        const deps = {
          ...((pkg.dependencies as object) ?? {}),
          ...((pkg.devDependencies as object) ?? {}),
        }
        if ('vitest' in deps) return 'vitest'
        if ('jest' in deps) return 'jest'
        if ('mocha' in deps) return 'mocha'
      } catch {
        /* fall through */
      }
    }
    const reqPath = join(projectPath, 'requirements.txt')
    if (existsSync(reqPath)) return 'pytest'
    return 'vitest'
  }

  private deriveTestPath(sourceFile: string, framework: TestFramework): string {
    const ext = framework === 'pytest' ? '.py' : '.test.ts'
    const base = sourceFile.replace(/\.(ts|js|tsx|jsx|py)$/, '')
    return `${this.config.testOutputDir}/${base.replace(/^src\//, '')}${ext}`
  }
}
