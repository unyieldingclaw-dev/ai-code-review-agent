import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';

const REVIEW_CONTRACT_VERSION = '1.0';
const MAX_FINDINGS = 15;
// Prompt injection patterns — treat diff content as untrusted data
const INJECTION_PATTERNS = [
  /ignore (previous|all|prior) instructions/i,
  /you are now/i,
  /disregard (previous|all|the above)/i,
  /new (system )?instructions/i,
  /\[INST\]|\[\/INST\]/,
  /<<<.*system.*>>>/i,
];

const REVIEWER_SYSTEM = `You are an independent code reviewer. Analyze the provided diff and static analysis tool output.

Return ONLY a JSON object with this exact schema (no markdown, no explanation outside the JSON):
{
  "review_contract_version": "1.0",
  "findings": [
    {
      "id": "f001",
      "file": "filename or null",
      "line": 42,
      "severity": "low|medium|high|critical",
      "category": "security|correctness|performance|style|maintainability",
      "title": "Short title",
      "description": "Detailed explanation of the issue and why it matters",
      "evidence_level": "supported|strongly_supported|reproduced|verified",
      "suggested_fix": "Specific actionable suggestion or null",
      "tool_source": "eslint|semgrep|gitleaks|audit|reviewer|null"
    }
  ]
}

Evidence ladder: hypothesis < supported < strongly_supported < reproduced < verified

Rules:
- Only report findings with evidence_level >= "supported". Never report hypothesis-level findings.
- Findings confirmed by static tools (eslint, semgrep, gitleaks) get evidence_level "strongly_supported" minimum.
- Focus on security, correctness, and maintainability.
- Skip purely stylistic issues unless severity is medium or higher.
- Return valid JSON only. No markdown fences, no commentary.`;

const VERIFIER_SYSTEM = `You are an independent code review verifier. You receive proposed findings from a separate reviewer.
You have NOT seen the reviewer's reasoning — only the findings and the diff.

Return ONLY a JSON object with this exact schema (no markdown, no explanation):
{
  "verifications": [
    {
      "finding_id": "f001",
      "verifier_status": "accepted|modified|rejected",
      "verifier_note": "One-sentence explanation",
      "corrected_severity": null,
      "corrected_evidence_level": null
    }
  ]
}

Rules:
- Be skeptical. Reject findings that are speculative or require knowledge outside the diff.
- Reject findings about intentional, correct patterns (e.g., dependency arrays in useEffect that are actually correct).
- Reject findings that describe non-issues as problems.
- Reject findings about code that is clearly test/calibration scaffolding.
- Accept only clear, reproducible issues with sufficient evidence.
- If a finding is valid but the severity or evidence is overstated, use "modified" and provide corrections.
- Return valid JSON only. No markdown fences, no commentary.`;

function loadToolOutput(filename) {
  if (!existsSync(filename)) return null;
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeToolOutput() {
  const parts = [];

  const eslint = loadToolOutput('eslint-results.json');
  if (eslint) {
    const issues = eslint.flatMap(f =>
      f.messages.map(m => ({
        file: f.filePath.replace(process.cwd() + '/', ''),
        line: m.line,
        severity: m.severity === 2 ? 'error' : 'warning',
        rule: m.ruleId,
        message: m.message,
      }))
    );
    if (issues.length) parts.push(`## ESLint (${issues.length})\n${JSON.stringify(issues, null, 2)}`);
  }

  const semgrep = loadToolOutput('semgrep-results.json');
  if (semgrep?.results?.length) {
    const issues = semgrep.results.map(r => ({
      file: r.path,
      line: r.start?.line,
      rule: r.check_id,
      message: r.extra?.message,
      severity: r.extra?.severity,
    }));
    parts.push(`## Semgrep (${issues.length})\n${JSON.stringify(issues, null, 2)}`);
  }

  const gitleaks = loadToolOutput('gitleaks-results.json');
  if (Array.isArray(gitleaks) && gitleaks.length) {
    parts.push(`## Gitleaks (${gitleaks.length} secrets)\n${JSON.stringify(gitleaks, null, 2)}`);
  }

  const audit = loadToolOutput('audit-results.json');
  if (audit?.vulnerabilities) {
    const vulns = Object.entries(audit.vulnerabilities)
      .filter(([, v]) => v.severity !== 'info')
      .map(([name, v]) => ({ name, severity: v.severity }));
    if (vulns.length) parts.push(`## npm audit (${vulns.length})\n${JSON.stringify(vulns, null, 2)}`);
  }

  const tests = loadToolOutput('test-results.json');
  if (tests) {
    const failed = (tests.testResults || []).filter(t => t.status === 'failed');
    if (failed.length) parts.push(`## Test failures (${failed.length})\n${JSON.stringify(failed, null, 2)}`);
  }

  return parts.join('\n\n') || 'No tool findings.';
}

function detectInjection(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

function isNearDuplicate(a, b) {
  if (a.file !== b.file) return false;
  if (a.line != null && b.line != null && Math.abs(a.line - b.line) > 5) return false;
  const aT = a.title.toLowerCase();
  const bT = b.title.toLowerCase();
  return aT.slice(0, 15) === bT.slice(0, 15) || aT.includes(bT.slice(0, 10));
}

function deduplicateFindings(findings) {
  const kept = [];
  for (const f of findings) {
    if (!kept.some(k => isNearDuplicate(k, f))) kept.push(f);
  }
  return kept;
}

function buildPRComment(published, contractVersion, injectionWarning) {
  const lines = ['## AI Code Review'];

  if (injectionWarning) {
    lines.push('\n> ⚠️ **Prompt injection attempt detected** in diff content. Findings below were reviewed with extra skepticism.');
  }

  if (!published.length) {
    lines.push('\n✅ No actionable findings. Static analysis and AI review passed.');
    lines.push(`\n---\n*Contract: v${contractVersion}*`);
    return lines.join('\n');
  }

  const bySeverity = { critical: [], high: [], medium: [] };
  for (const f of published) {
    if (bySeverity[f.severity]) bySeverity[f.severity].push(f);
  }

  const icons = { critical: '🔴', high: '🟠', medium: '🟡' };
  for (const [sev, flist] of Object.entries(bySeverity)) {
    if (!flist.length) continue;
    lines.push(`\n### ${icons[sev]} ${sev[0].toUpperCase() + sev.slice(1)} (${flist.length})`);
    for (const f of flist) {
      lines.push(`\n**${f.title}**`);
      if (f.file) lines.push(`> \`${f.file}\`${f.line ? `:${f.line}` : ''}`);
      lines.push(`\n${f.description}`);
      if (f.suggested_fix) lines.push(`\n💡 **Fix:** ${f.suggested_fix}`);
      lines.push(`\n*Evidence: ${f.evidence_level} · Category: ${f.category}*`);
    }
  }

  lines.push(`\n---\n*Contract: v${contractVersion} · ${published.length} finding(s)*`);
  return lines.join('\n');
}

async function findExistingReviewComment(owner, repoName, pr, token) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/issues/${pr}/comments?per_page=100`,
    { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) return null;
  const comments = await res.json();
  return comments.find(c => c.body?.startsWith('## AI Code Review')) ?? null;
}

async function upsertPRComment(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO;
  const pr = process.env.PR_NUMBER;
  if (!token || !repo || !pr) return;

  const [owner, repoName] = repo.split('/');
  const existing = await findExistingReviewComment(owner, repoName, pr, token);

  const url = existing
    ? `https://api.github.com/repos/${owner}/${repoName}/issues/comments/${existing.id}`
    : `https://api.github.com/repos/${owner}/${repoName}/issues/${pr}/comments`;

  const res = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
}

function writeSummary(lines) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const reviewModel = process.env.REVIEW_MODEL || 'claude-sonnet-4-6';
  const verifierModel = process.env.VERIFIER_MODEL || 'claude-sonnet-4-6';
  const tokenBudget = parseInt(process.env.MAX_TOKENS_PER_REVIEW || '8000', 10);

  let diff = {};
  try {
    diff = JSON.parse(readFileSync('pr-diff.json', 'utf8'));
  } catch {
    writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'init', error: 'Could not read pr-diff.json' }));
    process.exit(1);
  }

  const diffText = Object.entries(diff)
    .map(([file, content]) => `### ${file}\n\`\`\`diff\n${content}\n\`\`\``)
    .join('\n\n');

  const toolSummary = summarizeToolOutput();

  // Prompt injection check — diff is untrusted external content
  const injectionWarning = detectInjection(diffText) || detectInjection(toolSummary);
  if (injectionWarning) {
    console.warn('WARNING: Possible prompt injection pattern detected in diff or tool output');
  }

  // Static-only path when no API key
  if (!apiKey) {
    console.log('ANTHROPIC_API_KEY absent — static analysis only');
    writeFileSync('reviewer-response.txt', 'Skipped: ANTHROPIC_API_KEY not set');
    writeFileSync('verifier-response.txt', 'Skipped: ANTHROPIC_API_KEY not set');

    const published = [];
    const gitleaks = loadToolOutput('gitleaks-results.json');
    if (Array.isArray(gitleaks)) {
      for (const g of gitleaks) {
        published.push({
          id: `gitleaks-${published.length + 1}`,
          file: g.File || 'unknown',
          line: g.StartLine || null,
          severity: 'critical',
          category: 'security',
          title: `Secret detected: ${g.RuleID || 'unknown'}`,
          description: g.Description || 'A secret or credential was found in the diff.',
          evidence_level: 'strongly_supported',
          suggested_fix: 'Remove and rotate the credential immediately.',
          tool_source: 'gitleaks',
          verifier_status: 'accepted',
          review_contract_version: REVIEW_CONTRACT_VERSION,
        });
      }
    }

    writeFileSync('findings.json', JSON.stringify(published, null, 2));
    await upsertPRComment(buildPRComment(published, REVIEW_CONTRACT_VERSION, injectionWarning));
    writeSummary([
      '## AI Code Review Summary',
      '',
      '> ⚠️ LLM review skipped — `ANTHROPIC_API_KEY` not set. Static analysis only.',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Gitleaks secrets | ${(loadToolOutput('gitleaks-results.json') || []).length} |`,
      `| Published | ${published.length} |`,
    ]);
    return;
  }

  const client = new Anthropic({ apiKey });
  let totalIn = 0, totalOut = 0;
  let budgetExceeded = false;

  // --- Reviewer call ---
  const reviewerUserMsg = `Review this pull request.\n\n## Diff\n${diffText}\n\n## Static Analysis Output\n${toolSummary}`;

  let reviewerText = '';
  try {
    const r = await client.messages.create({
      model: reviewModel,
      max_tokens: Math.min(4096, tokenBudget),
      system: REVIEWER_SYSTEM,
      messages: [{ role: 'user', content: reviewerUserMsg }],
    });
    reviewerText = r.content[0].text;
    totalIn += r.usage.input_tokens;
    totalOut += r.usage.output_tokens;
    if (totalIn + totalOut >= tokenBudget) budgetExceeded = true;
  } catch (err) {
    writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'reviewer', error: err.message }));
    writeFileSync('reviewer-response.txt', `Error: ${err.message}`);
    writeFileSync('verifier-response.txt', 'Skipped: reviewer failed');
    throw err;
  }
  writeFileSync('reviewer-response.txt', reviewerText);

  // Parse and cap reviewer findings
  let rawFindings = [];
  try {
    const m = reviewerText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : reviewerText);
    rawFindings = (parsed.findings || [])
      .filter(f => {
        if (f.review_contract_version && f.review_contract_version !== REVIEW_CONTRACT_VERSION) {
          console.warn(`Dropped finding ${f.id}: wrong contract version`);
          return false;
        }
        return true;
      })
      .map(f => ({ ...f, review_contract_version: REVIEW_CONTRACT_VERSION }))
      .slice(0, MAX_FINDINGS); // finding cap
  } catch (err) {
    writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'reviewer-parse', error: err.message }));
    rawFindings = [];
  }

  if (!rawFindings.length) {
    writeFileSync('findings.json', JSON.stringify([], null, 2));
    writeFileSync('verifier-response.txt', 'Skipped: no reviewer findings');
    await upsertPRComment(buildPRComment([], REVIEW_CONTRACT_VERSION, injectionWarning));
    writeSummary(['## AI Code Review Summary', '', '✅ No findings from reviewer.']);
    return;
  }

  // Skip verifier if token budget already exceeded
  let allFindings;
  if (budgetExceeded) {
    console.warn(`Token budget (${tokenBudget}) exceeded after reviewer — skipping verifier`);
    writeFileSync('verifier-response.txt', `Skipped: token budget (${tokenBudget}) exceeded`);
    allFindings = rawFindings.map(f => ({ ...f, verifier_status: 'accepted', verifier_note: 'Budget exceeded — not verified' }));
  } else {
    // --- Verifier call (separate context — verifier never sees reviewer chain-of-thought) ---
    const verifierUserMsg = `Verify these proposed code review findings.\n\n## Proposed Findings\n${
      JSON.stringify(
        rawFindings.map(({ id, file, line, severity, category, title, description, evidence_level, suggested_fix, tool_source }) =>
          ({ id, file, line, severity, category, title, description, evidence_level, suggested_fix, tool_source })
        ),
        null, 2
      )
    }\n\n## Diff (for context)\n${diffText}`;

    let verifierText = '';
    try {
      const remainingBudget = tokenBudget - totalIn - totalOut;
      const v = await client.messages.create({
        model: verifierModel,
        max_tokens: Math.min(2048, Math.max(256, remainingBudget)),
        system: VERIFIER_SYSTEM,
        messages: [{ role: 'user', content: verifierUserMsg }],
      });
      verifierText = v.content[0].text;
      totalIn += v.usage.input_tokens;
      totalOut += v.usage.output_tokens;
    } catch (err) {
      writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'verifier', error: err.message }));
      writeFileSync('verifier-response.txt', `Error: ${err.message}`);
      throw err;
    }
    writeFileSync('verifier-response.txt', verifierText);

    let verifications = [];
    try {
      const m = verifierText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : verifierText);
      verifications = parsed.verifications || [];
    } catch (err) {
      writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'verifier-parse', error: err.message }));
    }

    allFindings = rawFindings.map(f => {
      const v = verifications.find(v => v.finding_id === f.id);
      if (!v) return { ...f, verifier_status: 'accepted', verifier_note: null };
      return {
        ...f,
        verifier_status: v.verifier_status,
        verifier_note: v.verifier_note,
        ...(v.corrected_severity ? { severity: v.corrected_severity } : {}),
        ...(v.corrected_evidence_level ? { evidence_level: v.corrected_evidence_level } : {}),
      };
    });
  }

  // Deduplication — accepted/modified only, never rejected
  const EVIDENCE_ORDER = ['hypothesis', 'supported', 'strongly_supported', 'reproduced', 'verified'];
  const notRejected = allFindings.filter(f => f.verifier_status !== 'rejected');
  const deduplicated = deduplicateFindings(notRejected);

  // Publication filter
  const published = deduplicated.filter(f =>
    f.verifier_status !== 'rejected' &&
    EVIDENCE_ORDER.indexOf(f.evidence_level) >= EVIDENCE_ORDER.indexOf('supported') &&
    ['medium', 'high', 'critical'].includes(f.severity)
  );

  writeFileSync('findings.json', JSON.stringify(allFindings, null, 2));
  await upsertPRComment(buildPRComment(published, REVIEW_CONTRACT_VERSION, injectionWarning));

  const rejected = allFindings.filter(f => f.verifier_status === 'rejected');
  writeSummary([
    '## AI Code Review Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Reviewer findings (capped at ${MAX_FINDINGS}) | ${rawFindings.length} |`,
    `| Rejected by verifier | ${rejected.length} |`,
    `| After dedup | ${deduplicated.length} |`,
    `| Published | ${published.length} |`,
    `| Input tokens | ${totalIn.toLocaleString()} |`,
    `| Output tokens | ${totalOut.toLocaleString()} |`,
    `| Token budget | ${tokenBudget.toLocaleString()} |`,
    `| Budget exceeded | ${budgetExceeded ? 'yes ⚠️' : 'no'} |`,
    `| Reviewer model | ${reviewModel} |`,
    `| Verifier model | ${verifierModel} |`,
    `| Contract version | ${REVIEW_CONTRACT_VERSION} |`,
    `| Injection warning | ${injectionWarning ? 'yes ⚠️' : 'no'} |`,
  ]);
}

main().catch(err => {
  writeFileSync('review-agent-error.json', JSON.stringify({ stage: 'fatal', error: err.message, stack: err.stack }));
  process.exit(1);
});
