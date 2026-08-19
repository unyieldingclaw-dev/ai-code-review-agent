// src/core/claimSupport.ts
// Deterministic support-checks for finding claims whose mechanism is checkable from diff text.
//
// WHY this exists (and why it isn't a prompt fix): four agents (security, correctness,
// adversarial, error-handling) were measured inventing SQL-injection / swallowed-exception
// findings against a safe, parameterized Postgres RLS function. Two rounds of increasingly
// explicit prompt rules were applied and re-measured live against Ollama; the misfire rate didn't
// drop, it changed shape -- once "gid isn't parameterized" was explicitly ruled out, the model
// switched to claiming auth.uid() itself was attacker-controlled. That's a confabulation prior
// (decide a finding is warranted from surface pattern-matching, then justify it post-hoc), not a
// missing instruction, so more wording keeps playing whack-a-mole. secrets.ts hit the identical
// wall and solved it the same way -- see hasCredentialShapedValue and its CHANGELOG entry, which
// records that the prompt-only attempt measured 5/10 before and 5/10 after.
//
// WHY these three claim classes and not others (notably IDOR): injection cannot exist without
// dynamic query/command construction somewhere in the code, and an exception cannot be swallowed
// by code containing no exception-handling construct, and SQL cannot raise on a NULL comparison
// (it yields no match) unless the code contains something that actually raises. Those are the
// definitions of the three claim classes, so their absence is decidable from syntax. The NULL
// class is additionally gated on the file being SQL -- in imperative languages a null deref
// genuinely does throw, so the same check there would cause false negatives. IDOR has no such syntactic
// tell -- no token's absence disproves an authorization gap -- so it is deliberately NOT handled
// here and remains covered by the agent prompt rules plus evidenceVerifier.ts, which was measured
// to catch the IDOR case correctly even though it missed the injection one.

import type { Finding } from './schema.js'
import { splitByFileBoundary } from './chunkRunner.js'
import { extractChangedFiles } from './policyFilter.js'
import { normalizeFilePath, stripDiffPrefix } from './filePath.js'

// Broad on purpose: this side decides only "is the finding making this kind of claim at all",
// and the evidence side below is what actually protects against over-filtering.
const INJECTION_CLAIM = /\binjections?\b|\bsqli\b/i

// A third rationalization measured live (calibration + scratch trials against the clean SQL
// fixture, after the literal "injection"/"sqli" wording above was already covered): the model
// makes the same claim -- untrusted input reaching a query unsafely -- in validation/sanitization
// language instead ("Potential Unsafe User Input Usage in SQL Function" / "auth.uid() ... may not
// be safe"). Anchored tightly to an explicit sql/query/statement term nearby (NOT to "function" or
// "parameter", which are common in completely unrelated, legitimate input-validation findings --
// e.g. a REST handler not validating a request body has nothing to do with SQL injection) so this
// stays narrow: it only fires when the claim is unambiguously about query safety.
const UNSAFE_QUERY_INPUT_CLAIM =
  /\b(unsafe|unsanitized|unescaped|unvalidated)\b[^.]{0,80}\b(sql|quer(y|ies)|statement)\b|\b(sql|quer(y|ies)|statement)\b[^.]{0,80}\b(unsafe|unsanitized|unescaped|unvalidated)\b/i

// Injection classes whose mechanism is NOT string-building, so hasDynamicConstruction cannot
// falsify them. The module's premise -- injection requires dynamic query/command construction --
// holds for SQL/command/code injection and is FALSE for these: XSS reaches a DOM sink, NoSQL
// injection passes an object straight to a query API, and header/CRLF injection writes an
// unvalidated value into a response header. Verified concretely that without this exclusion the
// filter dropped real findings against `dangerouslySetInnerHTML={{ __html: html }}`,
// `Users.find(req.body.filter)`, and `res.setHeader('Location', req.query.url)` -- none of which
// contain any string concatenation at all. Matching any of these makes the claim unfilterable
// (fail open), which is the correct direction for a class this filter cannot reason about.
const NON_STRING_BUILDING_INJECTION =
  /\bxss\b|cross[- ]site scripting|dangerouslysetinnerhtml|innerhtml|\bnosql\b|mongo(db)?\s+injection|header\s+injection|\bcrlf\b|ldap\s+injection|xpath\s+injection|template\s+injection|\bssti\b|prototype pollution|\bxxe\b|insecure deserializ|unsafe deserializ/i

// WHY this exclusion is required, not optional: "dependency injection" / "constructor injection"
// are ordinary design vocabulary, and the design agent legitimately uses them. Without this,
// a real SOLID finding would be matched as an injection claim and then dropped for lacking
// dynamic-SQL syntax it was never talking about.
const DI_VOCABULARY =
  /\b(dependency|constructor|setter|property|method|service|container|di)[\s-]+injections?\b/i

// The errorHandling agent's prompt requires the literal word "swallowed" in all its findings, so
// that stem is a reliable anchor; the rest covers the same claim arriving from another agent's
// vocabulary.
const SWALLOWED_CLAIM =
  /\bswallow|\b(empty|silent|bare)\s+catch\b|\b(exceptions?|rejections?|errors?)\b[^.]{0,40}\b(ignored|suppressed|discarded|silently)\b|\b(ignored|suppressed|unhandled)\b[^.]{0,40}\b(exceptions?|rejections?)\b/i

// A claim that a NULL/absent/missing input makes the code RAISE -- error out, throw, crash, fail.
// Distinct from SWALLOWED_CLAIM above (which is about an exception being suppressed) and matched
// separately because its falsifier is different: nothing can raise from code that contains no
// error-raising construct at all.
//
// Deliberately requires BOTH a null-ish subject and a raising outcome in the same finding, so an
// ordinary "returns false / may not be the intended behavior" observation is NOT matched -- only
// the specific, checkable assertion that an error occurs.
// WHY "empty" is deliberately NOT a null-ish term here: adversarial legitimately reports
// empty-collection edge cases, and including it made this pattern match an ordinary
// "Swallowed exception :: the catch block is empty" finding, which is a different claim entirely.
// "invalid"/"malformed" ARE included: against a typed SQL column those describe a value the type
// system makes unrepresentable, which is the same fabricated-mechanism class.
// WHY "missing" and "absent" were removed (while "invalid"/"malformed" stay): those two are
// generic code-review vocabulary, not statements about a null value. Combined with RAISES's
// "fail(s|ure)" and a window that spans sentences, they matched ordinary prose and dropped real
// findings on .sql files -- verified concretely: an RLS finding reading "RLS is missing on
// public.api_tokens ... This is a complete failure of tenant isolation" was dropped, as was a
// migration-safety finding reading "If the create fails ... a rollback path is missing." Those are
// exactly the high-value findings SQL migrations exist to catch. "invalid"/"malformed" are kept:
// against a typed SQL column they describe a value the type system makes unrepresentable, which
// is the same fabricated-mechanism class, and neither appeared in the two verified regressions.
const NULL_ISH = String.raw`(null|nil|none|undefined|invalid|malformed)`
// WHY 'fail/fails/failure' is deliberately NOT a raising verb here: "a complete failure of
// tenant isolation" / "the isolation guarantee fails" is ordinary security prose, not a claim
// that code raises. Paired with the cross-sentence window below it collided with any nearby
// null-ish word and silently dropped real findings -- verified against a pure RLS migration:
// "The new policy uses using (true). None of the rows are scoped to a tenant. This is a
// complete failure of tenant isolation." was dropped entirely. A genuinely fabricated
// raise-claim always names an explicit raising verb (error/exception/throw/raise/crash), so
// removing this alternative loses no true positives -- measured 5/12 wrong -> 0/12 on a
// 12-case corpus of real-must-survive vs fabricated-must-drop findings.
const RAISES = String.raw`(errors?|exceptions?|crash(es|ed)?|throws?|thrown|raise[sd]?|dereferences?|syntax error)`
// WHY the window spans sentence boundaries ([\s\S], not [^.]): measured live, the model routinely
// splits the claim across two sentences ("...does not handle the case where gid is NULL. This
// could lead to SQL errors.") or simply phrases it past 80 characters. A sentence-bounded window
// missed both. The breadth is safe here only because the caller gates this on two much stronger
// conditions -- the file must be SQL, and its section must contain no error-raising construct at
// all -- so this pattern never decides a drop on its own.
const NULL_RAISES_CLAIM = new RegExp(
  `\\b${NULL_ISH}\\b[\\s\\S]{0,140}\\b${RAISES}\\b|\\b${RAISES}\\b[\\s\\S]{0,140}\\b${NULL_ISH}\\b`,
  'i'
)

// --- Evidence patterns -------------------------------------------------------------------
//
// Every set below is deliberately PERMISSIVE: a single hit keeps the finding. The asymmetry
// (broad claim-matching, permissive evidence-matching) is what keeps false negatives near zero --
// a finding is only ever dropped when its claimed mechanism is unambiguously absent.

// Dynamic SQL: the query text itself is being assembled at runtime.
// WHY `format!?`: Rust builds query strings with the `format!(...)` macro, and the bare
// `format\s*\(` form missed it because of the `!` -- caught by the injection corpus check,
// which measured it as a false negative (a real injection whose finding would have been dropped).
const DYNAMIC_SQL = /\bexecute\b|\bformat!?\s*\(|\bquote_(ident|literal)\b|\bsp_executesql\b/i

// String interpolation / concatenation of any kind. In a general-purpose source file at least one
// of these is almost always present, which is precisely why this filter's real reach is
// declarative diffs (SQL migrations, config, schema) -- see the module header.
// WHY [^\S\n] and not \s in the concatenation alternatives: \s matches newlines, so `"foo"\n+bar`
// in a unified diff let a string-literal-then-plus pattern match a quote at the end of one line
// against the NEXT line's `+` diff prefix. diffSectionCode below strips those prefixes, which is
// the real fix; keeping concatenation single-line is the belt-and-braces half, since a `+` at a
// line end joining the next line is a line continuation, not evidence of query building.
// WHY `||` must be quote-adjacent rather than bare: `||` is SQL string concatenation, but in
// shell, JS, and YAML it is logical OR. A bare `\|\|` matched ordinary fallback chaining like
// `script.sh || true` and `script.sh || FAIL=1`, which made this function report dynamic
// construction for a fully static, hardcoded command line -- so a fabricated command-injection
// finding against it survived the filter. Real SQL concatenation always abuts a string literal
// (`'... ' || term`), so requiring an adjacent quote keeps the SQL case while excluding
// control-flow OR. Reported from a live run against a real repo's hook/workflow lines.
//
// WHY bare `$VAR`, `$(...)` and backticks are listed: shell interpolation does NOT use `${...}`
// braces, so without these a genuinely injectable `script.sh "$USER_INPUT"` read as having no
// dynamic construction at all and a REAL command-injection finding would have been dropped. That
// is a false negative on a live vulnerability class, the most costly error this filter can make.
// WHY the `\$["'`]` alternative in addition to `\$\w`: C# interpolated strings are written
// `$"SELECT ... {id}"`, where `$` is followed by a quote rather than a word character, so `\$\w`
// did not match. Measured as a false negative by the injection corpus check -- a very common
// real-world C# SQL-injection shape whose finding would have been silently dropped.
const INTERPOLATION =
  /\$\{|\$\(|\$\w|\$["'`]|`[^`]*`|%[sdq]\b|\bf["']|\.format\s*\(|\bsprintf\b|\|\|[^\S\n]*["'`]|["'`][^\S\n]*\|\||\.concat\s*\(|\+[^\S\n]*["'`]|["'`][^\S\n]*\+|#\{|<%=/

// Command/code execution surfaces, for command-injection and code-injection claims.
const COMMAND_EXEC =
  /\bexec(Sync|File|FileSync)?\s*\(|\bspawn(Sync)?\s*\(|\bsystem\s*\(|\bpopen\s*\(|\bsubprocess\b|shell\s*=\s*True|\bchild_process\b|\beval\s*\(|\bnew\s+Function\s*\(/i

// WHY the NULL-raises check below is restricted to SQL files, unlike the two above: in an
// imperative language a null dereference raises with no raising keyword anywhere in sight
// (`obj.foo` on null throws a TypeError), so any "can this raise?" pattern general enough to be
// safe there would have to match ordinary property access and calls -- i.e. match everything, and
// never fire. SQL is different: its NULL semantics are total and well-defined (comparing to NULL
// yields unknown, which filters rows; it does not error), so absence of an explicit raising
// construct really does prove a NULL argument cannot raise. Restricting by extension keeps this
// filter away from every language where that reasoning would not hold.
const SQL_FILE = /\.(sql|psql|ddl|pgsql)$/i

// Constructs through which SQL can actually raise. Permissive on purpose (any hit keeps the
// finding): an explicit RAISE, a typed cast that can fail on bad input (`::`/CAST -- this is the
// legitimate "malformed input errors" case), a constraint that can be violated, division, or
// STRICT/assert semantics.
const SQL_ERROR_RAISING =
  /\braise\b|\bexception\b|\bassert\b|\bsignal\s+sqlstate\b|::|\bcast\s*\(|\bnot\s+null\b|\bcheck\s*\(|\bunique\b|\breferences\b|\bconstraint\b|\bstrict\b|\w\s*\/\s*\w/i

// Exception-handling constructs across the languages this tool reviews, plus the async/promise
// forms the errorHandling prompt also covers ("ignored Promise rejections"), plus Go's
// error-return idiom -- Go has no exceptions, so a "swallowed error" claim there is legitimate and
// must not be dropped.
const EXCEPTION_HANDLING =
  /\btry\s*[{:(]|\bcatch\b|\.catch\s*\(|\bfinally\b|\bexcept\b|\brescue\b|\brecover\s*\(|\bexception\s+when\b|\bthrows?\b|\braise\b|\bpanic\s*\(|\berr\s*!=\s*nil\b|\b_\s*,\s*\w+\s*:?=|\.then\s*\(|\bawait\b|\bPromise\b|\bunwrap\b|\bon\s+error\b|2>\s*[/&]\S*null|\|\|\s*true|\blet\s+_\s*=|\.ok\s*\(|\bunwrap_or|\bset\s*[-+]e\b/i

/** True if the finding is claiming an injection vulnerability (SQL, command, code, etc.). */
export function claimsInjection(finding: Pick<Finding, 'title' | 'detail'>): boolean {
  const text = `${finding.title} ${finding.detail}`
  // Fail open on injection classes this filter's evidence patterns cannot falsify.
  if (NON_STRING_BUILDING_INJECTION.test(text)) return false
  if (UNSAFE_QUERY_INPUT_CLAIM.test(text)) return true
  if (!INJECTION_CLAIM.test(text)) return false
  // Strip DI vocabulary before deciding -- a finding can legitimately mention both.
  return INJECTION_CLAIM.test(text.replace(new RegExp(DI_VOCABULARY.source, 'gi'), ''))
}

/** True if the finding is claiming an exception/error was swallowed, ignored, or suppressed. */
export function claimsSwallowedException(finding: Pick<Finding, 'title' | 'detail'>): boolean {
  return SWALLOWED_CLAIM.test(`${finding.title} ${finding.detail}`)
}

/** True if `section` contains any syntax capable of producing an injection vulnerability. */
export function hasDynamicConstruction(section: string): boolean {
  return DYNAMIC_SQL.test(section) || INTERPOLATION.test(section) || COMMAND_EXEC.test(section)
}

/** True if `section` contains any exception/error-handling construct. */
export function hasExceptionHandling(section: string): boolean {
  return EXCEPTION_HANDLING.test(section)
}

/**
 * True if the finding asserts that a NULL/absent input makes the code raise an error.
 *
 * Only the raising assertion is matched, not the vaguer "returns false, which may not be intended"
 * observation -- the latter is a judgment call about intent, not a checkable claim about mechanism.
 */
export function claimsNullRaisesError(finding: Pick<Finding, 'title' | 'detail'>): boolean {
  return NULL_RAISES_CLAIM.test(`${finding.title} ${finding.detail}`)
}

/** True if `file` is a SQL file, the only place claimsNullRaisesError is safe to act on. */
export function isSqlFile(file: string): boolean {
  return SQL_FILE.test(file)
}

/** True if this SQL `section` contains any construct capable of raising an error. */
export function sqlSectionCanRaise(section: string): boolean {
  return SQL_ERROR_RAISING.test(section)
}

/**
 * Splits a diff into one section per file, keyed by normalized/prefix-stripped path.
 *
 * WHY per-file rather than checking the whole diff: `${...}` (and `||`, and `await`) appear in
 * most realistic TypeScript diffs for reasons unrelated to SQL -- log messages, error strings, UI
 * text. A whole-diff check would therefore find "evidence" in nearly every multi-file PR and the
 * filter would never fire. Scoping to the file the finding actually names also matches the
 * diagnosed failure mode: the fabricated findings were always attributed to the specific .sql
 * file, never smeared across the diff.
 *
 * WHY maxLines = 1: splitByFileBoundary packs whole `diff --git` sections against a line budget,
 * so a budget no section can fit under forces exactly one section per chunk. Reusing it keeps the
 * `diff --git` split in one tested place rather than duplicating the regex here -- the same
 * anti-drift reasoning filePath.ts's header states for normalizeFilePath/stripDiffPrefix.
 */
export function sliceDiffByFile(diff: string): Map<string, string> {
  const sections = new Map<string, string>()
  for (const section of splitByFileBoundary(diff, 1)) {
    for (const file of extractChangedFiles(section)) {
      sections.set(stripDiffPrefix(normalizeFilePath(file)), diffSectionCode(section))
    }
  }
  return sections
}

// Diff headers, in the order they can appear in a `diff --git` section. `+++ b/path` starts with
// '+' and would otherwise survive as an "added line", so headers must be removed before the
// added/context split below.
const DIFF_HEADER =
  /^(diff --git |index |--- |\+\+\+ |@@|new file |deleted file |similarity |rename |old mode |new mode |Binary files )/

/**
 * Reduces a diff section to the code it actually describes: added ('+') and context (' ') lines,
 * with the one-character diff prefix removed.
 *
 * WHY this is required and not a nicety: without it the evidence patterns match the diff's own
 * punctuation rather than the code. Measured concretely -- the clean SQL fixture reported
 * hasDynamicConstruction=true because a line ending in a quote, followed by the next line's '+'
 * prefix, matched a string-concatenation pattern. The filter would have silently never fired on
 * the exact case it was built for.
 *
 * Removed ('-') lines are excluded deliberately: they aren't in the resulting code, so syntax that
 * only appears in deleted lines is not evidence the merged result can be vulnerable.
 */
export function diffSectionCode(section: string): string {
  return section
    .split('\n')
    .filter((line) => !DIFF_HEADER.test(line))
    .filter((line) => line.startsWith('+') || line.startsWith(' ') || line === '')
    .map((line) => line.slice(1))
    .join('\n')
}

/**
 * Looks up a finding's own diff section. Returns undefined when the file isn't in the map, which
 * callers must treat as "skip the check" -- see filterUnsupportedClaims.
 *
 * Matches the path tolerance of orchestrator.ts's filterNonexistentFiles: models sometimes echo
 * the diff's own "a/path" / "b/path" header prefix into a finding's file field verbatim.
 */
export function lookupFileSection(sections: Map<string, string>, file: string): string | undefined {
  const normalized = normalizeFilePath(file)
  return sections.get(normalized) ?? sections.get(stripDiffPrefix(normalized))
}
