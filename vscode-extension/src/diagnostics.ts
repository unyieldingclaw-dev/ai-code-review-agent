import * as vscode from 'vscode'
import * as path from 'path'
import type { Finding, Severity } from './types'

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
}

/**
 * Replace the entire DiagnosticCollection with new findings.
 * Cleared first (atomically replacing old results when new ones arrive).
 * Findings are grouped by file; each file gets one collection.set() call.
 *
 * Finding.line is 1-based; VS Code Range is 0-based — subtract 1.
 * Range spans the full line (column 0 to MAX_SAFE_INTEGER) so the squiggle
 * covers the whole line when no column info is available.
 */
export function applyDiagnostics(
  collection: vscode.DiagnosticCollection,
  findings: Finding[],
  workspaceDir: string
): void {
  collection.clear()

  // Group by absolute file path, keeping the URI alongside the diagnostics
  const byFile = new Map<string, [vscode.Uri, vscode.Diagnostic[]]>()

  for (const finding of findings) {
    const uri = vscode.Uri.file(path.join(workspaceDir, finding.file))
    const key = uri.fsPath.toLowerCase()

    const line = Math.max(0, finding.line - 1) // 1-based → 0-based
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)
    const severity = SEVERITY_MAP[finding.severity] ?? vscode.DiagnosticSeverity.Information

    const diag = new vscode.Diagnostic(
      range,
      `[${finding.agent}] ${finding.title}: ${finding.detail}`,
      severity
    )
    diag.source = 'AI Review'
    diag.code = finding.id

    if (!byFile.has(key)) {
      byFile.set(key, [uri, []])
    }
    byFile.get(key)![1].push(diag)
  }

  for (const [, [uri, diags]] of byFile) {
    collection.set(uri, diags)
  }
}
