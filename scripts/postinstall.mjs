#!/usr/bin/env node
// Plain JS, not compiled TypeScript: `postinstall` can fire before `npm run build` has ever
// produced dist/ (e.g. a contributor's first `npm install` right after cloning). A dist/-based
// entrypoint would make npm install itself fail in that window -- this file must always exist
// and always be runnable with zero build step.
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

// WHY: `sudo npm install -g` runs postinstall as root, so plain homedir() resolves to root's
// home instead of the invoking user's -- the file would land where the user never looks.
export function resolveEffectiveHomeDir() {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    return homedir()
  }
  const sudoUser = process.env.SUDO_USER
  if (process.getuid() === 0 && sudoUser && sudoUser !== 'root') {
    const candidate =
      process.platform === 'darwin' ? join('/Users', sudoUser) : join('/home', sudoUser)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return homedir()
}

export function copyCommandFile() {
  try {
    const source = join(__dirname, '..', '.claude', 'commands', 'ai-review.md')
    if (!existsSync(source)) {
      console.warn(
        '[ai-review-agent] postinstall: source command file not found, skipping /ai-review install'
      )
      return
    }
    const destDir = join(resolveEffectiveHomeDir(), '.claude', 'commands')
    mkdirSync(destDir, { recursive: true })
    copyFileSync(source, join(destDir, 'ai-review.md'))
  } catch (err) {
    // WHY fail-open: a permissions issue or unusual environment here must never fail the
    // whole `npm install` -- this is a convenience nicety, not a required install step.
    console.warn(
      `[ai-review-agent] postinstall: could not install /ai-review command (${err.message}) -- continuing`
    )
  }
}

if (process.env.NODE_ENV !== 'test') {
  copyCommandFile()
}
