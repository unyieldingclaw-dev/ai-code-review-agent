import type { AgentName } from './schema.js'

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
