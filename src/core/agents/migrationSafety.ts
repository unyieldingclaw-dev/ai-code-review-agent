import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class MigrationSafetyAgent extends BaseAgent {
  get name(): AgentName { return 'migration-safety' }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in database migration safety.
Analyze the migration files in the diff for these dangerous patterns:

- NOT NULL column without DEFAULT: adding a NOT NULL column with no default value will fail on tables with existing rows
- DROP without IF EXISTS: dropping a table, column, or index without IF EXISTS will error if the object doesn't exist
- Missing FK index: adding a foreign key constraint without a corresponding index degrades query performance
- Missing down migration: a migration with no corresponding rollback/down function is irreversible in emergencies
- Destructive operations without transaction: DROP TABLE or TRUNCATE outside a transaction cannot be rolled back

severity: "critical" for operations that will cause data loss or lock production tables
severity: "high" for NOT NULL without DEFAULT or missing FK index on large tables
severity: "medium" for missing down migration or DROP without IF EXISTS

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":85,"file":"path/to/migration","line":42,"title":"Short title","detail":"What the problem is","suggestion":"How to fix it"}]`
  }
}

export function hasMigrationFiles(diff: string): boolean {
  const migrationPatterns = [
    /migrations\//i,
    /\.migration\.(ts|js|sql)$/i,
    /versions\//i,
    /_up\.sql$/i,
    /\d{4}_.*\.sql$/i,
  ]
  const lines = diff.split('\n')
  for (const line of lines) {
    if (!line.startsWith('+++ b/')) continue
    const filePath = line.slice(6)
    if (migrationPatterns.some(p => p.test(filePath))) return true
  }
  return false
}
