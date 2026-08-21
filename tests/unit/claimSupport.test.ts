// tests/unit/claimSupport.test.ts
import { describe, it, expect } from 'vitest'
import {
  claimsInjection,
  claimsSwallowedException,
  hasDynamicConstruction,
  hasExceptionHandling,
  sliceDiffByFile,
  sliceRemovedCodeByFile,
  isPreImageOnlyEvidence,
  lookupFileSection,
  diffSectionCode,
  claimsNullRaisesError,
  isSqlFile,
  sqlSectionCanRaise,
} from '../../src/core/claimSupport.js'

// The reproduction fixture for the originally-reported bug: adversarial/security/correctness
// agents flagged this parameterized, auth.uid()-scoped Postgres RLS function as SQL injection.
// It contains no dynamic-SQL-construction syntax at all -- this is the case the filter exists for.
const CLEAN_SQL_DIFF = `diff --git a/supabase/migrations/x.sql b/supabase/migrations/x.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/x.sql
@@ -0,0 +1,10 @@
+create or replace function is_group_member(gid uuid)
+returns boolean
+language sql
+security definer
+set search_path = ''
+as $$
+  select exists (
+    select 1 from public.group_members
+    where group_id = gid and user_id = auth.uid()
+  );
+$$;
`

// A genuine injection: string concatenation feeding EXECUTE.
const VULNERABLE_SQL_DIFF = `diff --git a/supabase/migrations/y.sql b/supabase/migrations/y.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/y.sql
@@ -0,0 +1,8 @@
+create or replace function search_visits(term text)
+returns setof public.visits
+language plpgsql
+as $$
+begin
+  return query execute 'select * from public.visits where note like ''%' || term || '%''';
+end;
+$$;
`

describe('claimsInjection', () => {
  it('matches an SQL injection claim', () => {
    expect(
      claimsInjection({
        title: 'SQL Injection in is_group_member',
        detail: 'The gid parameter is interpolated into the query.',
      })
    ).toBe(true)
  })

  it('matches an "sqli" abbreviation', () => {
    expect(claimsInjection({ title: 'Possible SQLi', detail: 'unsafe query building' })).toBe(true)
  })

  it('matches a command injection claim', () => {
    expect(
      claimsInjection({
        title: 'Command injection via exec',
        detail: 'user input reaches the shell',
      })
    ).toBe(true)
  })

  it('does not match "dependency injection"', () => {
    // The design agent's normal SOLID vocabulary -- must not be misread as a security claim.
    expect(
      claimsInjection({
        title: 'Improper dependency injection',
        detail: 'The service container wires this eagerly instead of via constructor injection.',
      })
    ).toBe(false)
  })

  it('does not match "constructor injection"', () => {
    expect(
      claimsInjection({ title: 'Constructor injection missing', detail: 'Prefer DI over new.' })
    ).toBe(false)
  })

  it('still matches an injection claim that happens to also mention DI vocabulary', () => {
    // A finding can legitimately reference both concepts -- stripping the DI phrase must not
    // blind the matcher to a real, separately-stated injection claim in the same text.
    expect(
      claimsInjection({
        title: 'SQL injection risk',
        detail: 'Unrelated to the dependency injection setup mentioned elsewhere in this file.',
      })
    ).toBe(true)
  })

  it('does not match unrelated findings', () => {
    expect(
      claimsInjection({ title: 'Missing index on visits', detail: 'Sequential scan likely.' })
    ).toBe(false)
  })

  it('matches "unsafe ... SQL" validation-language rationalizations lacking the word injection', () => {
    // Reproduced live: after "injection"/"sqli" wording was already covered, the model produced
    // the same underlying claim in validation language instead.
    expect(
      claimsInjection({
        title: 'Potential Unsafe User Input Usage in SQL Function',
        detail:
          'The auth.uid() function call is used without proper input validation or escaping, ' +
          'which could lead to a vulnerability if the user ID is manipulated.',
      })
    ).toBe(true)
  })

  it('does not match a generic, non-SQL "lacks input validation" finding', () => {
    // WHY this must stay false: an unrelated, legitimate finding about a REST handler or form
    // field not validating its input has nothing to do with SQL injection. Broadly matching any
    // "unsafe"/"unvalidated" language would risk dropping a real finding just because its file
    // happens to have no dynamic-SQL syntax (it was never about SQL at all).
    expect(
      claimsInjection({
        title: 'Missing input validation',
        detail: 'The signup form does not validate that the email field is a valid address.',
      })
    ).toBe(false)
  })
})

// Regression guards for false negatives found by the review of this change. Each of these was
// verified to be DROPPED before the fix -- i.e. a real security finding silently discarded, which
// is the dangerous failure direction for this filter.
describe('false-negative regressions (real findings that must never be dropped)', () => {
  it('does not treat an RLS/authorization finding on a .sql file as a NULL-error claim', () => {
    // "missing" + "failure" are generic review vocabulary; combined with a window that spans
    // sentences they matched this real finding and dropped it. NULL_ISH is now restricted to
    // words that actually denote a null value.
    expect(
      claimsNullRaisesError({
        title: 'New api_tokens table is created without row-level security',
        detail:
          'RLS is missing on public.api_tokens, so any authenticated role can read every row. ' +
          'This is a complete failure of tenant isolation and exposes all API tokens.',
      })
    ).toBe(false)
  })

  it('does not treat a missing-transaction migration finding as a NULL-error claim', () => {
    expect(
      claimsNullRaisesError({
        title: 'Migration is not wrapped in a transaction',
        detail: 'If the create fails partway a rollback path is missing.',
      })
    ).toBe(false)
  })

  it.each([
    [
      'XSS',
      'HTML injection (XSS) via dangerouslySetInnerHTML',
      'User HTML is rendered into the DOM without sanitization',
    ],
    ['NoSQL', 'NoSQL injection', 'req.body.filter is passed directly to Users.find'],
    [
      'CRLF header',
      'Header injection',
      'req.query.url is written into the Location response header',
    ],
  ])(
    'does not claim-match %s injection, whose mechanism is not string-building',
    (_l, title, detail) => {
      // hasDynamicConstruction cannot falsify these -- they reach a sink directly with no string
      // concatenation anywhere -- so they must fail open rather than be dropped.
      expect(claimsInjection({ title, detail })).toBe(false)
    }
  )

  it.each([
    ['shell 2>/dev/null', 'run_migrations 2>/dev/null'],
    ['shell || true', 'deploy.sh || true'],
    ['rust let _ =', 'let _ = write_audit_log(&event);'],
    ['rust .ok()', 'write_audit_log(&event).ok();'],
  ])('counts %s as error handling, so a swallowed-error finding survives', (_l, code) => {
    // These swallow errors with no try/catch present. Without them a legitimate
    // "errors are silently ignored" finding in shell or Rust was dropped.
    expect(hasExceptionHandling(code)).toBe(true)
  })
})

// Second round of false-negative regressions, found by an independent audit of the FIRST round of
// fixes. Both were cases where the initial fix was incomplete or wrong -- kept as tests because
// each was verified to drop a real finding.
describe('audit regressions (second round)', () => {
  it.each([
    [
      'RLS policy using(true)',
      'Policy allows all rows',
      'The new policy uses using (true). None of the rows are scoped to a tenant. This is a complete failure of tenant isolation.',
    ],
    [
      'missing WITH CHECK',
      'Missing WITH CHECK clause',
      'The policy has no WITH CHECK clause, so none of the inserts are validated and the isolation guarantee fails.',
    ],
    [
      'null tenant rows world-readable',
      'Null tenant rows visible to everyone',
      'Rows whose tenant_id is null are visible to everyone, a complete failure of the isolation model.',
    ],
  ])(
    'does not read security prose about "failure"/"fails" as a raise claim: %s',
    (_l, title, detail) => {
      // "a complete failure of tenant isolation" is not a claim that code raises. With `fail*` in
      // RAISES and a cross-sentence window, any nearby null-ish word dropped these outright.
      expect(claimsNullRaisesError({ title, detail })).toBe(false)
    }
  )

  it.each([
    ['SQL errors', 'Passing NULL could lead to SQL errors'],
    ['raise', 'Passing NULL will raise an exception'],
    ['crash', 'A null gid crashes the query'],
    ['throw', 'null causes the function to throw a syntax error'],
  ])('still matches a fabricated raise claim naming an explicit raising verb: %s', (_l, detail) => {
    expect(claimsNullRaisesError({ title: 'Null input', detail })).toBe(true)
  })

  it.each([
    [
      'headers',
      'SQL injection in security definer function',
      'The function headers do not restrict input',
    ],
    ['HTML', 'SQL injection risk in policy', 'the value is rendered to HTML downstream'],
    ['deserialized', 'SQL injection via deserialized group id', 'the id is deserialized then used'],
    ['DOM', 'SQL injection in the DOM-facing view', 'the view is DOM-facing'],
  ])(
    'does not let a real SQLi claim escape the filter by merely mentioning %s',
    (_l, title, detail) => {
      // The non-string-building exclusion must name an injection CLASS, not a bare noun. Unanchored,
      // these four fabricated SQLi findings all escaped.
      expect(claimsInjection({ title, detail })).toBe(true)
    }
  )
})

describe('claimsSwallowedException', () => {
  it('matches "swallowed exception"', () => {
    expect(
      claimsSwallowedException({ title: 'Swallowed exception', detail: 'Errors are discarded.' })
    ).toBe(true)
  })

  it('matches an empty catch block claim', () => {
    expect(
      claimsSwallowedException({ title: 'Empty catch block', detail: 'The catch body is bare.' })
    ).toBe(true)
  })

  it('matches an ignored-promise-rejection claim', () => {
    expect(
      claimsSwallowedException({
        title: 'Unhandled rejection',
        detail: 'Promise rejections are ignored here.',
      })
    ).toBe(true)
  })

  it('does not match unrelated findings', () => {
    expect(
      claimsSwallowedException({
        title: 'Missing index on visits',
        detail: 'Sequential scan likely.',
      })
    ).toBe(false)
  })
})

describe('hasDynamicConstruction', () => {
  it('is false against the clean parameterized SQL function (the reproduction case)', () => {
    const sections = sliceDiffByFile(CLEAN_SQL_DIFF)
    const section = lookupFileSection(sections, 'supabase/migrations/x.sql')
    expect(section).toBeDefined()
    expect(hasDynamicConstruction(section as string)).toBe(false)
  })

  it('is true against a genuine EXECUTE + concatenation injection', () => {
    const sections = sliceDiffByFile(VULNERABLE_SQL_DIFF)
    const section = lookupFileSection(sections, 'supabase/migrations/y.sql')
    expect(section).toBeDefined()
    expect(hasDynamicConstruction(section as string)).toBe(true)
  })

  it('detects template-literal interpolation', () => {
    expect(hasDynamicConstruction('const q = `SELECT * FROM users WHERE id = ${id}`')).toBe(true)
  })

  it('detects command-execution surfaces', () => {
    expect(hasDynamicConstruction('execSync(`rm -rf ${dir}`)')).toBe(true)
  })

  it('does NOT treat shell logical-OR fallback chaining as dynamic construction', () => {
    // Reported from a live run: `script.sh || true` / `script.sh || FAIL=1` are fully static,
    // hardcoded command lines with nothing interpolated. A bare `||` pattern read them as SQL
    // string concatenation, so fabricated command-injection findings against them survived.
    const SH = 'b' + 'ash'
    expect(hasDynamicConstruction(`${SH} scripts/check.sh templates/scripts || FAIL=1`)).toBe(false)
    expect(
      hasDynamicConstruction(`pwsh -File scripts/c.ps1 2>/dev/null || ${SH} scripts/c.sh || true`)
    ).toBe(false)
  })

  it('DOES treat shell variable interpolation as dynamic construction', () => {
    // The costliest possible error for this filter is a false negative on a real vulnerability.
    // Shell interpolation has no ${...} braces, so bare $VAR / $(...) / backticks must all count.
    const SH = 'b' + 'ash'
    expect(hasDynamicConstruction(`${SH} scripts/foo.sh "$USER_INPUT"`)).toBe(true)
    expect(hasDynamicConstruction(`${SH} -c "deploy $(cat target)"`)).toBe(true)
  })

  it('still treats SQL string concatenation as dynamic construction', () => {
    // `||` abutting a string literal is genuine SQL concatenation and must keep matching.
    expect(hasDynamicConstruction("execute 'select * from t where a = ''' || term || ''''")).toBe(
      true
    )
  })

  it('is false against plain declarative code with no concatenation or interpolation', () => {
    expect(hasDynamicConstruction('using (is_group_member(visits.group_id));')).toBe(false)
  })
})

// Cross-language injection corpus. Every entry contains a REAL injection, so hasDynamicConstruction
// must return true for each -- a false here means the filter would silently DROP a genuine
// vulnerability finding, which is the dangerous failure direction (unlike a false positive, which
// is only noise). Two entries in this list were live false negatives when the corpus was first
// run -- C# interpolated strings and Rust format!() -- and the patterns were fixed to close them.
describe('hasDynamicConstruction — cross-language injection corpus (false-negative guard)', () => {
  const VULNERABLE: Array<[string, string]> = [
    ['python f-string', 'cur.execute(f"SELECT * FROM users WHERE id = {uid}")'],
    ['python %-format', 'cur.execute("SELECT * FROM t WHERE id = %s" % uid)'],
    ['python .format()', 'cur.execute("SELECT * FROM t WHERE id = {}".format(uid))'],
    ['python concat', 'q = "SELECT * FROM t WHERE id = " + uid'],
    ['python os.system', 'os.system("tar -cf out.tar " + path)'],
    ['python subprocess shell=True', 'subprocess.run(cmd, shell=True)'],
    ['python eval', 'eval(user_input)'],
    ['js template literal', 'db.query(`SELECT * FROM users WHERE id = ${id}`)'],
    ['js concat', 'db.query("SELECT * FROM users WHERE id = " + id)'],
    ['js child_process', 'require("child_process").exec("ls " + dir)'],
    ['js new Function', 'new Function("return " + expr)()'],
    ['ts execSync template', 'execSync(`git log ${ref}`)'],
    ['java concat', 'stmt.executeQuery("SELECT * FROM users WHERE id = " + userId);'],
    ['java var-first concat', 'String q = userId + " AND active = 1";'],
    ['java Runtime.exec', 'Runtime.getRuntime().exec("ping " + host);'],
    ['php interpolation', '$sql = "SELECT * FROM users WHERE id = $id";'],
    ['php dot-concat', '$sql = "SELECT * FROM users WHERE id = " . $id;'],
    ['ruby interpolation', 'User.find_by_sql("SELECT * FROM t WHERE id = #{id}")'],
    ['ruby backticks', 'output = `ls #{dir}`'],
    ['go Sprintf', 'q := fmt.Sprintf("SELECT * FROM t WHERE id = %s", id)'],
    ['go exec.Command', 'exec.Command("sh", "-c", "ls "+dir)'],
    ['csharp interpolated string', 'var q = $"SELECT * FROM users WHERE id = {id}";'],
    ['csharp concat', 'var q = "SELECT * FROM users WHERE id = " + id;'],
    ['shell variable', 'psql -c "SELECT * FROM t WHERE id = $USER_INPUT"'],
    ['shell eval', 'eval "$user_cmd"'],
    ['shell backtick', 'result=`grep $pattern file.txt`'],
    ['shell command substitution', 'out=$(cat $userfile)'],
    ['perl interpolation', 'my $sql = "SELECT * FROM t WHERE id = $id";'],
    ['c sprintf', 'sprintf(query, "SELECT * FROM t WHERE id = %s", id);'],
    ['c system', 'system(cmd);'],
    ['plpgsql EXECUTE format', "execute format('select * from %I', tbl);"],
    ['plpgsql EXECUTE concat', "execute 'select * from t where id = ' || id;"],
    ['plpgsql quote_ident', "execute 'select * from ' || quote_ident(tbl);"],
    ['tsql sp_executesql', 'EXEC sp_executesql @sql'],
    ['tsql EXEC concat', "EXEC('SELECT * FROM t WHERE id = ' + @id)"],
    ['rust format! macro', 'let q = format!("SELECT * FROM t WHERE id = {}", id);'],
    ['kotlin string template', 'val q = "SELECT * FROM t WHERE id = $id"'],
    ['scala s-interpolation', 'val q = s"SELECT * FROM t WHERE id = $id"'],
    ['groovy gstring', 'def q = "SELECT * FROM t WHERE id = ${id}"'],
  ]

  it.each(VULNERABLE)('detects dynamic construction: %s', (_label, code) => {
    expect(hasDynamicConstruction(code)).toBe(true)
  })

  it('stays false for genuinely parameterized SQL, or the filter could never fire', () => {
    expect(
      hasDynamicConstruction('create policy p on visits for select using (is_group_member(gid));')
    ).toBe(false)
    expect(
      hasDynamicConstruction('select 1 from m where group_id = gid and user_id = auth.uid()')
    ).toBe(false)
  })

  it('goes inert (fail-open) on named dollar-quote tags and positional bind params', () => {
    // Documents a known limitation rather than asserting desired behavior. `\$\w` exists for
    // shell/PHP interpolation ($VAR, $id), but it also matches Postgres' named dollar-quote tags
    // ($BODY$, $function$) and positional bind parameters ($1) -- both of which are SAFE
    // constructs. The effect is fail-open: the filter simply stops firing on such files, so real
    // findings are never dropped. Tightening this would increase reach but expands drop behavior,
    // so it needs its own measurement first (see progress.md).
    expect(hasDynamicConstruction('as $BODY$ select 1 $BODY$;')).toBe(true)
    expect(hasDynamicConstruction('select * from t where id = $1')).toBe(true)
  })
})

describe('hasExceptionHandling', () => {
  it('is false against the clean SQL function (no exception construct present)', () => {
    const sections = sliceDiffByFile(CLEAN_SQL_DIFF)
    const section = lookupFileSection(sections, 'supabase/migrations/x.sql')
    expect(hasExceptionHandling(section as string)).toBe(false)
  })

  it('detects try/catch', () => {
    expect(hasExceptionHandling('try { risky() } catch (e) { }')).toBe(true)
  })

  it('detects .catch(', () => {
    expect(hasExceptionHandling('promise.catch((e) => log(e))')).toBe(true)
  })

  it('detects a Postgres PL/pgSQL EXCEPTION WHEN block', () => {
    expect(hasExceptionHandling('exception when others then null;')).toBe(true)
  })

  it("detects Go's err != nil idiom", () => {
    // Go has no exceptions -- a "swallowed error" claim against Go's own idiom is legitimate and
    // must not be filtered as unsupported.
    expect(hasExceptionHandling('if err != nil {\n  return\n}')).toBe(true)
  })
})

describe('diffSectionCode', () => {
  it('strips diff headers and the +/space line-prefix, keeps added and context lines', () => {
    const code = diffSectionCode(CLEAN_SQL_DIFF)
    expect(code).not.toContain('diff --git')
    expect(code).not.toContain('+++ b/')
    expect(code).toContain('create or replace function is_group_member(gid uuid)')
  })

  it('excludes removed lines', () => {
    const withRemoval = `diff --git a/f.sql b/f.sql
--- a/f.sql
+++ b/f.sql
@@ -1,2 +1,2 @@
-select * from t where id = id_val || user_input;
+select * from t where id = id_val;
`
    const code = diffSectionCode(withRemoval)
    expect(code).not.toContain('user_input')
    expect(code).toContain('select * from t where id = id_val;')
  })

  it('does not let a trailing quote on one added line match a "+" on the next added line', () => {
    // Regression: a concatenation pattern (quote followed by optional whitespace then '+')
    // previously matched a quote at a line's end against the NEXT line's diff '+' prefix,
    // reporting dynamic construction where none existed in the underlying code.
    const twoLineDiff = `diff --git a/f.sql b/f.sql
new file mode 100644
--- /dev/null
+++ b/f.sql
@@ -0,0 +1,2 @@
+select 'literal'
+from t;
`
    const sections = sliceDiffByFile(twoLineDiff)
    const section = lookupFileSection(sections, 'f.sql')
    expect(section).toBeDefined()
    expect(hasDynamicConstruction(section as string)).toBe(false)
  })
})

describe('sliceDiffByFile / lookupFileSection', () => {
  it('returns undefined for a file not present in the diff', () => {
    const sections = sliceDiffByFile(CLEAN_SQL_DIFF)
    expect(lookupFileSection(sections, 'src/unrelated.ts')).toBeUndefined()
  })

  it('matches despite a leading "./" on the looked-up path', () => {
    const sections = sliceDiffByFile(CLEAN_SQL_DIFF)
    expect(lookupFileSection(sections, './supabase/migrations/x.sql')).toBeDefined()
  })

  it('matches despite a git-diff "a/" prefix on the looked-up path', () => {
    const sections = sliceDiffByFile(CLEAN_SQL_DIFF)
    expect(lookupFileSection(sections, 'a/supabase/migrations/x.sql')).toBeDefined()
  })

  it('produces one section per file in a multi-file diff', () => {
    const multi = `${CLEAN_SQL_DIFF}${VULNERABLE_SQL_DIFF}`
    const sections = sliceDiffByFile(multi)
    expect(sections.size).toBe(2)
    expect(lookupFileSection(sections, 'supabase/migrations/x.sql')).toBeDefined()
    expect(lookupFileSection(sections, 'supabase/migrations/y.sql')).toBeDefined()
  })
})

describe('claimsNullRaisesError / isSqlFile / sqlSectionCanRaise', () => {
  it('matches a claim that a NULL input causes an error', () => {
    expect(
      claimsNullRaisesError({
        title: 'Null UUID Input Breaks Function',
        detail: 'Passing null to is_group_member causes an SQL syntax error',
      })
    ).toBe(true)
  })

  it('matches when the claim spans a sentence boundary', () => {
    // Measured live: the model routinely splits the claim across two sentences, which a
    // sentence-bounded window missed entirely.
    expect(
      claimsNullRaisesError({
        title: 'Missing NULL check',
        detail:
          'The function does not handle the case where gid is NULL. This could lead to SQL errors.',
      })
    ).toBe(true)
  })

  it('matches "invalid/malformed" variants, which a typed column makes unrepresentable', () => {
    // NOTE: the raising outcome must be an explicit raising verb. This fixture originally said
    // only "...can cause is_group_member to fail", which no longer matches on purpose -- "fail"
    // was removed from RAISES because "a complete failure of tenant isolation" is ordinary
    // security prose, not a claim that code raises (see the audit regressions below).
    expect(
      claimsNullRaisesError({
        title: 'UUID policy check may error',
        detail: 'Invalid UUID in visits.group_id causes is_group_member to throw a type error',
      })
    ).toBe(true)
  })

  it('does NOT match a claim with no asserted raising outcome', () => {
    // "returns false / may not be intended" is a judgment about intent, not a checkable claim
    // about mechanism -- deliberately left alone.
    expect(
      claimsNullRaisesError({
        title: 'NULL uuid in is_group_member',
        detail:
          'Passing NULL as gid causes the policy to match no rows, which may not be intended.',
      })
    ).toBe(false)
  })

  it('does NOT match an empty-catch swallowed-exception finding', () => {
    // Regression: "empty" was originally treated as a null-ish term and wrongly matched this.
    expect(
      claimsSwallowedException({
        title: 'Swallowed exception',
        detail: 'The catch block is empty.',
      })
    ).toBe(true)
    expect(
      claimsNullRaisesError({ title: 'Swallowed exception', detail: 'The catch block is empty.' })
    ).toBe(false)
  })

  it('identifies SQL files only', () => {
    expect(isSqlFile('supabase/migrations/x.sql')).toBe(true)
    expect(isSqlFile('a/x.sql')).toBe(true)
    expect(isSqlFile('src/handler.ts')).toBe(false)
  })

  it('reports the clean SQL function as unable to raise', () => {
    const section = lookupFileSection(sliceDiffByFile(CLEAN_SQL_DIFF), 'supabase/migrations/x.sql')
    expect(sqlSectionCanRaise(section as string)).toBe(false)
  })

  it('reports SQL with an explicit RAISE or a failable cast as able to raise', () => {
    expect(sqlSectionCanRaise("begin raise exception 'nope'; end")).toBe(true)
    // A cast is the legitimate "malformed input really does error" case -- must fail open.
    expect(sqlSectionCanRaise('select gid::uuid from t')).toBe(true)
  })
})

// A diff that FIXES an N+1: the loop exists only on '-' lines, and the post-image is clean.
// Deliberately the shape that was measured misfiring 8/8 against a live model.
const N_PLUS_ONE_REMOVED_DIFF = `diff --git a/src/users/service.ts b/src/users/service.ts
--- a/src/users/service.ts
+++ b/src/users/service.ts
@@ -1,8 +1,5 @@
 export async function getUsersWithPosts(userIds: string[]) {
-  const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds])
-  for (const user of users.rows) {
-    user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id])
-  }
-  return users.rows
+  const rows = await db.query('SELECT u.*, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id WHERE u.id = ANY($1)', [userIds])
+  return groupPostsByUser(rows.rows)
 }`

describe('isPreImageOnlyEvidence', () => {
  const removedOf = (d: string, f: string) => lookupFileSection(sliceRemovedCodeByFile(d), f) ?? ''
  const postOf = (d: string, f: string) => lookupFileSection(sliceDiffByFile(d), f) ?? ''
  const F = 'src/users/service.ts'

  it('drops a finding whose evidence quotes only deleted lines', () => {
    // The real shape, measured: the model renders a three-line loop as ONE line of evidence, so
    // this only matches because whitespace is normalized before comparing.
    const evidence =
      "for (const user of users.rows) { user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id]) }"
    expect(
      isPreImageOnlyEvidence(
        evidence,
        removedOf(N_PLUS_ONE_REMOVED_DIFF, F),
        postOf(N_PLUS_ONE_REMOVED_DIFF, F)
      )
    ).toBe(true)
  })

  it('keeps a finding whose evidence quotes added code (the counter-test that guards over-suppression)', () => {
    const evidence = 'return groupPostsByUser(rows.rows)'
    expect(
      isPreImageOnlyEvidence(
        evidence,
        removedOf(N_PLUS_ONE_REMOVED_DIFF, F),
        postOf(N_PLUS_ONE_REMOVED_DIFF, F)
      )
    ).toBe(false)
  })

  it('keeps a finding whose evidence is paraphrased rather than quoted (fail open)', () => {
    // The filter is only ever a positive proof that the text was deleted. A model that describes
    // the code instead of quoting it must not be filtered on a guess.
    const evidence = 'The function loads related posts for each user inside a loop'
    expect(
      isPreImageOnlyEvidence(
        evidence,
        removedOf(N_PLUS_ONE_REMOVED_DIFF, F),
        postOf(N_PLUS_ONE_REMOVED_DIFF, F)
      )
    ).toBe(false)
  })

  it('keeps a finding whose evidence survives into the post-image (a moved line)', () => {
    // Both sides contain the text, so the code still exists after the diff -- dropping it would be
    // a false negative, the direction that actually costs something.
    const moved = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-  const token = buildAuthorizationHeaderFromSecret(secretValue)
+  const token = buildAuthorizationHeaderFromSecret(secretValue)
   return token`
    const evidence = 'const token = buildAuthorizationHeaderFromSecret(secretValue)'
    expect(
      isPreImageOnlyEvidence(evidence, removedOf(moved, 'src/a.ts'), postOf(moved, 'src/a.ts'))
    ).toBe(false)
  })

  it('keeps a finding whose evidence is too short to be a meaningful quote', () => {
    // "return users.rows" appears only on a deleted line here, but a fragment that small can
    // coincide with deleted text while the finding is really about the new code.
    expect(
      isPreImageOnlyEvidence(
        'return users.rows',
        removedOf(N_PLUS_ONE_REMOVED_DIFF, F),
        postOf(N_PLUS_ONE_REMOVED_DIFF, F)
      )
    ).toBe(false)
  })

  it('keeps a finding with no evidence at all', () => {
    expect(isPreImageOnlyEvidence(undefined, 'anything', 'anything')).toBe(false)
  })

  it('does not throw on a non-string evidence value', () => {
    // parsing.ts sets `evidence: f.evidence ?? f.detail ?? ''`, and `??` only falls through on
    // null/undefined -- so a finding whose evidence arrived as a NUMBER keeps that number. Without
    // a typeof guard this threw "text.replace is not a function" from inside synthesize(), after
    // every agent had already run: one malformed finding would fail the whole review.
    expect(() =>
      isPreImageOnlyEvidence(12345 as unknown as string, 'removed', 'post')
    ).not.toThrow()
    expect(isPreImageOnlyEvidence(12345 as unknown as string, 'removed', 'post')).toBe(false)
  })
})

describe('sliceRemovedCodeByFile', () => {
  it('returns the deleted lines, which sliceDiffByFile discards by construction', () => {
    // This asymmetry is the bug that made the first version of the filter inert: the section
    // sliceDiffByFile hands out is post-image, so a pre-image check fed from it can never fire.
    const F2 = 'src/users/service.ts'
    expect(postOfRemovedCheck(N_PLUS_ONE_REMOVED_DIFF, F2)).not.toContain('for (const user of')
    expect(lookupFileSection(sliceRemovedCodeByFile(N_PLUS_ONE_REMOVED_DIFF), F2)).toContain(
      'for (const user of'
    )
  })
})

function postOfRemovedCheck(d: string, f: string): string {
  return lookupFileSection(sliceDiffByFile(d), f) ?? ''
}
