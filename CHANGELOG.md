# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **A partially-excluded agent no longer reports as a clean run.** `agentPolicy` excludes take
  effect two different ways and only one of them was ever rendered. The whole-agent skip fires only
  when EVERY changed file matches an exclude (`policyFilter.ts:47`, via `matchesAll`, which is
  `files.every(...)`). On a mixed diff the match is partial, so `policy.agentsSkipped` stays empty,
  the excluded sections are stripped from that agent's input, the stripping is recorded in
  `filteredFiles` — and no rendered surface printed it. Markdown, SARIF, github-annotations and MCP
  all reported a clean run.

  **Adding one non-excluded file SUPPRESSED the signal**, which is the opposite of what a reader
  would guess, and reaching it needs no flag at all — unlike the `earlyExit` case, which needs
  `--fail-fast`. Measured on `--profile security`, where `security` and `adversarial` both exclude
  `**/*.md`: a diff of six `.md` files plus one `.sh` left those two agents reviewing one file of
  seven, and every surface called it clean.

  All four formatters now name the affected agents and how many files were withheld. **`--format
json` was never affected** — `formatJson` is `JSON.stringify(result, null, 2)` and the runner
  already spread `filteredFiles` onto the envelope — so consumers reading the raw envelope always
  had the data and still do. SARIF now carries `filteredFiles` in run properties for that same
  reason: a consumer computing its own coverage needs the mapping, not a rendered sentence.

  **A partial exclusion renders at the policy-note tier and deliberately does not flip the
  INCOMPLETE headline.** The exclusion is configured and the agents did run; gating the headline on
  it would fire on nearly every mixed diff — in a documentation-heavy repo, most of them — and
  train the reader past the banner that matters.

  Scope is the four formatters. `review.yml` and `vscode-extension` are the fifth and sixth
  surfaces that render a verdict, and they follow separately once the shared incompleteness module
  they need has landed; duplicating it across two open branches would create the divergent-copy
  drift this change exists to remove.

- **Under `--chunk`, an agent narrowed in one chunk no longer reports as fully covered.**
  `chunkRunner`'s merge policy listed `filteredFiles` among "purely diagnostic metadata" and took
  whichever chunk ran last. That premise held only while nothing rendered the field. Now that four
  formatters raise a coverage warning from it, a narrowing in chunk 1 followed by a clean chunk 3
  silently reported full coverage — the same defect the warning exists to prevent, reappearing one
  layer up. `filteredFiles` is now merged per agent as a sorted union across chunks: the same
  promotion `toolAvailability` received once `partial` made it a claim about coverage rather than a
  diagnostic detail.

## [1.15.0] — 2026-08-27 (a timing number now says what it spans)

### Added

- **Per-pass timing is measured and kept**, on stderr as each pass completes and in the
  `ReviewResult` envelope as a new optional `timings` array — so the numbers survive into the
  `ai-review-findings` CI artifact rather than scrolling past in a terminal. Each row carries
  `diffLines`, the `effectiveTimeoutMs` that pass's agents were actually held to, the pass's
  `durationMs`, and every agent's `elapsedMs` paired with its `status`. Rendered in the markdown
  report, in SARIF `properties.timings`, and in the MCP output; deliberately not emitted as a
  GitHub annotation (see the comment above `formatGithubAnnotations` for why).

  **This exists because a timing number without its scope is unusable.** A figure long recorded
  here as evidence that the per-agent timeout ceiling was too low — "616 s against a 282,240 ms
  ceiling" — turned out to have no source, and was ambiguous besides: 616 s could have been one
  agent invocation or the sum across twenty-odd of them, and the two readings pointed at opposite
  conclusions. The timeout applies per `SwarmRunner.run()` call, so under `--chunk` that is per
  chunk. `timings` therefore keeps **one row per pass, concatenated and never summed**;
  `summary.durationMs` continues to report the aggregate for anyone who wants it. Per-invocation
  versus aggregate now falls out of the data instead of needing interpretation.

  Per-agent elapsed was already being measured and printed — `AgentProgressEvent.elapsedMs` — but
  the progress channel is a fire-and-forget callback, so nothing persisted it. The runner taps that
  channel rather than adding a second timer.

  **Each agent carries two durations, and conflating them was the first version's bug.**
  `elapsedMs` is wall time, spanning every retry attempt plus the backoff between them;
  `attemptMs` is the longest single attempt, and is the only one
  comparable to `effectiveTimeoutMs`, since the timeout is applied per attempt by `withTimeout`.
  Reporting wall time alone let a parse-error-then-success render as an agent that ran past its
  own ceiling and finished fine — measured at 1015 ms against a 300 ms ceiling with `status: 'ok'`
  — which is the same "the ceiling is too low" misreading the field exists to prevent. A retried
  agent is now named in the rendered line so the parts of the sentence reconcile.

## [1.14.0] — 2026-08-27 (findings admit when their line number is unreliable)

Continues the theme of 1.13.x: the report is not allowed to claim more than the run established.
This release turns one of the tool's oldest known weaknesses -- line numbers straight from the model
are unreliable, measured 7/5/7 across three trials on a single finding -- from a silent problem into
a stated one.

### Added

- **A finding whose quoted evidence is not at the line it cites is now flagged as such**, on every
  output surface: the markdown report appends `❓ Location unverified`, the GitHub annotation leads
  its message with the caveat, SARIF records `properties.locationCheck` and prefixes the result
  message, and the MCP heading is marked beside the `file:line`. `Finding` gains an optional
  `locationCheck` field (`'verified' | 'mismatch' | 'unknown'`); it is additive, so existing
  consumers are unaffected.

  Two independent real runs motivated this. A downstream consumer's review mis-cited **3 of 3**
  findings, one of them naming a different file than its evidence came from. This project's own
  release PR produced **6 findings that all cited wrong lines**, three of which quoted, as their
  evidence, the very value they claimed was empty -- at `basis=VERIFIED, confidence=90`.

  **It reports rather than corrects, deliberately.** Relocating the finding to where its evidence
  actually sits was implemented first and then withdrawn: the same evidence string frequently occurs
  more than once: in the 134-line diff that prompted this work, the string `"version": "1.13.1",`
  occurs three times across two files. Every ambiguous case would have to guess, and a
  confidently-wrong line is worse than a visibly wrong one, because the reader loses the signal that
  anything is off. Nor is the finding dropped -- a real finding carrying bad metadata is still real,
  and dropping is the false-negative direction.

  Post-image line numbers are derived from hunk headers, advancing on context and added lines and
  skipping removed ones. Counting offsets into the diff body instead looks correct on any hunk
  without deletions and drifts by one per removed line -- the same shape as the defect being caught.

  The check fails open to `'unknown'` when it cannot decide (file absent from the diff, empty
  evidence, unparseable diff, or a cited line the diff never displays), so a parsing failure cannot
  turn into a wall of false attribution warnings.

### Fixed

- **A GitHub annotation for an unlocatable finding keeps its line rather than dropping it.** An
  earlier attempt omitted `line=` on the assumption that GitHub would then attach the annotation to
  the file. It does not: every annotation property is optional, but `line` defaults to `1`, so
  omitting it silently repins the annotation to line 1 -- usually outside the diff, where GitHub does
  not render it inline at all. That reintroduced, by a different route, the "annotations silently
  land nowhere" failure that resolvable finding paths fixed in 1.13.0.

## [1.13.1] — 2026-08-26 (duplicate findings collapsed, truncated runs no longer read as clean)

Both fixes continue the theme of 1.13.0: the report is not allowed to claim more than the run
actually established. Neither changes what the agents look for.

### Fixed

- **A truncated run no longer renders as a clean one.** The CLI headline printed `✅` for a state
  the MCP formatter printed `⚠️` for, so the same truncated review looked passing in one surface
  and incomplete in the other. It now leads with `INCOMPLETE — reviewed N/M lines`. Qualifying
  text alone had already been tried against an earlier report of this same bug and was not
  sufficient: the glyph is the verdict for a reader who skims, and no amount of adjacent prose
  overrides it. The truncation advice in `formatter.ts` was also aligned with `runner.ts` — PR #33
  corrected the stderr copy to prefer `--chunk`, but the report copy was missed and still
  recommended raising `--max-lines`, which makes agent timeouts worse rather than better.
- **Same-agent findings that repeat one title are collapsed.** `deduplicate()` deliberately keeps
  same-agent findings at the same location, because one agent can legitimately report two
  different issues on one line — but the predicate could not tell that apart from one issue
  emitted several times. Measured against the real `findings.json` from PR #44's CI run:
  `adversarial` returned 5 findings at a single location that were really 2 concerns repeated;
  that run now reports 11 findings instead of 15, with both titles intact. Two details the
  obvious implementation gets wrong, and which the real artifact forced: the collapse keys on
  **title, never evidence** (all 5 findings carried byte-identical evidence while splitting across
  two legitimate titles, so an evidence-keyed merge would delete a finding class outright), and it
  **keeps the highest-severity member** (severity varied within a title group, so taking the first
  or last silently downgrades a `high` to a `medium` as a side effect of removing duplicates).

### Added

- `npm run test:docker` runs the suite in a container, for hosts where the native test runner
  cannot load its modules — Windows Smart App Control blocks them — and as a fallback when GitHub
  CI is unavailable.

## [1.13.0] — 2026-08-21 (honest reporting: partial scans, resolvable paths, pre-image findings)

Every fix in this release closes a case where the tool reported something more favourable than
what actually happened. None changed what the agents look for; they changed what the tool is
willing to claim.

### Fixed

- **A partial gitleaks scan no longer reports as a completed one.** gitleaks runs per file, and
  success on some files plus no output on others still claimed a finished scan. `ToolAvailability`
  gains a `'partial'` value, distinct from `'unavailable-llm-fallback'` — the latter asserts the
  tool never ran, which for a partial scan is false and points a reader at installing a tool they
  already have instead of asking why files were skipped. Surfaced in markdown and SARIF, and
  merged across `--chunk` runs so a partial first chunk is not masked by a clean second one.
- **A failed `npm audit` no longer reports a clean dependency scan.** Offline, `npm audit --json`
  writes a JSON error object to stdout and exits non-zero; `runTool` ignores exit codes by design,
  so the agent marked the tool `'used'` and the parser mapped the error shape to zero
  vulnerabilities. Offline is this tool's primary use case.
- **Finding file paths now resolve.** `filterNonexistentFiles` stripped the diff's echoed `a/`
  prefix only for its membership test and never corrected the stored value, so a surviving finding
  still carried a path that does not exist. Measured on a real CI run: 5 of 15 findings (33%)
  were affected. SARIF's `artifactLocation.uri` and the GitHub annotations take this field
  verbatim, so GitHub could not map those results to a file and the annotations silently landed
  nowhere. The strip is conditional — a repository with a genuine top-level `a/` or `b/` directory
  keeps its real paths.
- **MCP output now surfaces tool availability.** `formatMcpOutput` read only `agentStatus` and
  `truncation`, so a partial scan, a missing tool, and a fully clean run were indistinguishable to
  the calling LLM — the reader least able to notice, having no terminal output to fall back on.
  A degraded tool does not downgrade the headline to "incomplete": the agent ran in a documented
  degraded mode and returned a real result, unlike a failed agent or a truncated diff.
- **Findings that report deleted code are dropped.** Agents cited the removed side of a diff as a
  current defect — in one real case flagging a merge the diff removes and recommending, as the
  fix, the function the same diff adds. A finding whose evidence is provably quoted from deleted
  lines and absent from the resulting code is now filtered out. Fail-open by construction:
  paraphrased evidence matches nothing and the finding is kept.

### Changed

- `TOOL_LABELS` moved to `src/core/schema.ts` beside `ToolAvailabilityMetadata`, keyed off
  `keyof ToolAvailabilityMetadata`, so a new tool integration is a compile error until every
  renderer accounts for it rather than silently drifting.

### Internal

- Calibration assertions are falsifiable. `DependenciesAgent` previously had no case that could
  fail (both were `expectEmpty`, so an agent returning `[]` passed — proven by patching it to do
  exactly that). Added `dependencies-vulnerable` and `performance-postimage-clean`, plus a
  per-case `projectPathFixture` so tool-backed cases run against their own materialised project
  instead of this repository's incidental state. `CALIBRATION_CASE=name1,name2` targets a subset.
- `.claude/settings.json` denies commit-signing and hook bypass flags, and `gh pr merge`.
- 753 unit tests (from 717).

### Security

- `gitleaks-action` pinned from v2 to v3 (Node 20 → Node 24 runtime). The pinned v2 emitted a Node
  20 deprecation warning on every release run, and Node 20 leaves GitHub-hosted runners
  2026-09-16; the secret-scan step is not `continue-on-error`, so it would have hard-failed the
  release pipeline. The `# Pinned to v2 tag SHA` comment above the new SHA was corrected in the
  same round — in a supply-chain pin that comment is the only human-readable check that the opaque
  SHA is what it claims to be.

## [1.12.1] — 2026-08-19 (agent-count accuracy, truncation hint)

### Security

- `release.yml` publishes to npm via Trusted Publishing (OIDC) instead of a long-lived `NPM_TOKEN`
  secret — npm exchanges the workflow's existing `id-token: write` OIDC token for a short-lived
  publish credential scoped to this exact repo/workflow, verified against a Trusted Publisher
  relationship configured on npmjs.com. Requires npm CLI >= 11.5.1, so an explicit
  `npm install -g npm@latest` step was added rather than relying on whatever version `setup-node`
  bundles with Node 24. Removed the now-dead `NODE_AUTH_TOKEN` env var, the expiry-reminder step,
  and `scripts/setup-npm-token.ps1` (existed solely to bootstrap the token this replaces). No
  `NPM_TOKEN` GitHub secret is required going forward.
  <br>_(Entry relocated in 1.13.0: this shipped as part of 1.12.1 — the change is an ancestor of
  the `v1.12.1` tag and that release was itself published through it — but the note was left in
  `[Unreleased]` when the tag was cut.)_

### Fixed

- CLI announced the pre-policy agent count (`config.agents.length`) before `SwarmRunner.run`,
  but `evaluatePolicy` can skip agents inside that call — e.g. `--profile fast` on an all-markdown
  diff announced "3 agents" then printed `[1/2]`/`[2/2]`, because `security` defaults to exclude
  `**/*.md`. The count is now taken from the first progress event, which carries the real
  post-policy total. Added a fallback for the case that event can't cover: if policy skips every
  agent, nothing else would print, so it now says so explicitly and names the skipped agents.
- The truncation warning recommended raising `--max-lines` and never mentioned `--chunk`. On
  CPU-offloaded hardware that's the worse advice — it grows a single prompt, which is what pushes
  agents past `--timeout`. It now recommends `--chunk` first, states the pass count, and notes that
  raising `--max-lines` is slower per agent.

## [1.12.0] — 2026-08-19 (deterministic false-positive filters for fabricated findings)

### Security

- **All 14 known dependency vulnerabilities resolved — `npm audit` now reports 0.** Five were in
  production dependencies, reaching the published package transitively via
  `@modelcontextprotocol/sdk`: `ip-address` (high — SSRF/trust-boundary bypass from octal-vs-decimal
  octet decoding), `fast-uri` (high — host confusion via a literal backslash authority delimiter),
  `@hono/node-server` (path traversal in `serve-static` on Windows via encoded `%5C`), `hono`, and
  `body-parser`. These were pre-existing on `main`, not introduced by this release. The remaining
  dev-only advisories in the vitest/vite chain required a major upgrade to **vitest 4**, which
  changed how constructible mocks work: `vi.fn().mockImplementation(() => ({...}))` is no longer
  valid for a mock that gets `new`-ed. 34 mock factories across `cli.test.ts` and `mcp/tool.test.ts`
  were migrated to `function` form.

### Fixed

- `security`/`correctness`/`adversarial`/`error-handling` could hallucinate SQL-injection or
  swallowed-exception findings against declarative code containing neither dynamic query/command
  construction nor any exception-handling construct at all — reported against a real Postgres RLS
  function, `is_group_member(gid uuid)`, a parameterized `language sql` function whose own
  declared parameter was mistaken for unparameterized input. Two rounds of increasingly explicit
  prompt rules were applied and measured live against Ollama; the misfire rate didn't drop, it
  changed shape — once one rationalization ("gid isn't parameterized") was explicitly ruled out,
  the model invented another (claiming `auth.uid()` itself was attacker-controlled), leaving
  `security` at 5/8 and `error-handling` at 3/6 after both rounds. Fixed the same way
  `hasCredentialShapedValue` (`secrets.ts`) was: a deterministic post-filter
  (`filterUnsupportedClaims` in `orchestrator.ts`, patterns in the new `claimSupport.ts`) that
  drops an injection/swallowed-exception claim when the finding's own file section contains no
  syntax capable of producing that mechanism — checkable by the definition of the vulnerability
  class, not by model judgment. Scoped to the finding's own file, not the whole diff (a whole-diff
  check would almost never fire, since `${...}`/`await`/`||` are near-ubiquitous in real
  TypeScript diffs for unrelated reasons). Live-reverified after the fix: `security` and
  `error-handling` both went from 2/8 raw misfires to 0/8 surviving; a genuine-injection
  counter-test fixture (`sql-injection-vulnerable.diff`) confirms the filter does not
  over-suppress — across 3 trials each for security, correctness, error-handling and
  adversarial, all 11 injection findings those agents produced survived the filter (11/11). Live
  calibration also surfaced a third rationalization not covered by the literal "injection"/"sqli"
  wording — validation-language phrasing making the identical claim (e.g. "Potential Unsafe User
  Input Usage in SQL Function") — now matched too, narrowly, only when tied to an explicit
  sql/query/statement term nearby so an unrelated, legitimate "missing input validation" finding
  elsewhere is not misclassified. IDOR is deliberately out of scope for this filter (no syntax
  whose absence disproves an authorization gap) and remains covered by the prompt rules plus
  `--verify-evidence`.
- A third claim class in the same filter: `adversarial` fabricated claims that Postgres raises an
  exception on a NULL input to `is_group_member`, when a NULL comparison in a `WHERE` clause simply
  evaluates to no match. A prompt fix stating the correct semantics made it **worse (6/10 → 9/10)**
  — the model absorbed the fact and re-framed the complaint — so that was reverted and replaced
  with a deterministic check (`claimsNullRaisesError` + `sqlSectionCanRaise`), gated on the file
  being SQL because in an imperative language a null dereference genuinely does throw. Measured
  7/10 → 4/10 any-findings on the clean fixture. The residual is the vaguer "does not validate /
  unexpected behavior" phrasing, deliberately not matched — it asserts no checkable mechanism, and
  broadening to catch it was tested and would drop legitimate LEFT JOIN / missing-COALESCE
  findings.
- The injection filter above read a bare `||` as SQL string concatenation, but `||` is logical OR
  in shell, JS, and YAML. Static, fully hardcoded command lines (`script.sh || true`,
  `script.sh || FAIL=1`) therefore looked like dynamic construction, so fabricated
  "Command Injection via Script Parameters" findings against them survived the filter — reported
  from a live run against a real repo's hook and workflow files, 4/4 of that run's security
  findings. `||` now only counts as evidence when it abuts a string literal, which is what genuine
  SQL concatenation always does.
- **False negative on a real vulnerability class**, found while investigating the above: shell
  interpolation has no `${...}` braces, so `script.sh "$USER_INPUT"` matched none of the
  interpolation patterns and a genuine command-injection finding against it would have been
  silently dropped. Bare `$VAR`, `$(...)`, and backtick command substitution now all count as
  dynamic construction.
- `license` agent could assert a fabricated license for a package — measured 6/10 against a fixture
  adding lodash, claiming LGPL-3.0 with `basis=VERIFIED` for a famously MIT package, and in one
  trial naming MIT correctly while still filing a high-severity finding. Root cause was the prompt
  instructing the model to "look up its license from your training knowledge", i.e. to recall a
  fact rather than read one. Added `licenseFacts.ts`: a deterministic post-filter that resolves
  every dependency the diff adds against the reviewed project's own `package-lock.json` (or
  `node_modules`) and drops commercial-incompatibility findings the project's metadata contradicts.
  Contradiction-only and fails open on any unresolvable package, so the genuine LGPL detection in
  `license.diff` (`node-lame`, deliberately not a dependency here) still fires. Live-verified:
  6/10 → 0/8 on the clean fixture, 5/5 still detecting on the positive one.
- **Two false negatives in the injection filter's evidence patterns**, found by validating it
  against a cross-language corpus of real injections rather than the single
  counter-test fixture (the fixture proved the mechanism; it could not prove coverage). Both would
  have caused a genuine vulnerability finding to be silently dropped — the dangerous direction, as
  opposed to the merely-noisy false positives this filter exists to remove. (1) **C# interpolated
  strings** (`$"SELECT ... {id}"`): the `\$\w` alternative requires a word character after `$`,
  but C# puts a quote there. (2) **Rust `format!(...)`**: `format\s*\(` missed the `!`.
  The corpus run was 37 samples at the time, of which these two failed; the corpus committed as a
  regression test has since grown to **39 samples, all passing**. It lives in
  `tests/unit/claimSupport.test.ts`, covering Python, JS, TS, Java, PHP, Ruby, Go, C#, shell, Perl,
  C, plpgsql, T-SQL, Rust, Kotlin, Scala, and Groovy. The same run also characterized three
  fail-open inertness sources (`execute` matching Python/JS `.execute(`, and `\$\w`
  matching Postgres `$BODY$` dollar-quote tags and `$1` bind params) — all keep findings rather
  than dropping them, and are documented in `memory-bank/progress.md` rather than tightened
  without their own measurement.
- **Six further false negatives in the new filters**, found by a multi-agent `/code-review` pass and
  its opponent audit before release. Each would have silently dropped a real finding:
  - Injection classes with no string building — XSS via `dangerouslySetInnerHTML`, NoSQL via an
    object passed to a query API, CRLF/header injection — were dropped, because
    `hasDynamicConstruction` only knows query/command string assembly and cannot falsify them.
    They now fail open. The exclusion matches an injection **class** term, not a bare noun: an
    earlier attempt matched `html`/`dom`/`headers` anywhere in the text, which let fabricated SQL
    injection findings escape the filter simply by mentioning one.
  - `claimsNullRaisesError` treated `fail`/`fails`/`failure` as a raising verb. "A complete failure
    of tenant isolation" is ordinary security prose, so a real finding against a `using (true)`
    RLS policy — a world-readable table — was dropped outright. Removing that one alternative
    measured 5/12 wrong → 0/12; fabricated raise claims still match, since they always name an
    explicit verb (error/throw/raise/crash).
  - Shell and Rust error suppression (`2>/dev/null`, `|| true`, `let _ =`, `.ok()`) counted as
    "no error-handling construct", so legitimate swallowed-error findings in those languages were
    dropped. Those idioms now count as error handling.
  - `licenseFacts` threw a `TypeError` on npm's deprecated object-form `license`
    (`{"type":"MIT"}`), and the throw escaped the agent's `run()`, failing the whole agent rather
    than the one lookup.
  - `extractAddedDependencies` matched any `"key": "value"` manifest line, so a `"version"` bump
    alongside a real dependency made the license backstop fail open — meaning it fired almost never
    in practice, since version bumps accompany most dependency changes.
  - The report labelled every claim-support drop "referenced file(s) not present in the reviewed
    diff", which was false for all of them (those files ARE in the diff). Drops are now grouped by
    reason, which is what the `reason` field was added for.
- `license` agent's prompt had gained a list of concrete package names (`lodash`, `express`,
  `react`, `chalk`, `axios`) as examples of permissive packages. That re-introduced the exact
  hallucination-seed pattern removed in `a906515` (and in `9e0bc29` for `dependencies`), and
  `chalk` is the designated false-positive bait for this agent's own calibration case. Removed; the
  guidance is now stated without naming any package.
- Under `--chunk`, `hallucinationFilter` was merged last-chunk-wins, so drops recorded in earlier
  chunks vanished from the report. That was harmless when the only writer was
  `filterNonexistentFiles` (those findings referenced files outside the diff), but
  `filterUnsupportedClaims` can drop a real finding when a claim matcher misfires on genuine prose
  — measured twice during review — and this line is its only user-visible trace. Now merged across
  all chunks, like `agentStatus` and `evidenceCheckFilter`.
- `licenseFacts` resolved an array-shaped `license` field by joining with `OR`, so
  `["GPL-3.0","MIT"]` read as permissive and would drop a legitimate copyleft finding — the only
  false-negative path in that module. An array is not an npm-documented shape for `license`
  (the deprecated multi-license field was `licenses`), so it now joins with `AND`: permissive only
  if every entry is.
- `splitByFileBoundary` moved from `chunkRunner.ts` to a new dependency-free `diffSplit.ts`.
  `claimSupport` (a leaf) importing it from `chunkRunner` (an orchestration wrapper that references
  `SwarmRunner`) inverted the dependency direction; no runtime cycle existed only because that
  reference is `import type`, and nothing in CI guards against it becoming a value import.
- The `reason` → explanation mapping in `filterUnsupportedClaims` was a ternary chain parallel to
  the if/else chain that assigned `reason`, which TypeScript could not keep in sync — a fourth
  claim class would have printed another class's explanation. Both collapsed into one rule table.
- `licenseCompliance` parsed the project's lockfile before checking whether there were any findings
  to filter.
- `corroboratingAgents` was computed by the orchestrator's dedup step but never rendered anywhere,
  so a run whose progress lines read "security 4 findings, adversarial 1 finding" and then printed
  4 findings all labelled `Agent: security` looked like the adversarial finding had been silently
  lost. It had actually merged into a same-location security finding — and is why that one kept its
  severity while uncorroborated siblings were downgraded. Now shown as "Corroborated by:". Agent
  progress lines also now say "N raw findings" to make explicit that they are pre-synthesis counts,
  which legitimately differ from the final report's totals and severities.

## [1.11.0] — 2026-08-18 (review-reliability & evidence-verification fixes, 15-phase full-system audit remediation)

### Added

- `--verify-evidence-severity <level>` (`verifyEvidenceSeverity` config field, default `high`):
  minimum severity `--verify-evidence` checks. Investigated as the fix for a reported
  evidence-impact-mismatch finding ("Function 'lower' lacks input validation" against a bash
  script's `printf | tr` pipeline, which can't actually error on empty input) — `verifyEvidence`
  already catches this correctly when checked directly (confirmed live: `verified=false`, correct
  reasoning), but the finding is Medium severity, and `runEvidenceChecks` only ever checked
  Critical/High. Before lowering that default, checked severity counts across 9 real review runs
  from this session (`sqa-run1–7`, `cr-security1–3`): 26 Medium findings vs. 6 Critical/High
  combined. That sample is small and this-session-specific, not a claim about the project's
  history at large, but it was enough to show a blanket default change would multiply
  verifier-call latency well beyond a small proportional increase for every existing
  `--verify-evidence` user. So the threshold is configurable instead — default behavior is
  unchanged; a caller who wants Medium coverage opts in and accepts the added latency themselves.

### Fixed

- `formatMarkdown`'s "No issues found" line was unqualified even when the diff was truncated —
  a reported real-world case (12,599-line diff, `--max-lines` default of 2000) still printed a
  bare "✅ No issues found." at the end of the report, reading as a clean full pass when only
  ~16% of the diff was actually reviewed. The truncation warning is printed separately near the
  top of the report, but a reader skimming to the final verdict line — the way that line is
  designed to be read — can miss it entirely. Now reads "No issues found in the portion reviewed
  (X/Y lines — diff was truncated)" when `truncation.truncated` is true.
- CLI process could crash on exit on Windows with `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 76` after a review completed successfully and
  valid output had already been written — caused by `process.exit()` forcing immediate process
  termination while async handles (fetch/`AbortController` cleanup from `OllamaProvider`) were
  still settling. All 9 `process.exit()` call sites in `src/cli/index.ts`'s action handler now
  set `process.exitCode` and return instead, letting the event loop drain naturally before Node
  exits on its own; the one call site in the synchronous `getDiff()` helper now throws instead,
  routed through the existing catch block.
- `--verify-evidence-severity`'s invalid-value CLI validation used `process.exit(1)` instead of
  the `process.exitCode = 1; return` pattern the rest of this action handler already uses (same
  fix as above) — caught during a follow-up review after the fact, not part of the original
  crash's own reproduction.
- `secrets` agent's LLM fallback path (used when `gitleaks` is unavailable) could flag a
  `password`/`secret`/`token`/`key`-named identifier as a hardcoded credential purely from its
  name, even when the assigned value was a boolean, a bare variable reference, or a constructor
  call — reported against a real Flutter/Dart password-visibility-toggle diff
  (`bool _obscurePassword = true;`). Adding an equivalent instruction to the system prompt alone
  measured no effect on the hallucination rate (5/10 before, 5/10 after, live-tested against real
  Ollama). Fixed with a deterministic post-filter (`hasCredentialShapedValue`): a finding is
  dropped unless its evidence contains a quoted string literal (matching quote delimiters, so two
  short unrelated quoted tokens on the same line can't cross-match into one false "literal"), with
  an exemption for PEM/certificate blocks, URI-embedded credentials, and config-file formats
  (YAML/`.env`/etc., which commonly carry legitimately unquoted secrets) — all three would
  otherwise be silently dropped by a naive "must be quoted" rule. Dropped findings are logged.
- `--chunk` split an oversized diff on raw line count, so a single file's diff section could
  itself be split across two chunks — each chunk's own `OrchestratorAgent.synthesize()` call
  computes `changedFiles` from only that chunk's content, so a file whose header landed in one
  chunk but whose hunk body continued into the next would have any genuine finding on it dropped
  as "likely hallucinated." `chunkRunner.ts` now splits on `diff --git` file boundaries instead
  (`splitByFileBoundary`), so a file's diff section is never split across chunks. A single file's
  section larger than the chunk size still becomes its own oversized chunk (existing internal
  truncation still applies within it, same as any over-max-lines diff).
- `--chunk` merged `evidenceCheckFilter` (from `--verify-evidence`) last-chunk-wins — a
  possibly-unsupported finding flagged in an earlier chunk would silently disappear from the
  merged report if the last chunk had nothing to flag. Now merged (`checkedCount`/
  `unavailableCount` summed, `unavailableReasons`/`flagged` concatenated) across all chunks, like
  `agentStatus` already was.
- `Finding.severity`/`.basis` were never validated against their real enum values anywhere in the
  parse pipeline — an off-spec value from the LLM (or a malformed provider response) would silently
  corrupt `SEVERITY_RANK`/`basisOrder` lookups across `orchestrator.ts`, `chunkRunner.ts`,
  `cli/exitCode.ts`, and `evidenceVerifier.ts` instead of failing loudly. `validateAndNormalizeFindings`
  now enum-validates both fields, defaults `basis` to `'INFERRED'` when absent, and fixes a
  `blocking` default that didn't match its own documented rule
  (`blocking: severity === 'critical' || 'high'`).
- `--agents`/`--fail-on` accepted any string and failed silently downstream instead of erroring —
  both are now validated against their real enum values at CLI startup (exit 1 with a clear
  message). The CLI's catch-all error handler used the same exit code (1) for "tool couldn't run
  at all" as for "review found a blocking finding," making the two failure modes indistinguishable
  to CI. Added `STARTUP_FAILURE_EXIT_CODE = 4` and routed the catch-all handler through it.
- MCP output (`formatMcpOutput`) and SARIF output never surfaced `agentStatus`/`truncation` —
  a run where every agent crashed was formatted identically to a clean pass for any MCP client or
  SARIF consumer (GitHub code scanning, etc.). MCP output now includes an explicit failure/
  truncation warning; SARIF output now sets the standard `invocations[].executionSuccessful` /
  `toolExecutionNotifications` fields via a new `buildInvocation()` helper.
- `hallucinationCrossCheck`'s `DETERMINISTIC_SOURCES` corroboration-bypass list trusted
  LLM-self-reported `source` strings (`'git'`, `'policy'`, `'lizard'`) that were never actually
  backed by a real tool — only `gitleaks` and `npm-audit` are genuinely code-set, so an LLM could
  self-tag a fabricated finding with one of the other values and skip corroboration entirely.
  Narrowed to `['gitleaks', 'npm-audit']`; removed the now-dead prompt instructions in
  `breakingChange.ts`, `licenseCompliance.ts`, `migrationSafety.ts`, `secrets.ts`, and
  `dependencies.ts` that told agents to self-tag those source values. Also fixed a dead-branch bug
  in `licenseCompliance.ts`/`breakingChange.ts` where severity and basis were coupled such that a
  `SPECULATIVE`-basis finding was always dropped regardless of its actual severity.
- `DependenciesAgent`/`LicenseComplianceAgent` skipped their LLM call inconsistently when a diff
  didn't touch a manifest file (`package.json`/`package-lock.json`) — the skip logic didn't
  account for every code path that could reach `run()`. Both agents now use the same
  `touchesManifest` check (via `extractChangedFiles`) consistently, avoiding wasted LLM calls
  regardless of entry point.
- The `PowerShell` tool wasn't wired into `.claude/settings.json`'s PreToolUse hook matcher for
  `review-reminders.ps1`, so commit/push review-gate reminders only fired for the `Bash` tool —
  a real bypass for any session using the PowerShell tool exclusively. Added `TRUNCATE TABLE` and
  a WHERE-aware `DELETE FROM` pattern to `dangerous-commands.ps1`/`.sh`'s CONFIRM tier (previously
  undetected). `.github/workflows/review.yml` replaced `|| true` with `continue-on-error: true`
  and now explicitly reports failure instead of silently no-op'ing on "Post PR Comment"/"Write Step
  Summary"; `.github/workflows/calibrate.yml` no longer sets job-level `continue-on-error: true`.
- `pre-push-check.ps1`/`.sh`'s secret-scan patterns were missing PEM blocks, `Authorization:
Bearer` headers, JSON/YAML-style secret assignments, AWS secret access keys, and newer
  fine-grained GitHub PAT formats; the exclusion for scan noise was `fixtures/`+`docs/` by prefix,
  which suppressed scanning of every real path under both trees, not just the security-fixture
  directory it was meant for — narrowed to `fixtures/security/` only. The `.sh` version's
  `check_secret()` was case-sensitive where the `.ps1` version's `-match` is case-insensitive by
  default, a platform-dependent false negative — now uses `grep -iE`. While testing the new
  patterns, found and fixed a genuine pre-existing bug: `git log --not --remotes` (no explicit
  positive starting ref) silently returns empty output in a repo with zero remotes configured,
  meaning first-push secret scanning could no-op entirely for a brand-new repo — fixed by using
  `git log HEAD --not --remotes` in both the diff-scan and large-file-list commands, in both
  script variants.

### Testing

- Strengthened the CLI's verifier-model wiring test: previously only asserted a verifier provider
  was constructed (`toBeDefined()`), which can't distinguish a correctly-wired verifier from one
  accidentally sharing the main review's model, since the mocked `OllamaProvider` returns `{}`
  either way. Now asserts the verifier provider's model argument specifically, including the
  empty-string-config fallback to `qwen3:latest`.
- Added test coverage for `TestGenAgent`'s pytest branch (`def test_` detection) — every existing
  test used a fake `projectPath` that always fell through to the `vitest` branch, so the
  pytest-specific regex had zero coverage.
- Deleted `tests/unit/orchestratorAgent.test.ts`, confirmed fully redundant against
  `tests/unit/orchestrator.test.ts` during the 15-phase system-integrity audit's test-suite
  integrity phase. Added regression tests across `baseAgent.test.ts` (enum validation),
  `cli.test.ts` (flag validation, exit codes), `mcp/formatter.test.ts`, `formatters/sarif.test.ts`,
  `orchestrator.test.ts` (`DETERMINISTIC_SOURCES` narrowing), `dependenciesAgent.test.ts`,
  `licenseComplianceAgent.test.ts`, and `runner.test.ts` covering every fix above.
- Extended `tests/review-reminders.Tests.ps1` with Pester coverage for the new TRUNCATE/DELETE FROM
  guardrail patterns, the PowerShell-matcher hook wiring, and `pre-push-check.ps1`'s secret
  scanning (verified live, not just read).

### Documentation

- Added a "Known Limitations" section to README.md documenting absence-claim false positives
  (findings like "no validation exists" that are wrong because the actual check exists elsewhere
  in the file, outside the diff hunk shown). Three mitigations were designed and empirically
  tested against a real reported case — post-hoc full-file re-verification (unreliable, 2/5, and
  slow), full-file context at generation time (made the false-claim rate _worse_, 3/3 vs. a 1/3
  baseline, even with an explicit instruction to cross-check), and deterministic
  confidence-capping (fired on the majority of unrelated, well-grounded findings in this
  project's own recent review history, including a Critical command-injection finding) — all
  rejected before shipping. See
  `docs/superpowers/specs/2026-08-17-absence-claim-investigation.md` for the full investigation
  and validation data.
- Ran a 15-phase ACR Full-System Integrity & Hardening Review (system map, capability tracing,
  contract/data-flow audit, agent/reviewer integrity, orchestration, failure modes, test-suite
  integrity, CLI/hook/CI integrity, security/boundary review, efficiency, dead code, docs-vs-reality,
  end-to-end proof) — see
  `docs/superpowers/specs/2026-08-17-full-system-integrity-hardening-audit.md` for the full report.
  All Tier 1/2 findings were verified against current source before being fixed (entries above);
  Tier 3 items (sanitizer overhaul, chunking redesign, vscode-extension catch-up, Ollama
  concurrency handling) were deferred as large, speculative redesigns per this project's
  simplicity-first principle.
- Fixed stale documentation surfaced by the audit's docs-vs-reality phase: README.md's
  `--timeout` default in the Guardrails table contradicted the actual 180s default (was 60s);
  stale `toolVersion`/`agentTimeoutMs` config examples; stale `npm run check`/`npm test`/
  `npm run test:extension`/`npm run calibrate` descriptions and counts. `docs/HOOKS-GUIDE.md`'s
  BLOCK pattern count (19 → 16) and a broken cross-reference to a non-existent env-block example
  in `standards/SECURITY-GUARDRAILS.md` (replaced with an inline example in HOOKS-GUIDE.md itself).
  `standards/SECURITY-GUARDRAILS.md` documented `DROP TABLE`/`DROP DATABASE` as Tier 2 CONFIRM,
  but `dangerous-commands.ps1`/`.sh` actually implement them as Tier 1 BLOCK (no override) —
  the doc now matches the implementation.

## [1.10.0] — 2026-08-17 (full-codebase audit fixes, evidence-grounding verification, review reliability)

### Added

- `AI_REVIEW_ALLOWED_ROOTS`: opt-in, comma-separated allowlist of absolute paths the MCP server's
  `repo_path` may point at (unset — the default — keeps prior unrestricted behavior).
- `complexityThreshold` config field is now wired up for real — passed to `lizard` as its native
  `-C` threshold flag when `lizard` is installed. Previously documented as shipped but silently a
  no-op.
- `--verify-evidence` runs Critical/High findings through a separate model (`qwen3:latest` by
  default) that checks whether each finding's own cited evidence actually supports its claim —
  catches a hallucination class none of the existing defenses caught (a finding citing a real
  line, in a real changed file, that says the opposite of what the line does). **Report-only in
  this release**: flagged findings are surfaced in `ReviewResult.evidenceCheckFilter` (and in the
  markdown/SARIF reports) but nothing is dropped from `findings` yet. Opt-in (`verifyEvidence`
  config field, default `false`); forced off for MCP callers regardless of project config. See
  `docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md` for the full
  design and validation data.
- `--allow-truncation`: opt out of the new truncated-but-clean exit code (below) for workflows
  that have deliberately accepted partial diff coverage.
- `--chunk`: instead of silently truncating an oversized diff to `--max-lines`, split it into
  multiple full-coverage passes and merge the results — full diff coverage at the cost of
  multiplying LLM calls by chunk count. Opt-in, off by default. Implemented as a wrapper
  (`chunkRunner.ts`) outside `SwarmRunner` — calls the existing `run()` once per chunk unchanged;
  the merged report is re-capped and re-sorted globally by severity (`maxFindings`), not just
  concatenated. CLI-only — not exposed via MCP (its per-chunk latency cost isn't a good fit for an
  interactive caller). Known caveat: chunks split on line count, not file boundaries, so a finding
  on a file whose diff section straddles a chunk boundary can be dropped as if it were a
  hallucination rather than reported — see `chunkRunner.ts`'s own comment for detail; a real gap
  worth understanding before relying on `--chunk` for a very large diff, not yet fixed.
- `security`/`adversarial` now exclude `**/*.md` by default via `agentPolicy` — these two agents'
  prompts have no file-type awareness and were misreading documentation prose (e.g. a vulnerable
  code example inside a security writeup) as real, executable vulnerable code. Deterministic, not
  a prompt instruction, since prompt-tightening alone has previously underperformed for this class
  of problem. `ReviewResult.filteredFiles` reports which files were stripped from an agent's own
  view (new — sibling of `PolicyResult`, not nested in it, since this covers an agent that still
  ran, just with reduced input).
- `ToolAvailability` gains a `'not-applicable'` value, for when a tool-integrated agent's LLM
  fallback should be skipped entirely rather than run (see `dependencies` fix below).

### Fixed

- **Silent diff truncation had no exit-code signal.** A diff truncated to `--max-lines` produced
  the same exit code as a genuinely complete review — CI could pass on a review that never saw
  most of the diff. New exit code 3 (truncated-but-otherwise-clean); takes priority over
  `--fail-on` but below the existing agent-failure (2) and real-finding (1) exit codes, so a
  genuine blocker or agent failure is never masked by a lower-priority truncation code. Opt out
  with `--allow-truncation`, or use the new `--chunk` (above) for full coverage instead.
- **Every agent's structured JSON output needed truncation-recovery to parse.** Root-caused via a
  live diagnostic script (`calibration/responseTruncationDiagnostic.ts`, new — permanent, run with
  `npm run calibrate:truncation`): `format: 'json'` (the bare string Ollama's structured-output
  mode accepted) only constrains "valid JSON," not the required top-level shape, so the model
  reliably emitted a single bare object instead of an array. Not, as originally hypothesized, a
  missing token cap — `done_reason` was `stop`, never `length`, at every diff size tested. Fixed by
  sending an explicit JSON Schema (`format: { type: 'array' | 'object', ... }`) instead, which
  empirically forces the correct shape. A separate, distinct problem surfaced during the same
  investigation — the model under-reporting multiple real findings in one diff, even with the
  shape fixed — is **not** fixed by this change; it's a model-capability limitation, not a format
  issue, and is documented as an accepted, deliberately out-of-scope limitation rather than guessed
  at with an unverified fix.
- **`dependencies` assumed every project uses npm/Node.js.** On a project with no `package.json`
  and a diff that never touches one (e.g. a Flutter/Dart project), the agent still ran its LLM
  fallback and could fabricate a "missing manifest" style finding. Now skips the LLM entirely and
  reports `toolAvailability.npmAudit: 'not-applicable'` in that case. A diff that DOES touch
  `package.json`/`package-lock.json` (even one not yet on disk — e.g. reviewing an unapplied patch
  that adds a manifest for the first time) is unaffected, reaching the existing
  npm-audit-then-LLM-fallback logic exactly as before.
- `shell.ts` now logs stderr when a tool exits nonzero with empty stdout — previously
  indistinguishable from "tool not installed," both silently resolved to `null`.
- `config.ts` logs before falling back to defaults on a malformed `ai-review.config.json`, instead
  of silently ignoring it.
- `gitleaksParser.ts`/`npmAuditParser.ts` log on malformed tool JSON instead of silently reporting
  "0 findings, tool used" — previously a false sense of security, specifically dangerous for the
  secrets scanner.
- `TestGenAgent` now checks generated content for actual test-framework structure (a quoted-title
  `describe(`/`it(`/`test(`, or `def test_` for pytest) instead of just a length threshold — a
  model refusal/explanation long enough to pass the old check would previously get written to disk
  as if it were real tests.
- Coverage-gap and other cross-agent finding matching used to compare raw, unnormalized `file`
  strings — a model echoing the diff's own `a/`/`b/` header prefix into a finding's `file` field
  could defeat deduplication, corroboration, and escalation checks. All comparisons now use
  canonicalized paths.
- `--context-mode semantic` recomputed the same diff/memory-bank embeddings from scratch once per
  agent (up to ~14 redundant Ollama calls per run for an identical result) — now computed once per
  run and reused.

### Security

- `--write-tests` and the MCP server's coverage-gap-derived test paths are now defended against
  path traversal (`resolveWriteTestPath` containment check, plus a coverage-gap filter mirroring
  the existing changed-file-membership defense already applied to regular findings).
- The MCP server's `repo_path` accepted any filesystem path with no scoping — see
  `AI_REVIEW_ALLOWED_ROOTS` above.

### Removed

- `preferredSecretsScanner` config field — documented as shipped but functionally always a no-op
  (every code path fell back to the same default regardless of its value).
- The unused GitHub PR-comment adapter (`src/adapters/github.ts`) — confirmed via git history
  never wired into `review.yml`, which used an inline `actions/github-script` step from its first
  commit. Not a public API — no consumer-facing effect.

## [1.9.0] — 2026-08-09 (deterministic-tool integration, hallucination fixes, CI hardening)

### Added

- `SecretsAgent`/`DependenciesAgent` now call gitleaks/`npm audit --json` directly and skip the
  LLM entirely when the tool is available, instead of augmenting an LLM call with tool output —
  the actual problem this fixes is untrustworthy LLM judgment on secrets/dependency findings, not
  missing signal.
- `ReviewResult.toolAvailability` surfaces degraded-mode (an integrated tool — gitleaks, npm
  audit, or lizard — wasn't installed, so the agent ran without it) in the markdown report and
  SARIF output. Previously invisible outside a console.error line.

### Fixed

- `dependencies.ts`'s and `license.ts`'s prompt templates carried concrete, real-looking example
  values in their REQUIRED OUTPUT FORMAT examples instead of generic placeholders, which the
  model would echo back as fabricated findings on diffs with nothing real to report. Both fixed
  to match the placeholder convention every other agent already uses.
- `OrchestratorAgent` compared raw, unnormalized `Finding.file` strings in four places
  (`deduplicate`, `hallucinationCrossCheck`, and three branches of `crossReference`) — a model
  sometimes echoes the diff's own `a/`/`b/` git-header prefix into a finding's `file` field, which
  caused genuinely duplicate/corroborating findings to be treated as unrelated: missed dedup
  merges, wrongly downgraded severities, and silently-skipped escalations. All four now compare
  canonicalized paths.
- Windows-only `npm` spawn failure (`ENOENT`) in `runTool` — Node refuses to spawn `.cmd`/`.bat`
  files without `shell: true`, which silently broke the npm-audit integration on Windows until
  live calibration surfaced it.
- `runTool` never passed a `cwd`, so gitleaks/npm-audit/lizard always ran relative to this
  process's own working directory instead of the reviewed project (routinely different under CLI
  `--dir` or MCP `repo_path`).
- A `BaseAgent.parseFindings` Stage 4 bug mislabeled a complete bare-object response as
  "truncated" even though nothing was truncated.

### Security

- `.github/workflows/review.yml`'s self-hosted job (required for local Ollama access) triggered
  on every `pull_request` with no restriction on origin — since this repo is public with forking
  enabled, a fork's PR would run `npm ci` (and any install/postinstall script it pulls in) on the
  physical self-hosted runner before the workflow's own logic ever executed. Added a job-level
  guard restricting execution to PRs whose head repo is this repo; same-repo branches (including
  Dependabot's) are unaffected.

## [1.8.0] — 2026-07-25 (structured JSON output, truncation recovery, memory-bank context sanitization)

### Fixed (2026-07-26 follow-up — remaining /code-review findings)

- Sanitizer's "act as a/an ..." pattern required an AI/assistant/bot/model word directly, which
  correctly stopped an earlier false positive but was found (by the same review) to also miss
  real jailbreak framings that don't use one, like "act as a Linux terminal" and "act as DAN".
  Broadened to also match those and similar framings (`terminal`, `hacker`, `unrestricted`,
  `unfiltered`, `jailbroken`) without reopening the original false positive.
- Fixed the SRI-hash base64 false positive properly (a prior attempt using a negative lookbehind
  was deferred after empirical testing showed the regex engine could find an alternate
  match-start position that bypassed it). The sanitizer now supports a per-pattern
  `isFalsePositive` context check applied after a match is found, which a lookbehind can't be
  bypassed around. An SRI hash (`integrity="sha256-..."`) is no longer redacted; a genuine 80+
  char base64 blob elsewhere still is.
- Memory-bank context sanitization (added in this release) logged redactions via `console.warn`
  only — invisible to any consumer of the structured JSON/markdown report even though a real
  redaction had happened. Now merged into the same `sanitizer` field the diff's own sanitization
  populates.
- `--no-sanitize`'s CLI help text, README, and runtime warning only mentioned disabling diff
  sanitization, not that it also disables memory-bank context sanitization (added in this
  release) when `--context memory-bank` is set.
- `OllamaProvider.stripThinkTags` only removed a `<think>` block that actually closed; a response
  truncated mid-reasoning left the unstripped `<think>` prefix in place, where `BaseAgent`'s
  truncation-recovery pass could theoretically mistake a coincidentally schema-shaped object
  inside the model's raw chain-of-thought for a real finding it never asserted as output. Now
  drops an unclosed `<think>` block and everything after it. (Speculative risk, inert under the
  current `devstral` default since `supportsThinking()` only applies to qwen/deepseek-r1 models —
  hardened anyway since the fix was cheap and the risk applies to any future model switch.)

### Added

- Every standard agent and the coverage agent now request Ollama's `format: "json"` structured
  output mode (grammar-constrained JSON decoding), instead of relying purely on prompt
  instructions to produce parseable output. `ChatOptions.format` already existed end-to-end but
  was never actually passed anywhere. Empirically confirmed against `devstral:latest`: makes
  responses reliably syntactically valid JSON. Doesn't fix every parse failure (the model can
  still pick different field names than the schema expects, and grammar-constrained decoding
  doesn't extend the model's generation budget), but directly targets the class of bug this
  project has repeatedly fought (prose instead of JSON, truncated mid-generation). Not applied to
  `TestGenAgent`, which intentionally outputs raw test code, not JSON.
- `BaseAgent.parseFindings` gained a new recovery stage: when a response is cut off
  mid-generation before its JSON array closes, it now recovers whichever findings did complete
  instead of discarding all of them. Recovered objects still go through the same schema
  validation as every other parse stage, so a response that's just trivially-parseable garbage
  (e.g. `"{}"`) still correctly throws `ParseFailureError` rather than silently resolving to
  "0 findings, clean run."
- Memory-bank context (`--context memory-bank`) is now sanitized for prompt-injection patterns
  before being prepended to any agent's prompt, the same protection the diff itself already had.
  `contextLoader.ts`'s own comment claimed this was already happening ("sanitizer applies
  separately") — it wasn't; `sanitizeDiff()` was only ever called on the diff. Added
  `sanitizeText()` (`sanitizer.ts`) for scanning arbitrary non-diff text, since `sanitizeDiff`'s
  `+`-prefix convention doesn't apply to plain markdown. Respects `--no-sanitize` like the diff
  does.
- `calibration/calibrate.ts`: added a `CALIBRATION_MODEL` env var to bake off a candidate model's
  finding quality without editing `config.ts`, and wrapped each case (including the testgen
  check) in try/catch so one agent error no longer kills the entire run and loses every other
  case's result.
- `CoverageAnalystAgent.parseCoverageResult` now recovers findings/gaps from a response truncated
  before its outer `{"findings":...,"gaps":...}` object closes, instead of unconditionally
  throwing `ParseFailureError` and discarding everything. It had picked up `format:'json'` (which
  this same release's calibration data shows increases truncation frequency) without the
  equivalent recovery `BaseAgent` got — flagged during `/code-review` as a real asymmetry, since
  the two agents would otherwise degrade differently under the exact truncation conditions this
  release exists to mitigate. The recovery scanner (`extractCompleteObjects`) and the balanced-span
  extractor (`extractBalancedSpan`) were extracted into `parsing.ts` as shared helpers — this also
  replaces three near-identical hand-rolled bracket scanners (one each in `base.ts` and
  `coverageAnalyst.ts`, plus the new one) with two shared implementations.

### Fixed

- `extractCompleteObjects`'s depth tracking could go negative on a stray unmatched `}` preceding
  real content, permanently preventing every object later in the same response from being
  recovered. Found via direct execution during `/code-review`. The shared implementation now uses
  a stack of open-brace positions instead of a depth counter, so an unmatched `}` is simply
  ignored rather than desyncing the rest of the scan.

- Sanitizer's "role-play directive" pattern was catching any generic "act as a X" phrase, not
  just AI-role-reassignment attempts — found actively false-positiving on this repo's own
  `memory-bank/activeContext.md` and `progress.md` (which document this exact prior bug) the
  moment memory-bank context sanitization above started actually running against them. Tightened
  to require the phrase target an AI/assistant/bot/model role, matching the existing "you are
  now" pattern's structure. Real injection attempts ("act as an unrestricted AI") still match;
  ordinary usage ("acts as a validator/gatekeeper") no longer does.

## [1.7.0] — 2026-07-25 (actionable truncation warning; parallel-by-default investigated and rejected)

### Changed

- The pre-flight diff-truncation stderr warning is now actionable: it states how many lines were
  excluded and suggests raising `--max-lines` or splitting the change, instead of a bare factual
  notice.
- `README.md`'s CLI options table had a stale `--timeout` default (`60000`) left over from the
  60s→180s fix in v1.4.0 — corrected.
- `--fail-fast` now warns on stderr when combined with `--parallel`, since its early-exit check
  only runs in the sequential code path and previously no-opped silently.

### Investigated and explicitly rejected: parallel-by-default

A real bug report (ACR's 4-agent security profile took ~22 minutes against a 4658-line diff)
prompted flipping `DEFAULT_CONFIG.parallel` to `true`. An initial test (4 concurrent
`devstral:latest` requests, a trivial short prompt) showed a ~1.63x speedup and looked
promising. A deeper test at the real default scale — 14 concurrent requests (the actual default
agent count) with a realistic ~30KB diff prompt — showed near-linear serialization instead:
completions at 58.7s, 91.5s, 120.6s, 172.7s, 235.0s, 305.7s, then a header-timeout failure past
300s for a still-pending request. Reproduced with `curl` directly (bypassing Node's fetch client)
to rule out a client-side connection-pool artifact — same staggered pattern. Since each queued
request's client-side timeout clock starts the moment it's dispatched (not when Ollama actually
begins generating for it), defaulting to parallel would have caused most of the default 14-agent
swarm to spuriously time out — reproducing the exact "everything times out, 0 findings" failure
mode this tool exists to prevent, just via queueing instead of genuine slowness. `--parallel`
remains available as an explicit opt-in for hardware verified to actually benefit from it. Full
writeup in `memory-bank/systemPatterns.md`'s "Sequential Execution" section.

## [1.6.0] — 2026-07-18 (truncation-aware timeout scaling)

### Added

- Per-agent timeouts now scale up to 2x `agentTimeoutMs` as the (post-truncation) diff
  approaches `--max-lines`, on by default. A diff at the truncation point previously got the
  same flat timeout budget as a tiny one — the same real bug report that motivated
  `ReviewResult.truncation` (v1.5.0) also hit this: 4 agents each burned a full timeout+retry
  cycle failing against a diff truncated to 2000 lines. Passing `--timeout` explicitly disables
  scaling and uses exactly that value, matching prior behavior.
- `--timeout`'s help text corrected: it was still documenting the old 60000ms default from
  before the earlier 60s→180s fix.

## [1.5.0] — 2026-07-18 (diff-truncation visibility)

### Added

- `ReviewResult.truncation`: records `{ truncated, originalLines, keptLines }` when a diff
  exceeds `--max-lines` and gets truncated before any agent runs. Previously this only logged
  to stderr (`console.warn`) — a caller reading just the report had no way to know a large
  chunk of the diff was silently excluded from analysis. Now surfaced prominently near the top
  of the markdown report, in SARIF run-level properties, and as a `::warning::` github-annotation
  (even with zero findings). JSON gets it for free. Follow-up to v1.4.0's `agentStatus` work —
  reported via a real bug hit running `/change-review` against a 4188-line diff.

## [1.4.0] — 2026-07-17 (silent agent failure reporting)

### Added

- `ReviewResult.agentStatus`: records `'ok' | 'timeout' | 'parse-error' | 'error'` per agent
  (15 specialists + coverage + testgen). Previously a run where every agent timed out or
  returned unparseable output rendered identically to a genuinely clean review
  (`0 findings | ✅ No issues found`) — both silent-failure sites (`parseFindings`'s final
  fallback, and `runner.ts`'s 4 catch blocks) now surface the distinction.
- Markdown, SARIF, and github-annotations formatters show a clear `⚠️ N/M agents failed` warning
  (with per-agent, per-failure-type remediation advice) instead of a clean checkmark when any
  agent didn't succeed. JSON gets `agentStatus` for free (whole-object serialization).
- New exit code `2`: a run with any agent failure exits 2, independent of and taking priority
  over the existing `--fail-on` severity gate (exit 1) — CI can no longer silently treat a
  broken run as a passing one.

### Fixed

- `parseFindings` (`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw
  `ParseFailureError` on total parse failure instead of silently returning `[]` — the same
  value a genuinely clean review produces.

## [1.3.0] — 2026-07-14 (ai-review distribution)

### Added

- `scripts/postinstall.mjs`: `postinstall` lifecycle script that copies `.claude/commands/ai-review.md`
  into the user-level `~/.claude/commands/`, so `/ai-review` is available in every Claude Code
  project after a global install — not just this repo's own checkout. Fails open (warns, exits 0)
  on any permissions/environment issue. Resolves the invoking user's real home directory even
  under `sudo npm install -g` (via `SUDO_USER`), instead of silently writing into root's home.
- `update-notifier` integration in the CLI entrypoint: checks for a newer published version at
  most once every 7 days, asynchronously and non-blocking, and prints a one-line reminder if
  found. Never auto-installs.

## [1.2.1] — 2026-07-03 (review-gate hardening)

### Fixed

- `dangerous-commands.ps1/.sh`, `check-contract.ps1/.sh`: read the wrong JSON field path (flat `.command`/`.file_path` instead of nested `tool_input.command`/`tool_input.file_path`) and signaled denial via exit codes, which `settings.json`'s fail-open wrapper (`|| true`) silently erased — both hooks were near-total no-ops. Fixed to use `hookSpecificOutput.permissionDecision: "deny"`.
- `check-contract.ps1/.sh`: schema bug — read `scope.files` instead of the documented `scope: [{file, op}]` array, so the scope check never matched an in-scope file even after the payload-path fix. `.sh` version also had a Windows CRLF bug (Python's `print()` adds `\r`) that broke exact-match comparisons.
- `dangerous-commands.ps1/.sh`: pipe-to-shell BLOCK pattern (`"| sh"` substring) collided with `sha256sum`/`shasum`, the hash tools the new review-gate hash-binding depends on — fixed with word-boundary regex/glob matching.
- Hash mismatch between documented review-gate commands and hook verification: PowerShell's pipeline re-tokenizes external-command output, so `Out-String`/array-join hashing did not reproduce the byte stream a raw shell pipe sees. Fixed by hashing a file written via redirection instead (confirmed byte-identical across PowerShell and bash).

### Added

- `scripts/review-reminders.ps1/.sh`: `PreToolUse` hook mechanically enforcing review-before-commit/push — `/code-review` and `/change-review` write a SHA-256 hash of the reviewed diff to a marker file, consumed atomically (rename, not check-then-delete) on the next matching `git commit`/`git push`.
- `scripts/review-reminders-post.ps1/.sh`: `PostToolUse` companion that reissues the marker if the gated commit/push then fails, detected via git ref comparison (`HEAD`/`@{u}` before/after) rather than an unverified response schema.
- `tests/review-reminders.Tests.ps1`: 23 Pester tests covering the review gate, including regressions for the sha256sum false-positive and the hash-consistency bug.

### Documentation

- `docs/HOOKS-GUIDE.md`: rewrote the dangerous-commands, check-contract, and review-gate sections to describe the fixed mechanisms; added a new section documenting `review-reminders-post`.

## [1.2.0] — 2026-06-26

### Fixed

- OllamaProvider: removed `0.0.0.0` from localhost allowlist (routes to external interfaces on Linux)
- OllamaProvider: added HTTP/HTTPS scheme validation (`ollama://` now throws with helpful error)
- OllamaProvider: wrapped `new URL()` in try/catch for actionable error on malformed input
- MCP server: added SIGTERM/SIGINT/stdin.close shutdown handlers (was leaking zombie processes on client disconnect)
- `base.ts` `validateFindings`: now accepts `evidence` field in addition to legacy `basis` field; logs count of dropped findings instead of silent discard
- contextLoader: emits stderr warning when `nomic-embed-text` is unavailable instead of silently returning empty context
- PMB `test-mb-doctor.sh`: all mutation sites now use EXIT trap guards — git status is clean after any test outcome (including crashes)
- PMB `mb.sh` doctor check 5: replaced `grep -c` with `grep -q` + explicit 0/1 assignment, fixing permanent SKIP in Git Bash

### Added

- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP refactor — finding validation/normalization now independently testable)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout; extension now rejects with clear message instead of hanging forever if Ollama stalls
- `tests/unit/embedder.test.ts` (new file): 10 tests covering `embed()` and `cosineSimilarity()` — semantic context path now has test coverage
- 6 new tests in `contextLoader.test.ts` and `baseAgent.test.ts` for semantic path and SRP extraction
- `.github/dependabot.yml`: weekly GitHub Actions version tracking
- `docs/CONTRACTS-GUIDE.md`: canonical task contract schema with dual-format scope compatibility note
- `docs/HOOKS-GUIDE.md`: hook types, enforcement layers, PreCompact behavior (warns, does not block)

### Security

- `gitleaks/gitleaks-action` pinned to commit SHA `dcedce43` in `release.yml` (was mutable `@v2` tag)
- `Bash(npx *)` wildcard scoped to `Bash(npx prettier *)` and `Bash(npx tsc *)` in `.claude/settings.json`

### CI

- `release.yml`: format:check and lint:eslint steps added before publish
- `release.yml`: VS Code extension tests added before publish (with `timeout-minutes: 5`)
- `release.yml`: NPM_TOKEN expiry reminder step added (expires 2026-09-08)

---

## [1.1.0] — 2026-06-25

### Added

- **`--no-emoji` flag**: disables emoji in markdown output for CI terminals without UTF-8 support. Severity labels become `[CRITICAL]`/`[HIGH]`/`[MEDIUM]`/`[LOW]`.
- **`--context-mode <mode>`**: `static` (default, hardcoded per-agent file routing) or `semantic` (ranks memory-bank files by cosine similarity to diff using `nomic-embed-text:latest`).
- **`--context-budget <n>`**: override the per-agent memory-bank context budget (default: 4000 chars).
- **`.aiignore` negation patterns**: lines starting with `!` now override exclude patterns (gitignore-style negation). Previously silently ignored.
- **ESLint** (`@eslint/js` + `typescript-eslint`): `npm run lint:eslint` — 0 warnings; included in `npm run check`.
- **`src/core/embedder.ts`**: cosine similarity + Ollama `/api/embeddings` for semantic context selection.
- **SARIF run-level properties**: context and policy metadata included in SARIF output when present.
- **GitHub token validation**: `upsertPRComment` throws early if token is empty.
- **Coverage agent parser**: balanced-brace extraction replaces greedy regex (prevents malformed JSON on complex outputs).
- **Orchestrator escalation**: breaking-change findings co-located with correctness or design findings are escalated one severity level.
- Migration-safety calibration fixture extended with Knex.js and Alembic patterns.
- vscode-extension v0.6.0: `aiReview.profile` dropdown, `aiReview.contextMode` dropdown, 15-agent description.

### Changed

- `npm run check` now includes `npm run lint:eslint` as a final step.
- TestGen fence regex expanded to match any language identifier (`ts`, `jsx`, `tsx`, etc.), not just `typescript`/`javascript`/`python`.
- `contextBudgetChars` added to `ReviewConfig` and `DEFAULT_CONFIG` (4000); hardcoded constant removed.

### Tests

- 276 unit tests across 35 test files (up from 264 at v1.0.1).
- 7 new markdown formatter tests (emoji/no-emoji mode).
- 5 new cosine similarity tests (`src/core/embedder.ts`).

---

## [1.0.1] — 2026-06-26

### Fixed

- OllamaProvider: removed `0.0.0.0` from localhost allowlist (routes to external interfaces on Linux)
- OllamaProvider: added HTTP/HTTPS scheme validation; `ollama://` protocol now throws with helpful error
- OllamaProvider: wrapped `new URL()` in try/catch for helpful error on malformed URL input
- CLI: added top-level try/catch to action handler — Ollama errors now show clean message + hint
- CLI: exported `program` from `cli/index.ts` to enable unit testing
- `release.yml`: added gitleaks secret scan step before npm publish
- `release.yml`: added VS Code extension test step (with `timeout-minutes: 5`)
- `release.yml`: added `format:check` and `lint:eslint` steps before publish
- `release.yml`: added NPM_TOKEN expiry reminder step
- `/change-review` Job 7: now writes diff to temp file and passes `--diff <tmpfile>` to ACR
- `check-contract.sh` / `.ps1`: handles both ACR `[{file,op}]` and PMB `{files:[]}` scope formats
- `check-contract.sh` / `.ps1`: emits warning on malformed JSON instead of silent pass
- `matchPattern`: exported from `ignoreFilter.ts`; removed copy-paste in `policyFilter.ts`
- `runner.ts`: decomposed 305-line `run()` into 5 private methods
- `base.ts`: logs when `validateFindings` drops items; accepts `evidence` field (not just legacy `basis`)
- MCP server: added SIGTERM/SIGINT/stdin.close shutdown handlers

### Added

- `docs/CONTRACTS-GUIDE.md`: canonical task contract schema documentation
- `docs/HOOKS-GUIDE.md`: hook types, enforcement layers, and per-hook behavior
- `.github/dependabot.yml`: weekly GitHub Actions version tracking
- CLI unit tests: 7 tests covering argument parsing, exit codes, error paths (`tests/unit/cli.test.ts`)

---

## [1.0.0] — 2026-06-24

### Added

- **`--profile` flag**: named agent subsets — `fast` (3 agents), `full` (15 agents), `change-review` (8 agents), `ui`, `migration`, `security`. `--agents` overrides `--profile`.
- **`--context memory-bank`**: loads per-agent project context from `memory-bank/` files before each agent runs. Budget-bounded at 4000 chars per agent by default.
- **`--format sarif`**: SARIF 2.1.0 output for upload to GitHub Code Scanning.
- **`--format github-annotations`**: GitHub Actions workflow annotation output (`::error`/`::warning`/`::notice` per finding).
- **Policy layer** (`agentPolicy` config): per-agent include/exclude glob path filtering. Policy footer added to JSON and markdown output.
- **Extended Finding schema**: `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`, `lineEnd` fields. `suggestion` kept as deprecated alias.
- All 15 specialist agent system prompts updated to emit new schema fields.
- `tests/helpers/requireOllama.ts`: visible error box with solution steps when Ollama or model is unavailable.
- Unit tests for all 16 specialist agents (10 previously untested core agents now covered).
- `src/core/contextLoader.ts`: per-agent memory-bank file routing with budget enforcement.
- `src/core/policyFilter.ts`: glob-based agent path filtering (no external dependency).
- `src/core/profiles.ts`: PROFILES map + `resolveProfile()`.
- `npm run check` script: single command runs tests + typecheck + build + format:check.

### Changed

- **testgen is now opt-in**: removed from `DEFAULT_CONFIG.agents`. Enable with `--suggest-tests` (report only) or `--write-tests` (writes files).
- Anthropic provider removed — ACR is Ollama-only. `provider` type narrowed to `'ollama'`.
- Removed dead config fields: `anthropicModel`, `contextLines`.
- MCP server version now reads from `package.json` at runtime (was hardcoded `'0.6.0'`).
- Shell injection fix: `execSync` with string interpolation replaced by `spawnSync` with array args.
- Calibration CI: `continue-on-error: true` + `timeout-minutes: 10` — releases not blocked when runner is offline.

### Removed

- `@anthropic-ai/sdk` from `optionalDependencies` — Anthropic provider was never implemented.

### Tests

- 255 unit tests across 34 test files (up from 112 at v0.8.0).
- 16/16 calibration PASS.

---

## [0.9.4] — 2026-06-19

### Added

- `--parallel` flag: runs specialist agents via `Promise.allSettled` for faster review.
- Two-phase `AgentProgressEvent`: `start` and `end` events with findings and elapsed time.

### Tests

- 120 unit tests (up from 117).

---

## [0.9.0–0.9.3] — 2026-06-18 to 2026-06-19

### Added

- `--fail-fast` flag: stops swarm on first finding at or above `--fail-on` threshold.
- `earlyExit` field on `ReviewResult`.
- stderr progress renderer with per-agent start/end events.

### Fixed

- Calibration prompt tuning: design (SOLID principle naming), complexity (concise recommendations).
- Balanced-bracket JSON parser fix in `base.ts`.

### Tests

- 117 unit tests.

## [0.8.0] — 2026-06-15

### Added

- **ErrorHandlingAgent**: flags swallowed exceptions, ignored Promise rejections, sentinel-value failure returns, and error paths that should propagate instead of logging-and-continuing.
- **ObservabilityAgent**: flags new code paths (branches, error cases, significant state changes, API entry points) that lack log output. Infers logging library from diff context.
- **MigrationSafetyAgent**: flags NOT NULL columns without a DEFAULT, DROP without IF EXISTS, missing FK indexes, and missing down migrations. Automatically skipped when the diff contains no migration files.
- **SecretsAgent**: detects hardcoded API keys, passwords, private keys, and connection strings in source code. Pure-LLM analysis.
- **ComplexityAgent**: flags high cyclomatic complexity and deep nesting. Uses `lizard` when installed for precise metrics; falls back to LLM estimation.
- `src/core/shell.ts` — shared `runTool()` utility for shelling out to optional external tools (`lizard`, `gitleaks`, etc.); returns `null` on ENOENT so agents degrade gracefully.
- Conditional `MigrationSafetyAgent` exclusion in `SwarmRunner`: agent is removed from the run list when `hasMigrationFiles(diff)` returns false, avoiding false positives on non-migration diffs.
- 5 new calibration fixtures covering each new agent domain.
- `preferredSecretsScanner` config field (`"gitleaks"` | `"trufflehog"` | `"none"`).
- `complexityThreshold` config field (default: `10`) — cyclomatic complexity cutoff for ComplexityAgent.

### Changed

- Default agent list extended from 11 to **16 agents** (added `error-handling`, `observability`, `migration-safety`, `secrets`, `complexity`).
- README updated: new agents table rows, optional dependencies section (gitleaks/lizard), new config field documentation.

### Tests

- 112 unit tests (up from 80): added 5 new agent test suites (5 tests each) and 6 migration-safety pattern tests.

## [0.7.0] — 2026-06-13

### Added

- **Configurable retry logic**: `withRetryTimeout` wrapper in `SwarmRunner` retries transient agent failures before skipping.
- `retryAttempts` config field (default: `2`) and `--retry-attempts` CLI flag.
- `retryDelayMs` config field (default: `2000`) and `--retry-delay` CLI flag.

### Tests

- 80 unit tests (up from 77): added 3 retry behaviour tests to runner suite.

## [0.6.0] — 2026-06-12

### Added

- **MCP server** (`ai-review-mcp` binary): exposes a `review_diff` tool over stdio MCP transport, compatible with Cursor and any MCP-aware client.
- A+C hybrid output format: agent findings as structured JSON + markdown summary in a single MCP response.
- `.cursor/mcp.json` shipped in the repo for zero-config Cursor integration.
- 15 new MCP unit tests covering the formatter and tool handler.

### Changed

- MCP server runs 15 agents (all except `testgen` — generated test files are CLI-only).
- `package.json` `bin` field now exports both `ai-review-agent` and `ai-review-mcp`.

### Tests

- 77 unit tests (up from 62): added mcp/formatter (8) and mcp/tool (7) suites.

## [0.5.0] — 2026-06-11

### Added

- **VS Code / Cursor extension** (`vscode-extension/` subfolder): subprocess architecture shells out to `ai-review-agent --format json`, parses `Finding[]`, and surfaces results via `DiagnosticCollection` (squiggles + Problems panel) and an OutputChannel markdown report.
- Command palette entry: `AI Review: Review Staged Changes`.
- `ai-review-agent` npm package bundled inside the `.vsix` — zero global install required.
- Packages to `ai-review-agent-0.5.0.vsix` (~138 KB).

### Notes

- VS Code Marketplace listing is deferred; install via `code --install-extension ai-review-agent-0.5.0.vsix`.

## [0.4.0] — 2026-06-11

### Changed

- `confidence` field added to the system prompt of all 10 specialist agents, instructing each to self-report a 0–100 confidence value per finding.
- `calibrate.ts` rewritten to cover all 11 agents (10 specialists + TestGenAgent). Previously covered only the original 9.
- Added `breaking-change.diff` and `license.diff` calibration fixtures.

## [0.3.0] — 2026-06-10

### Added

- **npm distribution**: package published to npm as `ai-review-agent` (original name `ai-review` was taken).
- Tag-triggered release workflow (`.github/workflows/release.yml`): publishes to npm on `v*` tags via `NPM_TOKEN` secret.
- Node.js upgraded to 24 in the release workflow.

### Changed

- Package renamed from `ai-review` to `ai-review-agent` in `package.json`.

## [0.2.0] — 2026-06-06

### Added

- **BreakingChangeAgent**: detects removed exports, changed function signatures, renamed public APIs, and incompatible return type changes. Reports as High severity.
- **LicenseComplianceAgent**: detects newly-added dependencies with GPL, AGPL, SSPL, Commons Clause, EUPL, or CDDL-1.0 licenses incompatible with commercial use; LGPL flagged at medium severity when dynamically linked. Reports as High severity.
- **Prompt injection sanitizer**: scans added lines in the diff for LLM-manipulating patterns (SYSTEM: directives, instruction overrides, role-play directives, long base64 payloads) and redacts them before agents run. Enabled by default; disable with `--no-sanitize`.
- **Confidence scoring**: `confidence` (0–100) field added to the Finding schema. Agents self-report confidence; defaults to 70. Shown in markdown reports.
- **Calibration CI** (`.github/workflows/calibrate.yml`): runs `npm run calibrate` weekly (Monday 06:00 UTC) and on releases on a self-hosted runner; skips gracefully when Ollama is unavailable.

### Changed

- **CLI flags consolidated**: `--path` renamed to `--dir`; `--max-diff-lines` renamed to `--max-lines`; `--ignore-path` renamed to `--ignore`. The implicit `review` subcommand has been removed — all flags are now top-level on the `ai-review` command.
- **Hallucination cross-check** is now confidence-aware: solo Critical + confidence ≥ 60 keeps its severity (previously always downgraded to Medium); solo Critical + confidence < 60 downgrades to High (not Medium). Solo High still downgrades to Medium.
- Default agent list extended from 9 to **11 agents** (added `breaking-change` and `license`).
- Version bumped to **0.2.0**.

### Tests

- 62 unit tests (up from 37): added sanitizer (9), BreakingChangeAgent (5), LicenseComplianceAgent (5), confidence (6) suites.

## [0.1.1] — 2026-06-06

### Added

- Guardrail G1: hallucination cross-check — Critical/High requires ≥2 agents at same file±5 lines
- Guardrail G2: diff size guard — `--max-diff-lines` flag (now `--max-lines`)
- Guardrail G3: finding deduplication merge — `corroboratingAgents` field on Finding schema
- Guardrail G4: per-agent timeouts — `--timeout` CLI flag
- Guardrail G5: severity gating — `--fail-on` flag
- Guardrail G6: path exclusions — `.aiignore` + `--ignore-path` flag

## [0.1.0] — 2026-06-06

### Added

- Initial release: 9-agent swarm (SecurityAgent, PerformanceAgent, CorrectnessAgent, DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent, CoverageAnalystAgent, TestGenAgent) + OrchestratorAgent
- CLI (`ai-review`) with Commander
- GitHub Actions workflow for PR review
- Claude Code slash command `/ai-review`
- Calibration suite with 9 fixture diffs
- E2E integration test against live Ollama
