// tests/unit/licenseFacts.test.ts
import { describe, it, expect } from 'vitest'
import {
  isPermissiveLicense,
  extractAddedDependencies,
  resolvePackageLicense,
  allAddedDependenciesArePermissive,
} from '../../src/core/licenseFacts.js'

describe('isPermissiveLicense', () => {
  it('accepts common permissive SPDX identifiers', () => {
    for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD']) {
      expect(isPermissiveLicense(l)).toBe(true)
    }
  })

  it('rejects copyleft identifiers', () => {
    for (const l of ['GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'SSPL-1.0']) {
      expect(isPermissiveLicense(l)).toBe(false)
    }
  })

  it('treats an OR expression as permissive if any branch is', () => {
    // The consumer may choose the permissive branch, so no copyleft obligation attaches.
    expect(isPermissiveLicense('(MIT OR Apache-2.0)')).toBe(true)
    expect(isPermissiveLicense('(GPL-3.0 OR MIT)')).toBe(true)
  })

  it('treats an AND expression as permissive only if every branch is', () => {
    // Both sets of obligations apply simultaneously, so one copyleft branch taints the whole.
    expect(isPermissiveLicense('(MIT AND BSD-3-Clause)')).toBe(true)
    expect(isPermissiveLicense('(MIT AND GPL-3.0)')).toBe(false)
  })

  it('fails closed on unknown, empty, or missing values', () => {
    // Anything unrecognized must NOT be assumed permissive -- that would let the filter drop a
    // real finding about a license this list simply hasn't enumerated.
    expect(isPermissiveLicense('SOME-CUSTOM-EULA')).toBe(false)
    expect(isPermissiveLicense('')).toBe(false)
    expect(isPermissiveLicense(undefined)).toBe(false)
    expect(isPermissiveLicense(null)).toBe(false)
  })
})

describe('extractAddedDependencies', () => {
  it('extracts package names from added manifest lines', () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -3,6 +3,7 @@
   "dependencies": {
     "express": "^4.18.0",
+    "commander": "^12.1.0"
   }
 }
`
    expect(extractAddedDependencies(diff)).toEqual(['commander'])
  })

  it('handles scoped package names', () => {
    const diff = `+    "@scope/pkg": "^1.0.0",\n`
    expect(extractAddedDependencies(diff)).toEqual(['@scope/pkg'])
  })

  it('ignores the +++ diff header and unchanged lines', () => {
    const diff = `+++ b/package.json
     "express": "^4.18.0",
`
    expect(extractAddedDependencies(diff)).toEqual([])
  })
})

describe('resolvePackageLicense', () => {
  it('resolves a real dependency of this repo from its lockfile', () => {
    // commander is a genuine dependency here, so this exercises the real lockfile path.
    expect(resolvePackageLicense('.', 'commander')).toBe('MIT')
  })

  it('returns null for a package that is not a dependency of this repo', () => {
    // Must be null, not a guess -- callers treat null as "unknown" and fail open.
    expect(resolvePackageLicense('.', 'node-lame')).toBeNull()
  })

  it('returns null when the project path has no manifest metadata at all', () => {
    expect(resolvePackageLicense('/nonexistent-path-xyz', 'commander')).toBeNull()
  })
})

describe('allAddedDependenciesArePermissive', () => {
  const cleanDiff = `+    "commander": "^12.1.0"\n`

  it('verifies when every added dependency resolves to a permissive license', () => {
    const result = allAddedDependenciesArePermissive(cleanDiff, '.')
    expect(result.verified).toBe(true)
    expect(result.resolved).toEqual([{ name: 'commander', license: 'MIT' }])
  })

  it('fails open when an added dependency cannot be resolved', () => {
    // This is the case that keeps license.diff's genuine node-lame/LGPL detection working --
    // absence of evidence must never be treated as evidence of absence.
    const result = allAddedDependenciesArePermissive(`+    "node-lame": "^1.3.1"\n`, '.')
    expect(result.verified).toBe(false)
  })

  it('fails open when only some added dependencies resolve', () => {
    const mixed = `+    "commander": "^12.1.0",\n+    "node-lame": "^1.3.1"\n`
    expect(allAddedDependenciesArePermissive(mixed, '.').verified).toBe(false)
  })

  it('fails open when the diff adds no parseable dependency', () => {
    expect(allAddedDependenciesArePermissive('+ some unrelated line\n', '.').verified).toBe(false)
  })
})
