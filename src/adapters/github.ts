import type { ReviewResult } from '../core/schema.js'

export const COMMENT_MARKER = '<!-- ai-review-agent:v1 -->'

export async function upsertPRComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  const fullBody = `${COMMENT_MARKER}\n${body}`

  // Find existing bot comment
  const listRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    { headers }
  )
  if (!listRes.ok) throw new Error(`GitHub API list comments failed: ${listRes.status}`)
  const comments = await listRes.json() as Array<{ id: number; body: string }>
  const existing = comments.find(c => c.body.includes(COMMENT_MARKER))

  if (existing) {
    const patchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ body: fullBody }) }
    )
    if (!patchRes.ok) throw new Error(`GitHub API update comment failed: ${patchRes.status}`)
  } else {
    const postRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ body: fullBody }) }
    )
    if (!postRes.ok) throw new Error(`GitHub API create comment failed: ${postRes.status}`)
  }
}

export function buildStepSummary(result: ReviewResult): string {
  const rows = result.findings.map(f =>
    `| ${f.severity} | ${f.agent} | ${f.file}:${f.line} | ${f.title} | ${f.basis} |`
  ).join('\n')

  return `## AI Review Summary
| Severity | Agent | Location | Issue | Basis |
|---|---|---|---|---|
${rows || '| — | — | — | No findings | — |'}

**Total:** ${result.findings.length} findings | **Duration:** ${result.summary.durationMs}ms`
}
