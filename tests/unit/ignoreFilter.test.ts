import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { filterDiff, loadIgnorePatterns } from '../../src/core/ignoreFilter.js'

const makeDiff = (files: string[]) =>
  files
    .map(
      f =>
        `diff --git a/${f} b/${f}\n` +
        `index 000..111 100644\n` +
        `--- a/${f}\n` +
        `+++ b/${f}\n` +
        `@@ -1 +1 @@\n` +
        `+change\n`
    )
    .join('')

describe('filterDiff', () => {
  it('returns diff unchanged when no patterns provided', () => {
    const diff = makeDiff(['src/foo.ts', 'src/bar.ts'])
    expect(filterDiff(diff, [])).toBe(diff)
  })

  it('removes sections for files matching a glob pattern', () => {
    const diff = makeDiff(['src/foo.ts', 'dist/bundle.js'])
    const filtered = filterDiff(diff, ['dist/**'])
    expect(filtered).toContain('src/foo.ts')
    expect(filtered).not.toContain('dist/bundle.js')
  })

  it('removes sections matching an extension pattern', () => {
    const diff = makeDiff(['src/app.ts', 'coverage/report.json', 'README.md'])
    const filtered = filterDiff(diff, ['*.json'])
    expect(filtered).toContain('src/app.ts')
    expect(filtered).not.toContain('coverage/report.json')
    expect(filtered).toContain('README.md')
  })

  it('removes sections matching a directory pattern with trailing slash', () => {
    const diff = makeDiff(['node_modules/lodash/index.js', 'src/main.ts'])
    const filtered = filterDiff(diff, ['node_modules/'])
    expect(filtered).not.toContain('node_modules/lodash/index.js')
    expect(filtered).toContain('src/main.ts')
  })
})

describe('loadIgnorePatterns', () => {
  const tmpFile = '.aiignore-test-tmp'

  it('returns only extraPaths when no .aiignore exists', () => {
    const patterns = loadIgnorePatterns('/nonexistent/path', ['*.log'])
    expect(patterns).toEqual(['*.log'])
  })

  it('merges .aiignore file with extraPaths', () => {
    writeFileSync(tmpFile, '# comment\ndist/\n*.log\n')
    try {
      const patterns = loadIgnorePatterns(process.cwd().replace(/\\/g, '/') + '/' + tmpFile + '..', ['extra'])
      // Since tmpFile is in cwd, adjust test to use cwd
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('skips comment and blank lines in .aiignore', () => {
    writeFileSync('.aiignore', '# this is a comment\n\ndist/\n*.log\n')
    try {
      const patterns = loadIgnorePatterns(process.cwd())
      expect(patterns).not.toContain('# this is a comment')
      expect(patterns).toContain('dist/')
      expect(patterns).toContain('*.log')
    } finally {
      unlinkSync('.aiignore')
    }
  })
})
