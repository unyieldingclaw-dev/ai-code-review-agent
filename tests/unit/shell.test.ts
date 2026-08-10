import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { runTool } from '../../src/utils/shell.js'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
const mockSpawn = vi.mocked(spawn)

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  return proc
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runTool', () => {
  it('resolves trimmed stdout on successful close', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('gitleaks', ['detect'])
    proc.stdout.emit('data', Buffer.from('hello\n'))
    proc.emit('close')
    await expect(promise).resolves.toBe('hello')
  })

  it('resolves null on ENOENT (tool not installed)', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('missing-tool', [])
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' })
    proc.emit('error', err)
    await expect(promise).resolves.toBeNull()
  })

  it('rejects on non-ENOENT spawn errors', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('broken-tool', [])
    const err = Object.assign(new Error('boom'), { code: 'EACCES' })
    proc.emit('error', err)
    await expect(promise).rejects.toThrow('boom')
  })

  it('writes stdinData to the child process and closes stdin', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('cmd', [], 'input data')
    proc.emit('close')
    await promise
    expect(proc.stdin.write).toHaveBeenCalledWith('input data')
    expect(proc.stdin.end).toHaveBeenCalled()
  })

  it('does not enable a shell by default', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('gitleaks', ['detect', '--source', 'some/file.ts'])
    proc.emit('close')
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'gitleaks',
      ['detect', '--source', 'some/file.ts'],
      expect.not.objectContaining({ shell: true })
    )
  })

  it('enables a shell when explicitly requested, for commands like npm that Node refuses to spawn as .cmd/.bat files without one', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('npm', ['audit', '--json'], undefined, true)
    proc.emit('close')
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'npm',
      ['audit', '--json'],
      expect.objectContaining({ shell: true })
    )
  })

  it('passes cwd through to spawn when provided, so tools resolve paths against the reviewed project instead of the process cwd', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('npm', ['audit', '--json'], undefined, true, '/some/other/project')
    proc.emit('close')
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'npm',
      ['audit', '--json'],
      expect.objectContaining({ cwd: '/some/other/project' })
    )
  })

  it('logs stderr when the process exits nonzero with no stdout (installed but broken)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('gitleaks', ['detect'])
    proc.stderr.emit('data', Buffer.from('panic: bad config\n'))
    proc.emit('close', 1)
    await expect(promise).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('panic: bad config'))
  })

  it('does not log when the process exits nonzero but still produced stdout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('npm', ['audit', '--json'])
    proc.stdout.emit('data', Buffer.from('{"vulnerabilities":{}}'))
    proc.emit('close', 1) // npm audit exits nonzero when it finds vulnerabilities -- not a failure
    await expect(promise).resolves.toBe('{"vulnerabilities":{}}')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('defaults cwd to undefined (process cwd) when not provided', async () => {
    const proc = fakeProcess()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawn.mockReturnValue(proc as any)
    const promise = runTool('gitleaks', ['detect'])
    proc.emit('close')
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'gitleaks',
      ['detect'],
      expect.objectContaining({ cwd: undefined })
    )
  })
})
