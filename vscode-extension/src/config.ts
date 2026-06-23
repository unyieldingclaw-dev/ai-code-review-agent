import * as vscode from 'vscode'
import * as path from 'path'
import type { ExtensionConfig } from './types'

/**
 * Read aiReview.* settings from the VS Code workspace configuration and
 * resolve the bundled CLI path relative to the extension install directory.
 */
export function getConfig(extensionPath: string): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiReview')

  return {
    ollamaUrl: cfg.get('ollamaUrl', 'http://localhost:11434'),
    model: cfg.get('model', 'devstral:latest'),
    agents: cfg.get<string[]>('agents', []),
    maxLines: cfg.get('maxLines', 2000),
    timeoutSecs: cfg.get('timeout', 120),
    cliPath: path.join(extensionPath, 'node_modules', 'ai-review-agent', 'dist', 'cli', 'index.js'),
  }
}

/**
 * Build the argument array for spawning the CLI subprocess.
 * The caller provides the temp diff file path; this function handles all
 * the flag assembly including the seconds→ms conversion for --timeout.
 */
export function buildCliArgs(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string
): string[] {
  const args = [
    config.cliPath,
    '--diff',
    diffFile,
    '--dir',
    workspaceDir,
    '--format',
    'json',
    '--ollama-url',
    config.ollamaUrl,
    '--model',
    config.model,
    '--max-lines',
    String(config.maxLines),
    '--timeout',
    String(config.timeoutSecs * 1000), // CLI takes milliseconds
    '--fail-on',
    'never', // extension handles results; never let CLI gate on exit code
  ]

  if (config.agents.length > 0) {
    args.push('--agents', config.agents.join(','))
  }

  return args
}
