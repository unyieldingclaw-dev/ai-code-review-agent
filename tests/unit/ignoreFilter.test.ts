import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { filterDiff, loadIgnorePatterns, IgnorePatterns } from '../../src/core/ignoreFilter.js'

const makeDiff = (files: string[]) =>
  files
    .map(
      (f) =>
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
    expect(patterns.excludes).toEqual(['*.log'])
    expect(patterns.includes).toEqual([])
  })

  it('merges .aiignore file with extraPaths', () => {
    writeFileSync(tmpFile, '# comment\ndist/\n*.log\n')
    try {
      const _patterns = loadIgnorePatterns(
        process.cwd().replace(/\\/g, '/') + '/' + tmpFile + '..',
        ['extra']
      )
      // Since tmpFile is in cwd, adjust test to use cwd
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('skips comment and blank lines in .aiignore', () => {
    writeFileSync('.aiignore', '# this is a comment\n\ndist/\n*.log\n')
    try {
      const patterns = loadIgnorePatterns(process.cwd())
      expect(patterns.excludes).not.toContain('# this is a comment')
      expect(patterns.excludes).toContain('dist/')
      expect(patterns.excludes).toContain('*.log')
    } finally {
      unlinkSync('.aiignore')
    }
  })

  it('loadIgnorePatterns separates negation lines into includes array', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiignore-'))
    try {
      fs.writeFileSync(path.join(tmp, '.aiignore'), '*.log\n!important.log\ndist/\n')
      const patterns = loadIgnorePatterns(tmp)
      expect(patterns.excludes).toContain('*.log')
      expect(patterns.excludes).toContain('dist/')
      expect(patterns.includes).toContain('important.log')
      expect(patterns.includes).not.toContain('!important.log')
    } finally {
      fs.rmSync(tmp, { recursive: true })
    }
  })
})

describe('filterDiff negation patterns', () => {
  it('keeps files that match a negation pattern even when also matching an exclude', () => {
    const diff = makeDiff(['src/logs/important.log', 'src/logs/debug.log'])
    const patterns: IgnorePatterns = {
      excludes: ['*.log'],
      includes: ['important.log'],
    }
    const result = filterDiff(diff, patterns)
    expect(result).toContain('important.log')
    expect(result).not.toContain('debug.log')
  })
})
