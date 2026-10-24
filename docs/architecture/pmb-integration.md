# PMB Integration

Moved verbatim from `memory-bank/techContext.md` on 2026-10-23, to bring that file within its
README target and under the 300 lines PMB's warn-only size check flags; it keeps a pointer under
"Infrastructure". **Read this before running `mb upgrade`, editing a PMB-owned file (hook scripts,
`.claude/settings.json`, `.cursor/rules/`, `standards/`), changing what any ACR exit code means,
or changing the handoff threshold anywhere (including `memory-bank/README.md`).**

The text below was written inside `techContext.md`. "Here" mostly means this repository, but
"Moved here" means `techContext.md`, "editing this file" in the handoff paragraph means
`standards/MEMORY-BANK.md`, and a bare `README.md` means `memory-bank/README.md`. The upgrade
procedure assumes a PMB release tag; PMB has none past `v1.0.4`, and the current route is recorded
in `memory-bank/activeContext.md`.

### PMB-owned defects — none fixable here

`TEMPLATE_OWNED`, so `mb upgrade` overwrites any local fix. Sixteen reported across two briefs, all
one shape: **the check's _result_ is disconnected from whether it ran.** Two live examples, and it
takes two to establish a shape — `update-reviewed.*` reads a flat `.file_path` where the payload
nests under `tool_input`, so `last-reviewed` is never stamped and `mb doctor` reads a dead sensor;
`pre-push-check.*` calls `mb validate`, folded into `mb doctor`, and prints its "use mb doctor"
message as evidence of inconsistency on every push. Moved here from `activeContext.md` on
2026-08-31 — a standing fact about an upstream dependency, not session state.

**A third instance, drafted then deliberately not committed here (2026-09-26): `.githooks/pre-commit`
has no local check that staged files are formatted, so `calibration/*.json` (written directly by
`npm run calibrate`, never through an editor's format-on-save) repeatedly broke CI's Format check
after the fact.** A fix was drafted and put through this repo's full `/code-review`, then reported
upstream as **NS-58** rather than committed locally, since the hook is `TEMPLATE_OWNED` and a local
fix would not survive `mb upgrade` — the draft is parked in
`docs/superpowers/plans/2026-09-26-ns58-pre-commit-format-check-reference.md` so it isn't lost. This
also resolves an earlier, unexplained observation (an uncommitted `.githooks/pre-commit` edit that
appeared and vanished with no traceable origin): it was this same draft, in progress in a Claude
session sharing this working directory. `calibrate.ts` now formats its own oracle log (2026-10-23).

**Already fixed upstream, not delivered here (2026-10-23): ACR's `review-reminders.*` is
worktree-blind.** Its `1.1.1` copy (`.ps1:47`, `.sh:51`) runs a bare `git rev-parse --show-toplevel`
from the session's cwd, so a Claude commit/push from a git worktree is always denied; PR #93's
commits had to be made by the operator from their own terminal. PMB fixed it in `a0850a3`
(2026-09-15; repo taken from a leading quoted `cd "<path>" &&` or `git -C`), on PMB `main` but in no
release tag, so only an `mb upgrade` from a checkout containing it delivers it — blocked; see NS-14.

**Two PMB peer-session claims independently verified 2026-09-19–26, not just accepted:** NS-11
(NPM_TOKEN renewal) is genuinely obsolete — ACR uses OIDC/Trusted Publishing (`release.yml`), not a
stored token. NS-14 (PMB version drift, ACR pinned to 1.1.1 vs PMB's actual 1.2.1) is genuinely
real, confirmed by reading both version files directly — **no upgrade action taken**, deliberately
left to the user's own timing, especially since PMB itself hasn't tagged past `v1.0.4` despite being
at `VERSION` 1.2.1.

### PMB `/change-review` Job 7 — the exit-code contract

**PMB `/change-review` Job 7 shells out to ACR and branches on our exit codes — a consumer
contract.** Changing what a code means, or making a new condition emit an existing one, changes
their routing. **Read directly in their checkout on 2026-08-31**, at
`PMB:.claude/commands/change-review.md:166-205` and its `templates/claude-commands/` mirror, rather
than accepted on their report — the standing rule in `progress.md`, and this is why:

| their exit  | their stated meaning                           | their action                |
| ----------- | ---------------------------------------------- | --------------------------- |
| `0`         | **"Ran fully, nothing met the threshold"**     | genuine clean pass          |
| `1`         | ran fully and **found** something at threshold | **use the findings**        |
| `2`         | an agent failed internally (outranks `1`)      | not clean; fall through     |
| `3`         | diff truncated, coverage partial               | not clean; re-run `--chunk` |
| `4` †       | preflight failed (e.g. model missing)          | not clean; configuration    |
| any other † | (unenumerated)                                 | **treated as `2`**          |

- **Their invocation is `--profile security --chunk --diff <patch>`.** Verified: `fail-fast|failFast`
  occurs **0 times** in both their command file and the shipped template, and no
  `ai-review.config.json` exists anywhere in PMB. So `earlyExit` is latent for them, not live.
- **† Peer-reported 2026-09-01, NOT read in their checkout.** Rows `0`–`3` were read directly at
  the path above; the `4` and catch-all rows come from the peer's report only and are held at
  that lower confidence until verified the same way. If true they supersede the earlier note
  that their enumeration stopped at `3`, making exit 4 live on their side — which is what the
  `ping()` fix was waiting on. **Do not act on exit 4 routing without checking their file.**
- **Their `0` row says "Ran fully", which is exactly what a `--fail-fast` run does not do.** Their
  own note at `:205` warns a presence-only check cannot separate "ran and found nothing" from "every
  agent failed", calling it "a silently skipped security check reading as a pass" — the defect
  `earlyExit` reintroduces one level up, by returning `0` from a run that stopped early.
  **#83 makes that row wrong, and they know.** It is their fix, on their side, and they asked
  explicitly that #83 not be held for it. Do not block on it.
- **`--model` claims are peer-reported, not verified**: their file pins no model, so today's tagged
  `--model` runs were manual. Treat as their word.

**Peer-reported and NOT verifiable from this repo** — hedge accordingly, since both sides have
drifted before: their 8-case UTF-16/UTF-32 BOM byte matrix (their `tests/dangerous-commands.Tests.ps1`
exists, but the result was not reproduced here) and their account of their own commit history.

### `mb upgrade` — what it actually overwrites

Read in PMB's `scripts/mb.sh` on 2026-08-28, not inherited, and confirmed by the PMB session in
their own tree. **There are four delivery paths, not two**, and three of them do not deliver:

**Paths below are qualified `PMB:` or `ours:` deliberately** — the two repos have same-named files
with different contents, and an unqualified path is how a cross-repo citation goes wrong.

| Delivery path              | Examples                                                     | Does a fix reach us?                        |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `TEMPLATE_OWNED`           | `.cursor/rules/*.mdc`, `.claude/settings.json`, hook scripts | **Yes** — overwritten, local fixes erased   |
| `ADVISORY_CREATE`, present | all 15 `standards/*.md`, `docs/*-GUIDE.md`                   | **No**, but visible — prints a 20-line diff |
| `ADVISORY_CREATE`, absent  | `PMB:.github/workflows/memory-bank-size.yml`                 | Created — may **collide** with what we have |
| Neither array (init-only)  | `memory-bank/*`, including its `README.md`                   | **No, and silent** — no diff, no signal     |

PMB also identified a fifth case with no distribution path at all (`PMB:templates/AGENTS.md`,
reachable only via a standalone script the documented onboarding never invokes).

**The case that will actually fire for us is create-when-absent.**
`PMB:.github/workflows/memory-bank-size.yml` is `ADVISORY_CREATE` and we do **not** have it, so the
next upgrade creates a **second CI size gate** whose caps disagree with `ours:.github/workflows/ci.yml`:
projectbrief 120 vs our 150, techContext 300 vs 400, progress 600 vs 400, plus byte caps we have none
of, and remediation text pointing at `docs/archive/` where we use `memory-bank/archive/`. **The guard
that was supposed to prevent this is filename-based** — PMB's comment says a project with its own CI
"keeps it and just sees a diff notice", which holds only if that CI lives at the same path. Ours is
`ci.yml`, so to `mb upgrade` we simply do not have the file. Reconcile the two gates when it lands,
or the "enforced by CI" rule in `README.md` stops naming a single gate.

**And the never-copy case splits one decision across two files.** PMB's `2052c3c` changed both
`PMB:templates/cursor/rules/memory-bank.mdc` and `PMB:templates/standards/MEMORY-BANK.md`, which
carry the **same** decision — the Cursor handoff threshold 80% → 40% _and_ its reasoning. In our
tree today:

- `ours:.cursor/rules/memory-bank.mdc:51` says 80% — `TEMPLATE_OWNED`, so it **will be overwritten**.
- `ours:standards/MEMORY-BANK.md`, "Implications for Handoff Thresholds" and the Handoff Protocol
  trigger list, says Cursor 80% and justifies it with "rules re-inject on every response; 80% is
  safe" — `ADVISORY_CREATE` and present, so it **will not be touched**. (Cited by section, not line:
  editing this file shifts its own line numbers, which is how the citation here first went stale.)

So the number arrives without its justification, and the surviving justification is the one PMB has
retired ("do not re-derive a Cursor-specific number from rule-persistence behaviour"). **If you
reconcile only one file, reconcile `ours:standards/MEMORY-BANK.md`** — the reasoning lives there; the
`.mdc` only points at it. A third file, `ours:memory-bank/README.md`, also carries a stale 80% and is
in **neither** ownership array, so no upgrade will ever reach it.

**The procedure, when the tag exists.** Two repos, and the `cd` paths are load-bearing — giving a
cross-repo command without one sent the user to the wrong repository on 2026-08-28. Check PMB's tree
is clean **first**: `mb upgrade` copies from PMB's _working directory_, so uncommitted edits under
`templates/` ship as if they were the release, and PMB's tree was dirty in exactly that directory.

```powershell
cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git status --short
```

```powershell
cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git checkout v1.2.1
```

```powershell
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"; mb upgrade
```

That leaves PMB in detached HEAD — return it to its branch, or the next PMB session starts detached.
Afterwards verify `last-reviewed` actually starts stamping (the only proof the dead sensor is fixed),
and read the upgrade's output against the table above rather than assuming it synchronised anything.

**Do not copy PMB's replacement rationale verbatim.** Their own review flagged it (`[O2]`, open):
`PMB:standards/MEMORY-BANK.md` names absolute input length as the binding variable, then argues in
percentages of two context windows whose sizes neither repo establishes. PMB's own text avoids
naming the compaction constant; do not reintroduce it when paraphrasing. Their stated independent
basis is `PMB:memory-bank/systemPatterns.md`, which already said 40% with no IDE qualifier — **that
basis is in their repo, not ours**; `ours:memory-bank/systemPatterns.md` says nothing about handoff
thresholds at all.

**Fixed here 2026-08-28 — a constant that rotted because prose restated config.**
`standards/MEMORY-BANK.md` asserted `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` in three places while
`.claude/settings.json` reads 65. `ADVISORY_CREATE` meant no upgrade could ever correct it. The fix
**stops restating the value** rather than updating it to 65 — the file now points at `settings.json`,
because a second copy of a configured number is what drifted in the first place. Same fix the user's
global `CLAUDE.md` already made after the identical `=50` drift. Reported upstream to PMB; our copy
now diverges further from their template, so expect the advisory diff to keep printing.
