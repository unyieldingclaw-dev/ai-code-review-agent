#!/usr/bin/env node
// Runs the unit suite inside a Linux container instead of on the host.
//
// WHY this exists: Windows Smart App Control blocks rolldown's unsigned native binding
// (`ERR_DLOPEN_FAILED: An Application Control policy has blocked this file`), and vitest 4 depends
// on rolldown, so `npm test` cannot start on an affected machine. npm misreports the failure as its
// optional-dependency lockfile bug and advises deleting node_modules and package-lock.json -- that
// advice does not help, because the correct binding is present and intact; the loader is being
// denied by policy. Smart App Control has no exclusion list by design, and turning it off cannot be
// undone without reinstalling Windows, so a container is the proportionate escape hatch.
//
// WHY a script and not an inline npm script: the host path has to be absolute for `docker -v`, and
// `${PWD}` does not expand under cmd.exe, which is what npm uses as its default shell on Windows.
// process.cwd() is correct on every platform.
//
// This is a convenience for local runs. CI runs the suite natively on ubuntu-latest and remains the
// authoritative gate.

import { spawnSync } from 'node:child_process'

const IMAGE = 'node:24'

const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
  shell: false,
})
if (probe.error || probe.status !== 0) {
  console.error(
    'docker is unavailable, so the containerised suite cannot run.\n' +
      'Start Docker Desktop, or run `npm test` directly if your machine can load native modules.'
  )
  process.exit(1)
}

// The anonymous volume on /app/node_modules shadows the host's node_modules inside the container.
// Without it the bind mount would expose Windows-built native binaries to a Linux runtime, which
// fails in a far more confusing way than the problem this script exists to avoid.
const args = [
  'run',
  '--rm',
  '-v',
  `${process.cwd()}:/app`,
  '-v',
  '/app/node_modules',
  '-w',
  '/app',
  IMAGE,
  'sh',
  '-c',
  'npm ci && npm test',
]

const run = spawnSync('docker', args, { stdio: 'inherit', shell: false })
process.exit(run.status ?? 1)
