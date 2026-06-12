import { vi } from 'vitest'

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
  SourceControl = 1,
}

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export class Diagnostic {
  public source?: string
  public code?: string | number | { value: string | number; target: unknown }

  constructor(
    public range: Range,
    public message: string,
    public severity?: DiagnosticSeverity
  ) {}
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
}

export const languages = {
  createDiagnosticCollection: vi.fn(() => ({
    set: vi.fn(),
    clear: vi.fn(),
    delete: vi.fn(),
    dispose: vi.fn(),
  })),
}

export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  withProgress: vi.fn(
    (
      _opts: unknown,
      task: (
        progress: { report: (v: unknown) => void },
        token: { isCancellationRequested: boolean }
      ) => unknown
    ) => task({ report: vi.fn() }, { isCancellationRequested: false })
  ),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
}

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
}

export const workspace = {
  // Base mock always returns the default value.
  // For key-specific behavior in tests, use vi.mocked(workspace.getConfiguration).mockReturnValue(...)
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
  })),
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
}
