// tests/unit/postinstall.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/fake/home'),
  }
})

import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { copyCommandFile, resolveEffectiveHomeDir } from '../../scripts/postinstall.mjs'

describe('postinstall copyCommandFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies the command file into ~/.claude/commands when the source exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)

    copyCommandFile()

    expect(mkdirSync).toHaveBeenCalledWith(join('/fake/home', '.claude', 'commands'), {
      recursive: true,
    })
    expect(copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining(join('.claude', 'commands', 'ai-review.md')),
      join('/fake/home', '.claude', 'commands', 'ai-review.md')
    )
  })

  it('skips silently when the source command file is missing', () => {
    vi.mocked(existsSync).mockReturnValue(false)

    copyCommandFile()

    expect(mkdirSync).not.toHaveBeenCalled()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('fails open (does not throw) when the copy itself errors', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(mkdirSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    expect(() => copyCommandFile()).not.toThrow()
  })
})

describe('postinstall resolveEffectiveHomeDir', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalGetuid = (process as unknown as { getuid?: () => number }).getuid
  const hadGetuid = 'getuid' in process
  const originalSudoUser = process.env.SUDO_USER

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (hadGetuid) {
      Object.defineProperty(process, 'getuid', {
        value: originalGetuid,
        configurable: true,
        writable: true,
      })
    } else {
      delete (process as unknown as { getuid?: () => number }).getuid
    }
    if (originalSudoUser === undefined) {
      delete process.env.SUDO_USER
    } else {
      process.env.SUDO_USER = originalSudoUser
    }
  })

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  function setGetuid(uid: number) {
    Object.defineProperty(process, 'getuid', {
      value: () => uid,
      configurable: true,
      writable: true,
    })
  }

  it('uses os.homedir() when not root (no getuid or getuid() returns non-zero)', () => {
    setPlatform('linux')
    delete (process as unknown as { getuid?: () => number }).getuid
    delete process.env.SUDO_USER

    expect(resolveEffectiveHomeDir()).toBe('/fake/home')
  })

  it('uses os.homedir() when getuid() returns non-zero, even with SUDO_USER set', () => {
    setPlatform('linux')
    setGetuid(1000)
    process.env.SUDO_USER = 'alice'

    expect(resolveEffectiveHomeDir()).toBe('/fake/home')
  })

  it('uses the SUDO_USER home directory when root and the candidate directory exists', () => {
    setPlatform('linux')
    setGetuid(0)
    process.env.SUDO_USER = 'alice'
    vi.mocked(existsSync).mockReturnValue(true)

    expect(resolveEffectiveHomeDir()).toBe(join('/home', 'alice'))
    expect(existsSync).toHaveBeenCalledWith(join('/home', 'alice'))
  })

  it('falls back to os.homedir() when root and the SUDO_USER candidate does not exist', () => {
    setPlatform('linux')
    setGetuid(0)
    process.env.SUDO_USER = 'alice'
    vi.mocked(existsSync).mockReturnValue(false)

    expect(resolveEffectiveHomeDir()).toBe('/fake/home')
  })

  it('always uses os.homedir() on win32, regardless of root/SUDO_USER', () => {
    setPlatform('win32')
    setGetuid(0)
    process.env.SUDO_USER = 'alice'

    expect(resolveEffectiveHomeDir()).toBe('/fake/home')
    expect(existsSync).not.toHaveBeenCalled()
  })
})
