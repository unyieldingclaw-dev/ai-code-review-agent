import { execSync, spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as vscode from 'vscode'
import { buildCliArgs, calculateSubprocessTimeoutMs } from './config'
import type { ExtensionConfig, ReviewResult } from './types'

// Exit codes for which the CLI writes a complete JSON ReviewResult to stdout:
// 0 = clean, 2 = partial/total agent failure (agentStatus), 3 = diff truncated (truncation).
const REPORT_EXIT_CODES = new Set([0, 2, 3])

/**
 * Get the staged diff, spawn the CLI, parse the result.
 *
 * Throws:
 *   'nothing-staged'          — git diff --cached returned empty; user must git add first
 *   'git not found'           — git binary not on PATH
 *   'cancelled'               — user clicked Cancel in the progress notification
 *   'ollama-unreachable:<url>'— CLI exited non-zero with ECONNREFUSED in stderr
 *   'cli-error:<stderr>'      — CLI exited non-zero for another reason
 *   'parse-error:<fragment>'  — stdout contained no parseable JSON object
 *   'timed out after <N>s'    — CLI did not close within subprocessTimeoutMs (Ollama stalled)
 */
export async function runReview(
  config: ExtensionConfig,
  workspaceDir: string,
  token: vscode.CancellationToken,
  subprocessTimeoutMs?: number
): Promise<ReviewResult> {
  const diff = getStagedDiff(workspaceDir)
  const effectiveSubprocessTimeoutMs =
    subprocessTimeoutMs ?? calculateSubprocessTimeoutMs(config, diff.split('\n').length)

  const tempFile = join(tmpdir(), `ai-review-${Date.now()}.diff`)
  writeFileSync(tempFile, diff, 'utf-8')

  try {
    return await spawnCli(config, workspaceDir, tempFile, token, effectiveSubprocessTimeoutMs)
  } finally {
    try {
      unlinkSync(tempFile)
    } catch {
      /* ignore cleanup failure */
    }
  }
}

function getStagedDiff(workspaceDir: string): string {
  let diff: string
  try {
    diff = execSync('git diff --cached', { cwd: workspaceDir, encoding: 'utf-8' }) as string
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT' || (e.message ?? '').toLowerCase().includes('enoent')) {
      throw new Error('git not found. Ensure git is installed and in your PATH.')
    }
    throw err
  }

  if (!diff.trim()) {
    throw new Error('nothing-staged')
  }

  return diff
}

function spawnCli(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string,
  token: vscode.CancellationToken,
  subprocessTimeoutMs: number
): Promise<ReviewResult> {
  return new Promise((resolve, reject) => {
    const args = buildCliArgs(config, workspaceDir, diffFile)
    // args[0] is the CLI path; process.execPath is the Node binary
    const child = spawn(process.execPath, args, { cwd: workspaceDir })

    // Wall-clock timeout — kills the child if CLI hangs (e.g. Ollama stalled)
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGTERM')
      reject(
        new Error(
          `ai-review-agent timed out after ${Math.round(subprocessTimeoutMs / 1000)}s. ` +
            `Is Ollama running? Try reducing --timeout or agent count.`
        )
      )
    }, subprocessTimeoutMs)

    // Register cancellation handler; keep Disposable to clean up on close
    const cancelDisposable = token.onCancellationRequested(() => {
      clearTimeout(timeoutHandle)
      child.kill()
      reject(new Error('cancelled'))
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutHandle)
      cancelDisposable.dispose()

      if (code === null || !REPORT_EXIT_CODES.has(code)) {
        if (stderr.includes('ECONNREFUSED') || stderr.includes('Ollama not reachable')) {
          reject(new Error(`ollama-unreachable:${config.ollamaUrl}`))
        } else {
          reject(new Error(`cli-error:${stderr.slice(0, 500)}`))
        }
        return
      }

      // stdout = progress lines + "\n" + JSON. Find where the JSON object begins.
      const jsonStart = stdout.indexOf('{')
      if (jsonStart === -1) {
        reject(new Error(`parse-error:${stdout.slice(0, 200)}`))
        return
      }

      try {
        const result: ReviewResult = JSON.parse(stdout.slice(jsonStart))
        resolve(result)
      } catch {
        reject(new Error(`parse-error:${stdout.slice(jsonStart, jsonStart + 200)}`))
      }
    })
  })
}
