import type { AgentName } from './schema.js'

/**
 * Named agent subsets for common review scenarios.
 *
 * - `fast`:          3 agents — quick PR gate (security + correctness + secrets). ~3 min.
 * - `full`:          All 15 default agents. Comprehensive review. ~30–45 min.
 * - `change-review`: 8 agents — matches PMB /change-review scope. ~10–15 min.
 * - `ui`:            5 agents — frontend-focused (excludes migration-safety, license). ~8 min.
 * - `migration`:     4 agents — database/schema change focused. ~5 min.
 * - `security`:      4 agents — security audit focused. ~5 min.
 *
 * `--agents` overrides `--profile` when both are provided.
 * `testgen` is never included in any profile — always opt-in via `--suggest-tests`.
 */
export const PROFILES: Record<string, AgentName[]> = {
  fast: ['security', 'correctness', 'secrets'],
  full: [
    'security',
    'performance',
    'correctness',
    'design',
    'dependencies',
    'coverage',
    'adversarial',
    'integration',
    'breaking-change',
    'license',
    'error-handling',
    'observability',
    'migration-safety',
    'secrets',
    'complexity',
  ],
  'change-review': [
    'security',
    'correctness',
    'design',
    'coverage',
    'integration',
    'migration-safety',
    'secrets',
    'complexity',
  ],
  ui: ['security', 'performance', 'correctness', 'coverage', 'integration'],
  migration: ['migration-safety', 'correctness', 'secrets', 'dependencies'],
  security: ['security', 'secrets', 'dependencies', 'adversarial'],
}

export function resolveProfile(name: string): AgentName[] {
  const agents = PROFILES[name]
  if (!agents) {
    const valid = Object.keys(PROFILES).join(', ')
    throw new Error(`Unknown profile "${name}". Valid profiles: ${valid}`)
  }
  return agents
}
