import { spawn } from 'child_process'

export function runTool(cmd: string, args: string[], stdinData?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const proc = spawn(cmd, args, {
      stdio: stdinData !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    })
    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
    }
    proc.stderr?.on('data', () => {})
    proc.on('error', (err: Error) => {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') resolve(null)
      else reject(err)
    })
    // Use 'close' (not 'exit') — gitleaks exits non-zero when secrets are found,
    // but we still want to read its output.
    proc.on('close', () => resolve(stdout.trim() || null))
    if (stdinData !== undefined && proc.stdin) {
      proc.stdin.write(stdinData)
      proc.stdin.end()
    }
  })
}
