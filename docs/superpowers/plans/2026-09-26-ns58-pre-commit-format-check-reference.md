# NS-58 reference implementation — pre-commit format-check dispatch

**Status: hand-off for upstream PMB (item NS-58), not a plan for this repo. A draft only — no hook in
this repo uses it.** The bash block below was run against the case matrix in "What was tested"
(2026-10-23). An earlier revision of the block was wrong; see "Revision history" before relying on
anything older than this text. `PMB:memory-bank/activeContext.md` (item 58) is authoritative. As of
2026-10-23 it records that the user chose a different design (the shipped hook passes staged paths to
a format-check script the consuming repo owns) and that the work is in progress, so the inline block
below is the reference variant, kept for its defect list and tested cases.

## Context

`.githooks/pre-commit` is `TEMPLATE_OWNED`. This repo's copy of PMB's hook guide says so under
"Git Hooks (versioned) → How it works" (`ours:docs/HOOKS-GUIDE.md`): "`mb upgrade` treats
`.githooks/pre-push` and `.githooks/pre-commit` as `TEMPLATE_OWNED` — it overwrites them
unconditionally if they differ from the template". (That guide is `ADVISORY_CREATE`, so this repo's
copy can lag PMB's.) A local-only edit to that file cannot survive an `mb upgrade`, so a candidate
fix was drafted and then reported upstream as **NS-58** rather than committed here. This file exists
so the draft isn't lost before someone picks NS-58 up.

The problem NS-58 addresses: `calibration/*.json` output in this repo can reach a commit without
passing through an editor's format-on-save, which repeatedly broke CI's "Format check" step on PRs.
The paragraph beginning "A third instance, drafted then deliberately not committed here" in
`ours:memory-bank/techContext.md` records it. Since then `calibration/calibrate.ts` formats its own
oracle log at write time, which covers that one writer. Anything not written by that script
(hand-saved output, CLI `--out` captures, `active-task.json`, plan docs) is still unprotected, and a
commit-time check is the only thing that would cover all of it. The check runs the same prettier
check CI runs, but on the working-tree copy of the staged paths rather than the whole repo, and
locally, before a PR round-trip.

## What the first draft got wrong, and how this block handles each

Three bugs and one hardening gap. All were reproduced by running code, except item 2's exact error
text, which was not re-observed (see "Not tested"):

1. **An unquoted `echo "$list" | xargs` word-splits filenames containing spaces.** A staged
   `dir with space/a.json` became three bogus arguments, prettier reported "No files matching the
   pattern" for each, and the hook said "not formatted" about a file it never checked. **Fix: the
   NUL-delimited output of `git diff -z` is piped straight into `xargs -0`, with no shell variable in
   between.** Bash command substitution cannot hold NUL bytes, so storing the list in a variable
   silently destroys the delimiters (see "Revision history"). An emptiness test on the pipe's input
   is done with `git diff --cached --quiet --diff-filter=ACMR` instead.

2. **`npx --no-install prettier` fails on a fresh clone before `npm install`**, with an error
   (`npx canceled due to missing packages`) the hook couldn't tell apart from a real formatting
   failure, so it printed "not formatted, run `npm run format`". **Fix: probe
   `npx --no-install prettier --version` first** and, if it fails, print a distinct warning and let
   the commit through.

3. **`--diff-filter=ACM` excludes renamed files (status `R`)**, so a renamed-and-modified file
   skipped the check. **Fix: `--diff-filter=ACMR`.** Verified with a real rename (git status
   `R088`): the `ACM` filter listed nothing and an `ACM`-only copy of the hook let the unformatted
   file through; `ACMR` caught it.

4. **No `--` before the file list**, so a staged filename starting with `-` could be read by
   prettier as an option (`--plugin=...` loads and runs a JS module). Low practical urgency for a
   solo local-dev repo, but free to fix. **Fix: `--` before the file list.**

Design note: this block calls `npx prettier --check` directly, a second place that defines what
"formatted" means, which can drift from CI's config. The design PMB recorded (see the header) has the
hook delegate to a script the consuming repo owns, which this block does not do.

## Reference implementation

This is the block that would need to ship inside PMB's `.githooks/pre-commit` **template** (the call
itself must come from the template: a locally-added `scripts/pre-commit-check.*` alone doesn't
survive `mb upgrade` unless the template's hook also ships the line that calls it):

```bash
# Blocks a commit if any staged file fails a format check, so a formatter mismatch is caught at
# commit time instead of surfacing as a CI "Format check" failure after a PR round-trip (NS-58).
# The file list is piped straight into xargs -0 and never held in a shell variable: bash command
# substitution drops NUL bytes, which would merge every path into one.
if ! git diff --cached --quiet --diff-filter=ACMR; then
  if ! command -v npx >/dev/null 2>&1 || ! npx --no-install prettier --version >/dev/null 2>&1; then
    echo "WARNING: prettier is not installed (run 'npm install') -- skipping the local format check."
    echo "CI's Format check step will still run against your push."
  elif ! git diff --cached --name-only -z --diff-filter=ACMR |
      xargs -0 npx --no-install prettier --check --ignore-unknown --; then
    echo "ERROR: staged files are not formatted. Run 'npm run format', then re-stage and commit again."
    exit 1
  fi
fi
```

Behavioral notes for whoever adapts this:

- **Fails open.** If `npx` is missing or `npx --no-install prettier --version` fails for any reason
  (not installed, broken `node_modules`, a failing `npx`), the check is skipped with a warning and
  the commit proceeds. That is deliberate: blocking every commit on a fresh clone is the bug being
  fixed, and CI remains the backstop. It does mean a broken install silently disables the check.
- **Checks the working tree, not the index.** Prettier reads files from disk. With partial staging
  (`git add -p`), it can pass or fail on content that is not what will be committed. Observed in the
  matrix (case P).
- `--diff-filter=ACMR` leaves out pure deletions, which is correct: a deleted file has nothing left
  to format-check. A commit staging only deletions skips the check.
- `-r` (skip `xargs` on empty input) is not used: it is GNU/BSD-specific, and the
  `git diff --quiet` guard already covers empty input.
- `mapfile -d ''` is not used as an alternative: it needs bash 4.4+, and macOS ships 3.2.

## What was tested

Run on 2026-10-23 in throwaway git repos, using Git for Windows' bash 5.3.15, git 2.55.0, on
Windows 11, with this repo's `.prettierrc` (`printWidth` 100, no semicolons). Prettier resolved by
`npx --no-install` was **3.9.10**; this repo's lockfile resolves 3.8.4, so the matrix did not run
against that version. The block was run as a standalone script (`bash hook.sh`) for A–K and P, and
installed as `.git/hooks/pre-commit` with real commits for L1–L2.

| Case | Setup                                                         | Result                              |
| ---- | ------------------------------------------------------------- | ----------------------------------- |
| A    | Nothing staged                                                | exit 0, quiet                       |
| B    | Only a deletion staged                                        | exit 0                              |
| C    | 1 formatted file                                              | exit 0                              |
| D    | 1 unformatted file                                            | exit 1                              |
| E    | 2 formatted files                                             | exit 0                              |
| F    | 4 formatted files incl. a path with spaces and a `-dash.json` | exit 0                              |
| G    | 1 good + 1 bad file                                           | exit 1, names only the bad file     |
| H    | Real rename (`R088`) with one line made unformatted           | exit 1; `ACM`-only control exits 0  |
| I    | File literally named `--plugin=evil.js`                       | treated as a path, no plugin loaded |
| J    | Unknown file types (`.sh`, `.bin`)                            | exit 0 (`--ignore-unknown`)         |
| K    | `npx` replaced by a failing shim                              | warning printed, exit 0             |
| L1   | Real commit, 2 formatted files                                | commit succeeds                     |
| L2   | Real commit, 1 good + 1 bad file                              | commit blocked, exit 1              |
| P    | Index unformatted, working tree formatted (partial staging)   | exit 0 (passes on the disk copy)    |

## Not tested

- A newline inside a filename: NTFS forbids it, so it can't be created on this machine. Whether
  `xargs -0` handles it is untested here, though NUL-delimiting is designed for it.
- Linux and macOS, including bash 3.2 (macOS) and dash. Only Git for Windows' bash was run.
- The real fresh-clone failure (`npx canceled due to missing packages`). Case K simulates it with a
  failing `npx`; the real message was never reproduced.
- The lockfile's prettier version (see above), and a very large number of staged files.
- Seen in review runs but not part of the matrix: a CRLF working-tree file (the index is normalized
  to LF) is rejected by the hook though CI accepts it, and `npm run format` fixes it; a staged path
  missing from disk, a staged gitlink and invalid JSON all print the misleading "not formatted"
  message; `npx --no-install` can resolve a cached prettier even when the repo has none, so the
  missing-prettier probe may not fire; and the hook runs the repo's prettier config and plugins on
  every commit, the same exposure as `npm run format:check`.
- The matrix scripts were session scratch and were not preserved, so the table cannot be re-run from
  this repo.
- There is no automated test for this hook, and none for `.githooks/pre-push` either. Whoever lands
  NS-58 should decide whether a test belongs in the same change.

## Revision history

1. **First draft** (a bash block added to this repo's `.githooks/pre-commit`; never committed).
   Review found three bugs and one hardening gap (the four items above), reproduced by running code
   except item 2's exact error text.
2. **Second revision** (the first version of this file). It tried to fix word-splitting by capturing
   `git diff -z` into a variable and then running `echo "$var" | xargs -0`. That is wrong: bash drops
   the NUL bytes, so with two or more staged files the paths merged into one nonexistent path, and
   every such commit was rejected with a misleading "not formatted" message (one staged file
   happened to pass). The file claimed the fixes were confirmed by live testing; that had been
   shown for the first draft's bugs, not for this fix, and the block was never run with several
   files before being written down. It was found by a later review here and independently by the PMB
   NS-58 session.
3. **This revision** pipes `git diff -z` straight into `xargs -0` and was run against the matrix
   above.
