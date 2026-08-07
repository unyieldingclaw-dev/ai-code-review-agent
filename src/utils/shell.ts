import { spawn } from 'child_process'

// `shell` defaults to false -- args (e.g. gitleaks' --source <file>) can carry diff-derived file
// paths from an untrusted PR, and shelling out would let crafted paths inject shell metacharacters.
// Only pass shell:true for a command whose args are always hardcoded, never diff-derived (e.g.
// npm audit --json) -- Node itself refuses to spawn a .cmd/.bat file like npm on Windows without
// it (a deliberate restriction, not configurable another way).
export function runTool(
  cmd: string,
  args: string[],
  stdinData?: string,
  shell = false,
  cwd?: string
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const proc = spawn(cmd, args, {
      stdio: stdinData !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell,
      cwd,
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
