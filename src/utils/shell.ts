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
    let stderr = ''
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
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', (err: Error) => {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') resolve(null)
      else reject(err)
    })
    // Use 'close' (not 'exit') — npm audit exits non-zero when vulnerabilities are found (and
    // gitleaks would too without secrets.ts's --exit-code 0), but we still want to read stdout.
    proc.on('close', (code) => {
      const trimmed = stdout.trim()
      // WHY log here: ENOENT ('error' above, tool not installed) and "ran but produced no usable
      // stdout" both resolve null to the caller, which is indistinguishable from the outside --
      // callers fall back to the LLM either way with no signal why. A nonzero exit with empty
      // stdout means the tool IS installed but failed (bad args, crash, incompatible version) --
      // surfacing stderr here distinguishes that case without changing the return contract.
      if (!trimmed && code !== 0) {
        console.error(
          `[shell] ${cmd} exited ${code} with no output${stderr.trim() ? `: ${stderr.trim()}` : ''}`
        )
      }
      resolve(trimmed || null)
    })
    if (stdinData !== undefined && proc.stdin) {
      proc.stdin.write(stdinData)
      proc.stdin.end()
    }
  })
}
