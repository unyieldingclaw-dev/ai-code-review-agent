import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import { extractChangedFiles } from '../src/core/policyFilter.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { SecurityAgent } from '../src/core/agents/security.js'
import { PerformanceAgent } from '../src/core/agents/performance.js'
import { CorrectnessAgent } from '../src/core/agents/correctness.js'
import { DesignAgent } from '../src/core/agents/design.js'
import { DependenciesAgent } from '../src/core/agents/dependencies.js'
import { AdversarialAgent } from '../src/core/agents/adversarial.js'
import { IntegrationScoutAgent } from '../src/core/agents/integrationScout.js'
import { CoverageAnalystAgent } from '../src/core/agents/coverageAnalyst.js'
import { TestGenAgent } from '../src/core/agents/testGen.js'
import { BreakingChangeAgent } from '../src/core/agents/breakingChange.js'
import { LicenseComplianceAgent } from '../src/core/agents/licenseCompliance.js'
import { ErrorHandlingAgent } from '../src/core/agents/errorHandling.js'
import { ObservabilityAgent } from '../src/core/agents/observability.js'
import { MigrationSafetyAgent } from '../src/core/agents/migrationSafety.js'
import { SecretsAgent } from '../src/core/agents/secrets.js'
import { ComplexityAgent } from '../src/core/agents/complexity.js'
import { OrchestratorAgent } from '../src/core/agents/orchestrator.js'
import { claimsInjection, claimsSwallowedException } from '../src/core/claimSupport.js'
import { BaseAgent } from '../src/core/agents/base.js'
import type { Finding } from '../src/core/schema.js'

interface CalibrationCase {
  name: string
  // Key into agentMap. Defaults to `name` -- only needed when a single agent has more than one
  // case (name must stay unique per case for the printed log line, agentMap keys don't).
  agentName?: string
  fixtureFile: string
  // Names a committed lockfile fixture under calibration/fixtures/. When set, the runner
  // materialises it into a temp directory as package.json + package-lock.json and passes THAT
  // directory as projectPath instead of process.cwd().
  //
  // WHY this exists: cases that reach a real tool (npm audit, licenseFacts' lockfile lookup) were
  // silently asserting against ACR'S OWN repo state, because projectPath was hardcoded to
  // process.cwd(). That coupled their outcome to this repo's incidental dependency set -- the
  // `dependencies` case only ever passed because the repo happened to be vulnerable, and broke
  // when `npm audit` reached 0. Pointing a case at its own fixture project makes it test the
  // mechanism instead of the repo.
  projectPathFixture?: string
  // Either (expectedKeyword + baitKeyword) for "must find X, must not find Y", or expectEmpty
  // for "this fixture has nothing this agent should report on -- must return zero findings".
  expectedKeyword?: string
  baitKeyword?: string
  expectEmpty?: boolean
  // Narrower than expectEmpty: asserts the synthesized findings contain no injection or
  // swallowed-exception claim, but tolerates other finding categories surviving. Needed because
  // some agents have their own separate, unrelated hallucination patterns on a given fixture --
  // e.g. the security agent occasionally fabricates an IDOR claim, and the adversarial agent
  // can still emit residual NULL-handling findings against the SQL clean fixture in the vaguer
  // "does not validate / unexpected behavior" phrasing that claimsNullRaisesError deliberately
  // does not match (IDOR has no syntactic tell at all; the vague NULL phrasing asserts no
  // checkable mechanism). expectEmpty would make this case flaky by
  // asserting an invariant broader than what the filter actually guarantees; this asserts exactly
  // what it guarantees.
  expectNoInjectionOrExceptionClaims?: boolean
}

const BORDER = '╔════════════════════════════════════════════════════════════╗'
const BORDER_BOT = '╚════════════════════════════════════════════════════════════╝'

function pad(t: string, w: number): string {
  return t + ' '.repeat(Math.max(0, w - t.length))
}

function printBox(lines: string[]): void {
  process.stderr.write('\n' + BORDER + '\n')
  for (const l of lines) process.stderr.write(`║  ${pad(l, 56)}║\n`)
  process.stderr.write(BORDER_BOT + '\n\n')
}

/** Prints what an agent actually returned, so a failing case is diagnosable from its own output. */
function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('     (agent returned zero findings)')
    return
  }
  for (const f of findings.slice(0, 5)) {
    console.log(`     - [${f.file}:${f.line}] ${f.title}`)
    const detail = String(f.detail ?? '').replace(/\s+/g, ' ')
    if (detail) console.log(`       ${detail.slice(0, 160)}`)
  }
  if (findings.length > 5) console.log(`     ... and ${findings.length - 5} more`)
}

/**
 * Materialises a committed lockfile fixture into a temp directory as a real project, and returns
 * that directory for use as a case's projectPath.
 *
 * WHY write to a temp dir instead of committing the fixture as package-lock.json: Dependabot
 * security alerts key on the package-lock.json filename and scan every match in the repo,
 * independent of .github/dependabot.yml. A committed vulnerable lockfile would raise standing
 * alerts on a repo that deliberately holds `npm audit` at 0 -- degrading a live security signal to
 * serve a fixture. Renaming on the way out keeps the fixture deterministic and reviewable in git
 * while leaving the repo's own audit surface untouched.
 *
 * No `npm install` is needed: npm audit resolves advisories from the lockfile alone.
 */
function materializeFixtureProject(fixtureName: string): string {
  const lockfile = readFileSync(join('calibration/fixtures', fixtureName), 'utf-8')
  const parsed = JSON.parse(lockfile) as {
    name?: string
    version?: string
    packages?: Record<string, { dependencies?: Record<string, string> }>
  }
  const dir = join(tmpdir(), `acr-calibration-${fixtureName.replace(/\W+/g, '-')}`)
  mkdirSync(dir, { recursive: true })
  // package.json is derived from the lockfile's root entry rather than committed separately, so
  // the two can never drift into disagreeing about the dependency set.
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: parsed.name ?? 'acr-calibration-fixture',
        version: parsed.version ?? '1.0.0',
        private: true,
        dependencies: parsed.packages?.['']?.dependencies ?? {},
      },
      null,
      2
    )
  )
  writeFileSync(join(dir, 'package-lock.json'), lockfile)
  return dir
}

const CASES: CalibrationCase[] = [
  {
    name: 'security',
    fixtureFile: 'calibration/fixtures/security.diff',
    expectedKeyword: 'injection',
    baitKeyword: 'CONFIG_KEY',
  },
  {
    name: 'performance',
    fixtureFile: 'calibration/fixtures/performance.diff',
    expectedKeyword: 'N+1',
    baitKeyword: 'sumArray',
  },
  {
    name: 'correctness',
    fixtureFile: 'calibration/fixtures/correctness.diff',
    expectedKeyword: 'off-by-one',
    baitKeyword: 'isAdult',
  },
  {
    name: 'design',
    fixtureFile: 'calibration/fixtures/design.diff',
    expectedKeyword: 'responsibility',
    baitKeyword: 'formatCurrency',
  },
  {
    // This fixture touches package.json, so once projectPath is set below, DependenciesAgent's
    // run() override routes it through the real npm-audit tool path instead of the LLM -- the
    // agent never sees this fixture's fabricated "lodash wildcard" text at all.
    //
    // WHY expectEmpty and not expectedKeyword: 'vulnerability'. This case used to assert against
    // real npm-audit output of THIS repo, which silently coupled it to the repo's own incidental
    // vulnerability count. Bringing `npm audit` to 0 (2026-08-19) made it fail -- the case was
    // only ever passing because the repo happened to be vulnerable, and the alternative is keeping
    // a known CVE around so a test stays green, which is absurd. What it still guards is the bug
    // it was created for: if the npm-audit path breaks and the agent falls back to the LLM, the
    // prompt's old "lodash wildcard" example gets echoed as a fabricated finding, and this fails.
    //
    // Positive-detection coverage for the npm-audit path is genuinely lost here. Restoring it
    // needs a fixture project with its own vulnerable lockfile plus a per-case projectPath, which
    // the current single-repo harness cannot express -- tracked in memory-bank/progress.md
    // alongside the same self-referential problem in license-clean.
    name: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies.diff',
    expectEmpty: true,
  },
  {
    // Regression case for a real hallucination bug: dependencies.ts's prompt used to carry a
    // concrete "lodash wildcard version" example as its REQUIRED OUTPUT FORMAT, which the model
    // reproduced near-verbatim (including its literal unfilled placeholder text) when a diff had
    // nothing dependency-related to report. This fixture has zero dependency content -- the
    // agent must return nothing, not echo the prompt's old example.
    name: 'dependencies-clean',
    agentName: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies-clean.diff',
    expectEmpty: true,
  },
  {
    // The falsifying case DependenciesAgent previously lacked entirely. Both of its other cases
    // are expectEmpty, so an agent that returned [] unconditionally -- a dead npm-audit path, a
    // crash swallowed into an empty array -- passed calibration with nothing to catch it. This is
    // the only case that fails if the agent stops detecting anything.
    //
    // Runs against its own materialised fixture project rather than this repo, which is what the
    // `dependencies` case above could not express: that one asserted against ACR's real npm audit
    // output, passed only while the repo happened to be vulnerable, and had to be downgraded to
    // expectEmpty when `npm audit` reached 0.
    //
    // No baitKeyword: this case never reaches the LLM. DependenciesAgent routes any
    // manifest-touching diff with a projectPath through npm audit, so the finding set is exactly
    // what the tool reports -- there is no false-positive-prone generation to bait.
    name: 'dependencies-vulnerable',
    agentName: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies-vulnerable.diff',
    projectPathFixture: 'vulnerable-lockfile.json',
    expectedKeyword: 'lodash',
  },
  {
    name: 'adversarial',
    fixtureFile: 'calibration/fixtures/adversarial.diff',
    expectedKeyword: 'empty',
    baitKeyword: 'trimOrDefault',
  },
  {
    // Keyword is the fixture's REAL ISSUE function, not 'integration' -- see the complexity case
    // for the rationale. notifyWebhook is a new external HTTP call with no integration test;
    // buildPayload is the pure-function bait.
    name: 'integration',
    fixtureFile: 'calibration/fixtures/integration.diff',
    expectedKeyword: 'notifyWebhook',
    baitKeyword: 'buildPayload',
  },
  {
    name: 'coverage',
    fixtureFile: 'calibration/fixtures/coverage.diff',
    expectedKeyword: 'processRefund',
    baitKeyword: 'getVersion',
  },
  {
    name: 'breaking-change',
    fixtureFile: 'calibration/fixtures/breaking-change.diff',
    expectedKeyword: 'parameter',
    baitKeyword: '_formatUser',
  },
  {
    name: 'license',
    fixtureFile: 'calibration/fixtures/license.diff',
    expectedKeyword: 'lgpl',
    baitKeyword: 'chalk',
  },
  {
    // Regression case for the same class of hallucination bug as dependencies-clean above:
    // license.ts's prompt used to carry a concrete "package.json:14" line number in its REQUIRED
    // OUTPUT FORMAT example (plus a concrete MongoDB mention in its SSPL rule text), which the
    // model could echo back as a fabricated finding on a diff with nothing to report. This
    // fixture only adds a permissive-licensed (MIT) package -- the agent must return nothing.
    //
    // The fixture adds `commander`, NOT an arbitrary MIT package, so licenseFacts.ts's
    // deterministic ground-truth filter can resolve it and actually verify the claim. It
    // previously added `lodash`, which resolves nowhere here -- that made this a pure test of
    // model recall, measured 6/10 FAILING (the model asserted LGPL-3.0 for lodash with
    // basis=VERIFIED, and in one trial named MIT correctly yet still filed a high-severity
    // finding).
    //
    // `commander` resolves against its OWN fixture lockfile rather than ACR's: the case used to
    // pass only because commander happens to be a real dependency of this repo, i.e. it asserted
    // against this repo's incidental dependency set instead of the mechanism, and dropping the
    // dependency would have silently reverted it to the model-recall configuration above. Same
    // root cause the `dependencies` case hit from the other direction, where the repo's state
    // moving (npm audit reaching 0) broke a green case outright.
    //
    // NOTE: packages that resolve nowhere still fall back to model recall by design
    // (licenseFacts.ts fails open so a genuine LGPL detection like license.diff's `node-lame`
    // survives) -- that residual is mitigated by prompt wording only, not deterministically.
    name: 'license-clean',
    agentName: 'license',
    fixtureFile: 'calibration/fixtures/license-clean.diff',
    projectPathFixture: 'license-clean-lockfile.json',
    expectEmpty: true,
  },
  {
    name: 'error-handling',
    fixtureFile: 'calibration/fixtures/error-handling.diff',
    expectedKeyword: 'swallowed',
    baitKeyword: 'loadUserPreferences',
  },
  {
    // Keyword is the fixture's REAL ISSUE function, not 'logging' -- see the complexity case for
    // WHY this case keeps the weaker domain-vocabulary keyword while complexity and integration
    // were strengthened to fixture identifiers: 'cancelOrder' was tried and measured, not assumed.
    // Across 6 live runs the agent named the function in 4 -- it reliably finds the right issue
    // (all 6 runs reported the missing log on order cancellation, none flagged the formatDate
    // bait) but varies on whether it names the symbol. A ~67% keyword hit rate makes the case
    // flaky, which injects exactly the noise that gets misread as model variance in the overall
    // score, so 'logging' is the lesser evil here.
    //
    // The durable fix is asserting on the finding's FILE rather than its wording -- every run
    // localized to src/services/orderService.ts regardless of phrasing. That needs an
    // expectedFile field on CalibrationCase and is deliberately out of scope here.
    name: 'observability',
    fixtureFile: 'calibration/fixtures/observability.diff',
    expectedKeyword: 'logging',
    baitKeyword: 'formatDate',
  },
  {
    name: 'migration-safety',
    fixtureFile: 'calibration/fixtures/migration-safety.diff',
    expectedKeyword: 'not null',
    baitKeyword: 'idx_users_email',
  },
  {
    name: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets.diff',
    expectedKeyword: 'password',
    baitKeyword: 'REPLACE_WITH_REAL_KEY',
  },
  {
    // Regression case for a real false positive reported against a Flutter/Dart project: a
    // "password"-named identifier is not itself a finding -- the agent must check the VALUE
    // assigned to it (see secrets.ts's value-shape rule). This fixture has zero real secrets --
    // just a boolean UI-toggle flag and a controller reference, both merely named "password".
    name: 'secrets-value-shape',
    agentName: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets-value-shape.diff',
    expectEmpty: true,
  },
  {
    // SecretsAgent's run() override routes any diff whose changed file exists on disk through
    // gitleaks instead of the LLM. gitleaksParser maps title/detail from gitleaks' own rule
    // metadata (RuleID/Description), not fixture-specific text -- --redact means `evidence` is
    // always the literal string "REDACTED", so the keyword must match what gitleaks itself
    // reports for this rule, not the fixture's own "not a real secret" comment.
    name: 'secrets-gitleaks',
    agentName: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets-gitleaks.diff',
    expectedKeyword: 'generic api key',
    baitKeyword: 'AWS_SESSION_TOKEN',
  },
  {
    // WHY the keyword is the fixture's function name and not 'complexity': the ComplexityAgent's
    // own domain vocabulary appears in nearly any output it produces, so asserting on it verifies
    // that the agent ran and used its prompt's words -- not that it located the right code. The
    // fixture marks exactly one REAL ISSUE (calculateShippingCost, deeply nested) against one
    // FALSE POSITIVE BAIT (formatAddress, long but linear); naming the real one is what proves
    // detection. Matches the pattern the stronger cases already use (coverage/processRefund,
    // correctness/isAdult, breaking-change/_formatUser).
    name: 'complexity',
    fixtureFile: 'calibration/fixtures/complexity.diff',
    expectedKeyword: 'calculateShippingCost',
    baitKeyword: 'formatAddress',
  },
  {
    // Regression case for the originally-reported bug: a parameterized, auth.uid()-scoped
    // Postgres RLS function was hallucinated as SQL injection / swallowed-exception by
    // security/correctness/adversarial/error-handling despite containing no dynamic-SQL-
    // construction or exception-handling syntax at all. Two rounds of prompt-only fixes measured
    // live against Ollama plateaued (security 5/8, error-handling 3/6); this is now guarded by
    // the deterministic filterUnsupportedClaims post-filter in orchestrator.ts (claimSupport.ts),
    // not prompt wording alone -- live-reverified after the filter: security and error-handling
    // both went from 2/8 raw misfires to 0/8 surviving injection/swallowed-exception claims.
    //
    // Uses expectNoInjectionOrExceptionClaims, not expectEmpty: the security agent also
    // occasionally fabricates an IDOR claim on this fixture (e.g. "Potential Insecure Direct
    // Object Reference"), which filterUnsupportedClaims deliberately does not cover -- IDOR has
    // no syntactic tell, so it's not deterministically falsifiable (see claimSupport.ts header).
    // expectEmpty would make this case fail on that expected, out-of-scope residual instead of
    // testing what this filter actually guarantees.
    name: 'security-sql-clean',
    agentName: 'security',
    fixtureFile: 'calibration/fixtures/sql-injection-clean.diff',
    expectNoInjectionOrExceptionClaims: true,
  },
  {
    // Over-suppression counter-test: the filter must not blanket-drop every injection claim on a
    // Postgres migration just because it's SQL. This fixture is a genuine EXECUTE + string-
    // concatenation injection (search_visits) -- live-verified the finding survives
    // filterUnsupportedClaims: across 3 trials each for security/correctness/error-handling/
    // adversarial, all 11 injection findings the four agents produced survived. baitKeyword guards
    // WHY the bait is a SAFE DECOY function rather than a token from the vulnerable code: the
    // fixture previously baited on `auth.uid`, which appears in the fixture itself, so a perfectly
    // correct injection finding that merely mentioned the surrounding policy failed the case --
    // observed flaking across runs. `is_group_member` here is parameterized and has no injection
    // surface at all, so naming it is unambiguously a misattribution. That is also the exact
    // false positive originally reported, which makes this a real discrimination test: find the
    // injection in search_visits, do not blame the safe function beside it.
    name: 'security-sql-vulnerable',
    agentName: 'security',
    fixtureFile: 'calibration/fixtures/sql-injection-vulnerable.diff',
    expectedKeyword: 'injection',
    baitKeyword: 'is_group_member',
  },
]

async function main() {
  // Run a subset of cases without editing this file -- e.g. to verify one assertion change
  // against live Ollama instead of paying for all 21 agent runs:
  // CALIBRATION_CASE=complexity,observability npm run calibrate
  // Matches CALIBRATION_MODEL's env-var idiom below.
  //
  // WHY an unknown name is a hard error and not an empty run: a typo'd filter that quietly
  // matches nothing would report "0 passed, 0 failed" and exit 0 -- a green result from a
  // suite that never executed, which is precisely the failure class this suite exists to
  // catch. Checked before the Ollama ping so a typo fails in milliseconds, not after setup.
  //
  // WHY 'testgen' is a valid name despite not being in CASES: it runs from a hardcoded block
  // after the loop rather than as a CalibrationCase, so it needs explicit inclusion both in the
  // known-name list here and in its own guard below. Without that it would run on every
  // filtered invocation, making a targeted single-case run pay for an extra agent.
  const caseFilter = (process.env.CALIBRATION_CASE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const knownNames = [...CASES.map((c) => c.name), 'testgen']
  if (caseFilter.length > 0) {
    const unknown = caseFilter.filter((n) => !knownNames.includes(n))
    if (unknown.length > 0) {
      console.error(`Unknown calibration case(s): ${unknown.join(', ')}`)
      console.error(`Known cases: ${knownNames.join(', ')}`)
      process.exit(1)
    }
  }
  const selectedCases =
    caseFilter.length > 0 ? CASES.filter((c) => caseFilter.includes(c.name)) : CASES
  const runTestGen = caseFilter.length === 0 || caseFilter.includes('testgen')

  // Override which model calibration runs against without editing config.ts -- e.g. to bake
  // off a candidate model's finding quality: CALIBRATION_MODEL=qwen3:latest npm run calibrate
  const model = process.env.CALIBRATION_MODEL || DEFAULT_CONFIG.model
  const provider = new OllamaProvider(DEFAULT_CONFIG.ollamaUrl, model)

  // Check 1: Ollama reachable
  const ping = await provider.ping()
  if (!ping.ok) {
    printBox([
      'CALIBRATION SKIPPED — Ollama not reachable',
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. npm run calibrate',
    ])
    process.exit(1)
  }

  // Check 2: Required model is pulled
  try {
    const res = await fetch(`${DEFAULT_CONFIG.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    const data = (await res.json()) as { models: Array<{ name: string }> }
    if (!data.models.some((m) => m.name === model)) {
      printBox([
        'CALIBRATION SKIPPED — model not available',
        '',
        `  Required model: ${model}`,
        '  Ollama is running but this model is not pulled.',
        '',
        'Solution:',
        `  ollama pull ${model}`,
        '  then: npm run calibrate',
      ])
      process.exit(1)
    }
  } catch {
    printBox(['CALIBRATION SKIPPED — could not verify model list'])
    process.exit(1)
  }

  const orch = new OrchestratorAgent(DEFAULT_CONFIG)
  const agentMap: Record<string, BaseAgent> = {
    security: new SecurityAgent(provider, DEFAULT_CONFIG),
    performance: new PerformanceAgent(provider, DEFAULT_CONFIG),
    correctness: new CorrectnessAgent(provider, DEFAULT_CONFIG),
    design: new DesignAgent(provider, DEFAULT_CONFIG),
    dependencies: new DependenciesAgent(provider, DEFAULT_CONFIG),
    adversarial: new AdversarialAgent(provider, DEFAULT_CONFIG),
    integration: new IntegrationScoutAgent(provider, DEFAULT_CONFIG),
    coverage: new CoverageAnalystAgent(provider, DEFAULT_CONFIG),
    'breaking-change': new BreakingChangeAgent(provider, DEFAULT_CONFIG),
    license: new LicenseComplianceAgent(provider, DEFAULT_CONFIG),
    'error-handling': new ErrorHandlingAgent(provider, DEFAULT_CONFIG),
    observability: new ObservabilityAgent(provider, DEFAULT_CONFIG),
    'migration-safety': new MigrationSafetyAgent(provider, DEFAULT_CONFIG),
    secrets: new SecretsAgent(provider, DEFAULT_CONFIG),
    complexity: new ComplexityAgent(provider, DEFAULT_CONFIG),
  }

  let passed = 0
  let failed = 0

  for (const c of selectedCases) {
    process.stdout.write(`\nRunning calibration: ${c.name}...\n`)
    const diff = readFileSync(c.fixtureFile, 'utf-8')
    try {
      const rawFindings: Finding[] = await agentMap[c.agentName ?? c.name].run({
        diff,
        projectPath: c.projectPathFixture
          ? materializeFixtureProject(c.projectPathFixture)
          : process.cwd(),
      })
      // Exercise the same file-existence and claim-support defenses runner.ts applies in real
      // usage, so calibration reflects actual end-to-end behavior, not just the raw agent's
      // output.
      const findings = orch.synthesize(rawFindings, extractChangedFiles(diff), undefined, diff)

      if (c.expectEmpty) {
        if (findings.length === 0) {
          console.log(`  ✅ PASS — correctly reported no findings`)
          passed++
        } else {
          console.log(
            `  ❌ FAIL — expected zero findings, got ${findings.length}: ` +
              findings.map((f) => `"${f.title}"`).join(', ')
          )
          failed++
        }
        continue
      }

      if (c.expectNoInjectionOrExceptionClaims) {
        const bad = findings.filter((f) => claimsInjection(f) || claimsSwallowedException(f))
        if (bad.length === 0) {
          console.log(
            `  ✅ PASS — no surviving injection/swallowed-exception claims ` +
              `(${findings.length} other finding(s) tolerated)`
          )
          passed++
        } else {
          console.log(
            `  ❌ FAIL — ${bad.length} injection/swallowed-exception claim(s) survived: ` +
              bad.map((f) => `"${f.title}"`).join(', ')
          )
          failed++
        }
        continue
      }

      const hasLegitimate = findings.some(
        (f) =>
          f.title.toLowerCase().includes(c.expectedKeyword!.toLowerCase()) ||
          f.detail.toLowerCase().includes(c.expectedKeyword!.toLowerCase())
      )
      // WHY the explicit baitKeyword guard, when every current case declares bait: `baitKeyword`
      // is optional on CalibrationCase, and without this guard a case omitting it passes
      // `undefined` to String.includes, which coerces to the literal string "undefined" -- so any
      // finding reading "may be undefined" / "undefined behavior" would register as a
      // false-positive hit and FAIL the case for reasons unrelated to what it tests. Verified:
      // `'possible undefined dereference'.includes(undefined)` === true.
      //
      // This is defensive, not a fix for an observed failure: all 16 keyword cases currently set
      // baitKeyword, so the path is unreachable today. It is guarded because the type permits the
      // omission and the failure it would produce is silent and misattributable to model variance.
      const hasBait = c.baitKeyword
        ? findings.some(
            (f) => f.title.includes(c.baitKeyword!) || f.detail.includes(c.baitKeyword!)
          )
        : false

      if (hasLegitimate && !hasBait) {
        console.log(
          c.baitKeyword
            ? `  ✅ PASS — found '${c.expectedKeyword}', rejected '${c.baitKeyword}'`
            : `  ✅ PASS — found '${c.expectedKeyword}' (no bait declared)`
        )
        passed++
      } else {
        if (!hasLegitimate) console.log(`  ❌ FAIL — missed '${c.expectedKeyword}'`)
        if (hasBait) console.log(`  ❌ FAIL — false positive '${c.baitKeyword}'`)
        // WHY print the findings on failure: without them the log said only "missed 'X'", which
        // cannot distinguish the two causes that need opposite fixes -- the agent found the right
        // issue but worded it differently (assertion too strict) versus the agent missed it
        // entirely (real regression). Diagnosing a failure previously meant re-running the agent
        // by hand through the CLI to see its actual output.
        printFindings(findings)
        failed++
      }
    } catch (err) {
      console.log(`  ❌ FAIL — agent error: ${(err as Error).message}`)
      failed++
    }
  }

  // TestGen: verify test generation from gaps
  if (runTestGen) {
    process.stdout.write(`\nRunning calibration: testgen...\n`)
    try {
      const diff = readFileSync('calibration/fixtures/testgen.diff', 'utf-8')
      const testGen = new TestGenAgent(provider, DEFAULT_CONFIG)
      const { testFiles } = await testGen.runWithGaps({ diff }, [
        {
          file: 'src/billing/invoice.ts',
          functionName: 'calculateTax',
          lineStart: 1,
          lineEnd: 9,
          description:
            'Calculates tax by multiplying subtotal by taxRate, rounds to 2 decimal places. Validates taxRate is 0-1.',
        },
      ])
      const hasTestContent =
        testFiles.length > 0 && testFiles[0].content.toLowerCase().includes('calculatetax')
      if (hasTestContent) {
        console.log(`  ✅ PASS — generated test file with calculateTax coverage`)
        passed++
      } else {
        console.log(`  ❌ FAIL — no test content generated for calculateTax`)
        failed++
      }
    } catch (err) {
      console.log(`  ❌ FAIL — agent error: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\nCalibration [${model}]: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
