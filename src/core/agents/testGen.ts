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
    gaps: CoverageGap[],
    signal?: AbortSignal
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
      const testFile = await this.generateTestFile(file, fileGaps, framework, input, signal)
      if (testFile) testFiles.push(testFile)
    }

    return { testFiles }
  }

  private async generateTestFile(
    sourceFile: string,
    gaps: CoverageGap[],
    framework: TestFramework,
    input: ReviewInput,
    signal?: AbortSignal
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

    const raw = await this.provider.chat(messages, { think: false, signal })
    const content = raw.replace(/```[a-z]*\s*/gi, '').trim()
    if (!content || content.length < 50) return null

    // WHY check for test-framework structure, not just length: the prompt asks for code only,
    // but a long enough refusal or explanation ("I can't generate this because...") passes a pure
    // length check and would get written to disk as if it were real, runnable test code. WHY
    // require a quoted title right after the call (not just "it(" / "test(" anywhere): "it"/"test"
    // are common English words -- prose like "explain it (the reasoning) here" matched a looser
    // `it\s*\(` check. Every real describe/it/test call takes a quoted title as its first
    // argument, which prose parentheticals don't.
    const looksLikeTestCode =
      framework === 'pytest'
        ? /\bdef\s+test_/.test(content)
        : /\b(describe|it|test)\(\s*['"`]/.test(content)
    if (!looksLikeTestCode) {
      console.error(
        `[testGen] discarding generated content for ${sourceFile} -- doesn't look like ${framework} test code`
      )
      return null
    }

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
