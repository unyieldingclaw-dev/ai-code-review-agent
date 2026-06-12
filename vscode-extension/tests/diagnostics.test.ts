import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import type { Finding } from '../src/types'

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1', agent: 'security', severity: 'high', basis: 'VERIFIED',
    file: 'src/auth.ts', line: 10, title: 'Test Finding',
    detail: 'Detail text', suggestion: 'Fix it',
    ...overrides,
  }
}

describe('applyDiagnostics', () => {
  let collection: ReturnType<typeof vscode.languages.createDiagnosticCollection>

  beforeEach(() => {
    vi.clearAllMocks()
    collection = vscode.languages.createDiagnosticCollection('test')
  })

  it('clears the collection before applying new diagnostics', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')
    expect(collection.clear).toHaveBeenCalledOnce()
  })

  it('maps critical severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'critical' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error })])
    )
  })

  it('maps high severity → DiagnosticSeverity.Error', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'high' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ severity: vscode.DiagnosticSeverity.Error })])
    )
  })

  it('maps medium severity → DiagnosticSeverity.Warning', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'medium' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ severity: vscode.DiagnosticSeverity.Warning })])
    )
  })

  it('maps low severity → DiagnosticSeverity.Information', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ severity: 'low' })], '/workspace')
    expect(collection.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ severity: vscode.DiagnosticSeverity.Information })])
    )
  })

  it('converts line 1 → range startLine 0 (1-based to 0-based)', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ line: 1 })], '/workspace')
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect((diags[0].range as vscode.Range).startLine).toBe(0)
  })

  it('converts line 42 → range startLine 41', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [makeFinding({ line: 42 })], '/workspace')
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect((diags[0].range as vscode.Range).startLine).toBe(41)
  })

  it('groups findings from same file into one collection.set call', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    const findings = [
      makeFinding({ id: 'f1', file: 'src/shared.ts', line: 1 }),
      makeFinding({ id: 'f2', file: 'src/shared.ts', line: 5, severity: 'medium' }),
    ]
    applyDiagnostics(collection as any, findings, '/workspace')
    expect(collection.set).toHaveBeenCalledTimes(1)
    const [, diags] = vi.mocked(collection.set).mock.calls[0] as [unknown, vscode.Diagnostic[]]
    expect(diags).toHaveLength(2)
  })

  it('calls collection.set once per unique file', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [
      makeFinding({ id: 'f1', file: 'src/a.ts', line: 1 }),
      makeFinding({ id: 'f2', file: 'src/b.ts', line: 2 }),
    ], '/workspace')
    expect(collection.set).toHaveBeenCalledTimes(2)
  })

  it('does nothing except clear when findings is empty', async () => {
    const { applyDiagnostics } = await import('../src/diagnostics')
    applyDiagnostics(collection as any, [], '/workspace')
    expect(collection.clear).toHaveBeenCalledOnce()
    expect(collection.set).not.toHaveBeenCalled()
  })
})
