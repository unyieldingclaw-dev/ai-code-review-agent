// src/core/licenseFacts.ts
// Deterministic license ground-truth lookup, used to drop license findings that the reviewed
// project's own dependency metadata directly contradicts.
//
// WHY this exists: licenseCompliance.ts's prompt used to ask the model to "look up its license
// from your training knowledge" -- i.e. to recall a fact rather than read one. (That wording was
// replaced in the same change that added this module; the prompt is a secondary layer now, this
// is the primary one.) Measured live against Ollama,
// that misfires 6/10 on a fixture adding lodash, one of the most widely-known MIT packages in the
// npm ecosystem: the model asserted LGPL-3.0 with basis=VERIFIED. One trial even named the license
// correctly ("lodash has a license (MIT) that does not cause commercial use issues") and still
// reported it as a high-severity compliance issue. A false "this package is copyleft, you must
// open-source your code" claim is actively harmful -- it's legal FUD aimed at a compliance
// decision -- so it warrants the same treatment secrets.ts gives fabricated credentials.
//
// WHY contradiction-only, and NOT "drop unless corroborated": the calibration fixture for a REAL
// LGPL detection (license.diff) adds `node-lame`, which is deliberately not a dependency of this
// repo and therefore appears in neither the lockfile nor node_modules. Requiring corroboration
// would drop that legitimate finding and destroy the agent's actual detection capability. So an
// unresolvable package fails OPEN -- absence of evidence is never treated as evidence of absence,
// matching claimSupport.ts and orchestrator.ts's filterNonexistentFiles.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// SPDX identifiers that carry no copyleft obligation, so a compliance finding against a package
// carrying one is contradicted by definition. Deliberately conservative: anything not listed here
// (including anything unrecognized) is treated as "not known to be permissive" and fails open.
const PERMISSIVE_LICENSES = new Set(
  [
    'MIT',
    'MIT-0',
    'ISC',
    '0BSD',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Apache-2.0',
    'Unlicense',
    'CC0-1.0',
    'BlueOak-1.0.0',
    'Python-2.0',
    'WTFPL',
    'Zlib',
  ].map((l) => l.toLowerCase())
)

/**
 * True if an SPDX license expression carries no copyleft obligation.
 *
 * Handles the compound forms npm packages actually use: "(MIT OR Apache-2.0)" and
 * "(MIT AND BSD-3-Clause)". An OR expression is permissive if ANY branch is (the consumer may
 * choose it); an AND expression only if EVERY branch is (all obligations apply at once).
 */
export function isPermissiveLicense(expression: string | undefined | null): boolean {
  if (!expression) return false
  const normalized = expression
    .trim()
    .replace(/^\(|\)$/g, '')
    .trim()
  if (!normalized) return false

  if (/\sOR\s/i.test(normalized)) {
    return normalized.split(/\sOR\s/i).some((part) => isPermissiveLicense(part))
  }
  if (/\sAND\s/i.test(normalized)) {
    return normalized.split(/\sAND\s/i).every((part) => isPermissiveLicense(part))
  }
  // Strip a trailing "+" (e.g. "Apache-2.0+") and any surrounding whitespace/quotes.
  return PERMISSIVE_LICENSES.has(
    normalized
      .replace(/\+$/, '')
      .replace(/^["']|["']$/g, '')
      .toLowerCase()
  )
}

// Manifest scalar keys sharing the `"key": "value"` shape with a dependency entry but which are
// not packages. WHY this matters more than it looks: an unrecognized name resolves to null, which
// makes allAddedDependenciesArePermissive fail open and switch the whole backstop OFF. A diff that
// merely bumps `"version"` alongside a real dependency therefore disabled it -- measured
// `{verified:false, resolved:[]}` for a version-bump + dependency diff versus `{verified:true}`
// for a dependency-only one. Since a version bump accompanies most real dependency changes, the
// filter fired almost never in practice.
const MANIFEST_SCALAR_KEYS = new Set([
  'name',
  'version',
  'description',
  'main',
  'module',
  'types',
  'typings',
  'license',
  'author',
  'homepage',
  'repository',
  'bugs',
  'type',
  'private',
  'packageManager',
  'bin',
  'man',
  'browser',
  'unpkg',
  'jsdelivr',
  'sideEffects',
])

// A dependency value is a semver range or a supported specifier; a scalar manifest field is free
// text. Requiring the value to look like the former keeps unlisted scalar keys from poisoning the
// set too.
const DEPENDENCY_VALUE =
  /^(\*|latest|[\^~>=<]*\s*\d|npm:|file:|link:|git|https?:|workspace:|catalog:)/i

/** Package names added by this diff, read from `+` lines that look like a manifest dependency. */
export function extractAddedDependencies(diff: string): string[] {
  const names = new Set<string>()
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    // Matches a package.json dependency entry: "name": "semver-range"
    const m = line.match(/^\+\s*"(@?[^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/)
    if (!m || !m[1]) continue
    if (MANIFEST_SCALAR_KEYS.has(m[1])) continue
    if (!DEPENDENCY_VALUE.test(m[2] ?? '')) continue
    names.add(m[1])
  }
  return [...names]
}

/**
 * Normalizes the several shapes npm has used for the `license` field into an SPDX string.
 *
 * WHY this is not just `as string`: npm's deprecated-but-still-published forms are
 * `{"type":"MIT","url":"..."}` and an array of those (dual licensing). Reading either as a string
 * and calling `.trim()` on it throws a TypeError that escapes LicenseComplianceAgent.run(), failing
 * the whole agent rather than the one lookup. Returns null for anything unrecognized, which the
 * caller already treats as unresolvable and fails open on.
 */
function normalizeLicenseField(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map(normalizeLicenseField).filter((v): v is string => v !== null)
    // WHY AND, not OR: `license` as an array is not an npm-documented shape (the deprecated
    // multi-license field was `licenses`), so its intent is ambiguous. Joining with OR made
    // ["GPL-3.0","MIT"] resolve permissive and drop a legitimate copyleft finding -- the only
    // false-negative path in this module. AND is the conservative reading: permissive only if
    // every entry is, which at worst leaves the finding in place for a human to judge.
    return parts.length > 0 ? parts.join(' AND ') : null
  }
  if (value && typeof value === 'object' && 'type' in value) {
    const t = (value as { type?: unknown }).type
    return typeof t === 'string' ? t : null
  }
  return null
}

/**
 * The package's real license, from the reviewed project's own metadata. Returns null when it
 * cannot be determined -- callers must treat null as "unknown", never as "no problem".
 *
 * Prefers package-lock.json: it covers the whole resolved tree (410/410 entries carry a `license`
 * field in this repo's lockfileVersion 3), including packages not physically present in
 * node_modules. Falls back to the installed package's own manifest.
 */
export function resolvePackageLicense(projectPath: string, packageName: string): string | null {
  const lockPath = join(projectPath, 'package-lock.json')
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
        packages?: Record<string, { license?: unknown }>
      }
      const entry = lock.packages?.[`node_modules/${packageName}`]
      const fromLock = normalizeLicenseField(entry?.license)
      if (fromLock) return fromLock
    } catch {
      // Malformed lockfile -- fall through to node_modules rather than failing the review.
    }
  }

  const manifestPath = join(projectPath, 'node_modules', packageName, 'package.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { license?: unknown }
      const fromManifest = normalizeLicenseField(manifest.license)
      if (fromManifest) return fromManifest
    } catch {
      // Malformed manifest -- treat as unknown.
    }
  }

  return null
}

/**
 * True when every dependency this diff adds is verifiably permissive, which makes ANY
 * commercial-incompatibility finding on that diff contradicted by the project's own metadata.
 *
 * Returns false (fail open) if the diff adds nothing parseable, or if even one added package is
 * unresolvable or non-permissive -- in those cases a real compliance issue can't be ruled out.
 */
export function allAddedDependenciesArePermissive(
  diff: string,
  projectPath: string
): { verified: boolean; resolved: Array<{ name: string; license: string }> } {
  const added = extractAddedDependencies(diff)
  if (added.length === 0) return { verified: false, resolved: [] }

  const resolved: Array<{ name: string; license: string }> = []
  for (const name of added) {
    const license = resolvePackageLicense(projectPath, name)
    if (!license || !isPermissiveLicense(license)) return { verified: false, resolved }
    resolved.push({ name, license })
  }
  return { verified: true, resolved }
}
