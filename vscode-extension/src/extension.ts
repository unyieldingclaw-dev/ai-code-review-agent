import * as vscode from 'vscode'
import { getConfig } from './config'
import { runReview } from './runner'
import { applyDiagnostics } from './diagnostics'
import { renderReport } from './output'

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('ai-review')
  const channel = vscode.window.createOutputChannel('AI Review')

  context.subscriptions.push(collection)
  context.subscriptions.push(channel)

  const command = vscode.commands.registerCommand(
    'aiReview.reviewStagedChanges',
    async () => {
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!workspaceDir) {
        vscode.window.showErrorMessage('AI Review: No workspace folder open.')
        return
      }

      const config = getConfig(context.extensionPath)

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'AI Review running…',
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const result = await runReview(config, workspaceDir, token)

            // Diagnostics cleared and replaced atomically after the run completes
            applyDiagnostics(collection, result.findings, workspaceDir)
            renderReport(channel, result)

            // Show the report but keep editor focus (preserveFocus = true)
            channel.show(true)

            const count = result.summary.totalFindings
            const plural = count === 1 ? 'finding' : 'findings'
            const summary = `AI Review complete — ${count} ${plural}`
            const choice = await vscode.window.showInformationMessage(summary, 'View Report')
            if (choice === 'View Report') {
              channel.show(false)
            }
          } catch (err) {
            handleRunError(err as Error, config.ollamaUrl, channel)
          }
        }
      )
    }
  )

  context.subscriptions.push(command)
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically; nothing to clean up here
}

function handleRunError(
  err: Error,
  ollamaUrl: string,
  channel: vscode.OutputChannel
): void {
  const msg = err.message

  if (msg === 'cancelled') {
    return  // user clicked Cancel — no notification needed
  }

  if (msg === 'nothing-staged') {
    vscode.window.showErrorMessage(
      'AI Review: No staged changes found. Stage your changes with `git add` and try again.'
    )
    return
  }

  if (msg.startsWith('git not found')) {
    vscode.window.showErrorMessage(
      'AI Review: git not found. Ensure git is installed and in your PATH.'
    )
    return
  }

  if (msg.startsWith('ollama-unreachable:')) {
    const url = msg.slice('ollama-unreachable:'.length)
    vscode.window.showErrorMessage(
      `AI Review: Ollama is not running at ${url}. Start it with \`ollama serve\`.`,
      'Open Settings'
    ).then(choice => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiReview.ollamaUrl')
      }
    })
    return
  }

  if (msg.startsWith('parse-error:')) {
    channel.appendLine('\n--- Raw CLI output (parse failed) ---')
    channel.appendLine(msg.slice('parse-error:'.length))
    channel.show(true)
    vscode.window.showErrorMessage(
      'AI Review: Unexpected output from the CLI. See the "AI Review" output panel for details.'
    )
    return
  }

  // cli-error or anything else
  channel.appendLine(`\n--- Error ---\n${msg}`)
  channel.show(true)
  vscode.window.showErrorMessage(
    'AI Review failed. See the "AI Review" output panel for details.'
  )
}
