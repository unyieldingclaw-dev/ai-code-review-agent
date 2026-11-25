"""Decide whether a payload the classifier already labelled MERGE may be put to the user.

Called by review-reminders.sh only after the classifier returned MERGE. Prints exactly:

    ASK            or    DENY
    <reason>             <reason>
    <audit line>         (nothing)

and exits 0. The hook treats anything other than a first line of exactly ASK -- a crash, a
missing file, no python3 -- as deny, so every failure here fails closed. The specific cause of
a precondition deny goes to stderr only; see GENERIC_DENY for why.

Spec: docs/superpowers/specs/2026-10-20-merge-gate-user-approval-design.md (section 5). The
PowerShell twin is _review-gate-merge.ps1; the two must agree on every fixture in
tests/test-merge-gate.sh.

WHY a whole-command match on the raw string instead of reusing the classifier's segments: the
classifier answers "does this invoke a guarded verb", so it splits on ; & | and newlines,
lifts $(...) and backticks into nested segments, skips VAR= prefixes and wrapper words, and
accepts any path ending in gh. Any of those would let `<canonical merge>; <anything>` pass as
canonical while the prompt describes only the merge.

WHY the canonical regex has no \\z: Python before 3.14 rejects \\z as a bad escape (measured on
3.11.9), and re.fullmatch already anchors both ends without accepting a trailing newline, which
$ would.
"""
import json
import os
import re
import string
import sys

MODES = ('default', 'acceptEdits', 'auto')

# The only description the prompt may show. G0 (2026-10-20) measured that the app's prompt
# displays the agent-written description beside the command, so a free-form one could label a
# merge of #71 as "Merge PR #77 as you asked".
DESCRIPTION = 'Merge pull request (verify the details in the hook reason)'

# WHY generic: naming the settings file that holds a merge-capable allow rule would point the
# agent straight at the silent route this check exists to deny.
GENERIC_DENY = ("Merge gate precondition failed. Ask the user to check this checkout's "
                "Claude settings.")

REPO_SHAPE = re.compile(r'[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}', re.ASCII)

# WHY GH_CONFIG_DIR: it picks the gh config whose hosts decide where an unprefixed `-R owner/repo`
# resolves (measured 2026-10-21, gh 2.102.0: a config listing only ghe.invalid sent
# `gh pr view 1 -R cli/cli` there). GH_TOKEN and GH_ENTERPRISE_TOKEN change who merges, not what
# is merged, and are out of scope (spec section 5.1).
GH_ENV = ('GH_HOST', 'GH_REPO', 'GH_CONFIG_DIR')

# WHY spelled out instead of \s, \b and IGNORECASE: those differ between Python and .NET, so the
# twins classified some rules differently (measured 2026-10-21: Python's \s also holds \x1c-\x1f,
# and case folding differs for the Kelvin sign and the long s). This class is Python's \s set
# exactly; the .ps1 twin uses the same string, and both match ASCII-lowercased text case-exactly.
WS = r'[\t\n\x0b\x0c\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
# The same set as characters, for strip_ws. WHY not a regex strip: `\A WS+ | WS+ \Z` is retried at
# every position of an inner whitespace run, so it is quadratic in rule length; MAX_RULE_LENGTH
# still allows 4,096 characters, and the number of rules is not capped (measured 2026-10-23: 33 ms
# per 4,092-character rule, so about 33 s for 1,000; str.strip, under 1 ms for all 1,000).
WS_CHARS = ''.join(map(chr, [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85,
                             0xa0, 0x1680, *range(0x2000, 0x200b), 0x2028, 0x2029, 0x202f,
                             0x205f, 0x3000]))
END = r'(?![A-Za-z0-9_])'
ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)

# WHY these caps: everything the settings check costs grows with input the agent can write. A
# regex glob over a many-star rule took 23 s at 10 stars (measured 2026-10-21), and a hook that
# outruns its timeout gives no decision, which fails open. So the glob below is a greedy matcher,
# at worst rule length times probe length; GLOB_BUDGET bounds its total steps over one whole
# check, and running out counts as merge-capable; a rule longer than MAX_RULE_LENGTH is treated as
# merge-capable unread; and more than MAX_REPOS allowlisted repos denies, since each repo
# multiplies the probes. The file size itself is not capped: what is left grows linearly with it.
MAX_REPOS = 10
MAX_RULE_LENGTH = 4096
GLOB_BUDGET = 200000

# Interpreters whose wildcard one-liner rules can run anything, including a merge.
INTERPRETERS = re.compile(
    r'(?:python3?|py|node|pwsh|powershell|bash|sh|cmd)(?:\.exe)?(?:' + WS + r'.*)?'
    + WS + r'(?:-c|-e|--eval|-command|-encodedcommand|/c)' + END)


def deny(reason, cause=None):
    if cause:
        print('merge gate: ' + cause, file=sys.stderr)
    sys.stdout.write('DENY\n' + reason + '\n')
    sys.exit(0)


def load_json(path):
    """Strict JSON only. json already refuses comments and trailing commas; NaN and Infinity are
    refused here because the .ps1 twin's strict parser refuses them too."""
    def no_constant(name):
        raise ValueError('non-standard JSON constant ' + name)
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f, parse_constant=no_constant)


def strip_ws(text):
    return text.strip(WS_CHARS)


def probe_commands(repos):
    """Merge commands no allow rule may match: the canonical form with either method, the REST
    route, and the global -R spelling (the last one the classifier does not see as a merge)."""
    zero = '0' * 40
    probes = ['gh pr merge 1 --squash']
    for r in repos:
        probes += ['gh pr merge 1 -R %s --squash --match-head-commit %s' % (r, zero),
                   'gh pr merge 1 -R %s --merge --match-head-commit %s' % (r, zero),
                   'gh api -X PUT repos/%s/pulls/1/merge' % r,
                   'gh -R %s pr merge 1 --squash' % r]
    return probes


def glob_matches(body, command, budget):
    """Claude Code's rule wildcard: * matches any run of characters, and a trailing :* is the
    legacy spelling of ' *'. Case-exact: merge_capable folds both sides first for a PowerShell rule.

    Greedy with one backtrack point, so O(len(body) * len(command)) at worst. budget is a
    one-item list of steps left, shared by the settings check and main's matched-command pass
    (see GLOB_BUDGET)."""
    if body.endswith(':*'):
        body = body[:-2] + ' *'
    i = j = 0
    star, mark = -1, 0
    while j < len(command):
        budget[0] -= 1
        if budget[0] < 0:
            return True
        if i < len(body) and body[i] == '*':
            star, mark = i, j
            i += 1
        elif i < len(body) and body[i] == command[j]:
            i += 1
            j += 1
        elif star >= 0:
            i = star + 1
            mark += 1
            j = mark
        else:
            return False
    while i < len(body) and body[i] == '*':
        i += 1
    return i == len(body)


def merge_capable(rule, probes=(), budget=None):
    """True when an allow rule could carry a merge past the prompt.

    WHY shapes and probes both: a probe catches a rule that matches one of the fixed merge
    commands however the rule itself is written (`gh pr m*`, `g*`), and a shape catches what no
    fixed probe can, such as an exact `gh pr merge <N> ...` rule or any `gh api` rule. Neither
    catches a rule with a wildcard ahead of a PR number or SHA the probes do not use, such as
    `gh pr m* 77*` or `*pr merge 77*`, so main calls this again with the matched command as the
    only probe (spec section 5.5)."""
    if budget is None:
        budget = [GLOB_BUDGET]
    if len(rule) > MAX_RULE_LENGTH:
        return True
    m = re.fullmatch(r'(Bash|PowerShell)(?:\((.*)\))?', strip_ws(rule), re.DOTALL)
    if not m:
        return False
    body = m.group(2)
    if body is None:
        return True  # a bare tool name allows every command
    body = strip_ws(body)
    if m.group(1) == 'PowerShell':
        # WHY both sides: Claude Code matches PowerShell rules case-insensitively (its permissions
        # docs), and the probes and the matched command hold `-R` and the allowlisted repo's own
        # case. ASCII only, as in the interpreter check below.
        body = body.translate(ASCII_LOWER)
        probes = [p.translate(ASCII_LOWER) for p in probes]
    if body in ('*', ':*'):
        return True
    if re.fullmatch(r'gh(?:' + WS + r'*\*|:\*)?', body):
        return True
    if re.match(r'gh' + WS + r'+(?:api' + END + r'|-)', body):
        return True
    if (re.fullmatch(r'gh' + WS + r'+pr(?:' + WS + r'*\*|:\*)', body)
            or re.match(r'gh' + WS + r'+pr' + WS + r'+merge' + END, body)):
        return True
    if any(glob_matches(body, p, budget) for p in probes):
        return True
    return bool('*' in body and INTERPRETERS.match(body.translate(ASCII_LOWER)))


def settings_files(project):
    config = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.join(os.path.expanduser('~'), '.claude')
    return [
        os.path.join(config, 'settings.json'),
        os.path.join(project, '.claude', 'settings.json'),
        os.path.join(project, '.claude', 'settings.local.json'),
    ]


def check_settings(project, repos, budget):
    """Deny on any merge-capable allow rule; return the others as (path, rule) for main."""
    probes = probe_commands(repos)
    kept = []
    for path in settings_files(project):
        if not os.path.exists(path):
            continue
        try:
            data = load_json(path)
        except Exception:
            deny(GENERIC_DENY, 'unreadable or malformed settings: ' + path)
        if not isinstance(data, dict):
            deny(GENERIC_DENY, 'settings is not a JSON object: ' + path)
        # Wrong-typed blocks deny: this check cannot vouch for a shape it does not understand.
        hooks = data.get('hooks')
        if hooks is not None:
            if not isinstance(hooks, dict):
                deny(GENERIC_DENY, 'hooks is not an object: ' + path)
            if hooks.get('PermissionRequest') not in (None, []):
                deny(GENERIC_DENY, 'PermissionRequest hook configured: ' + path)
        perms = data.get('permissions')
        allow = perms.get('allow') if isinstance(perms, dict) else None
        if allow is not None and not isinstance(allow, list):
            deny(GENERIC_DENY, 'permissions.allow is not a list: ' + path)
        for rule in allow or []:
            if rule is None:
                continue
            if not isinstance(rule, str) or merge_capable(rule, probes, budget):
                deny(GENERIC_DENY, 'merge-capable allow rule in: ' + path)
            kept.append((path, rule))
    return kept


def allowed_repos(project):
    path = os.path.join(project, '.claude', 'merge-gate.json')
    try:
        config = load_json(path)
    except Exception:
        deny('Merge gate is not configured: .claude/merge-gate.json is missing or malformed, '
             'so no repository is allowed. Merge in the GitHub UI instead.')
    # Outside the try, so a config without "repos" gets the same message as the .ps1 twin.
    repos = config.get('repos') if isinstance(config, dict) else None
    if not isinstance(repos, list) or not 1 <= len(repos) <= MAX_REPOS or not all(
            isinstance(r, str) and REPO_SHAPE.fullmatch(r) for r in repos):
        deny('Merge gate is not configured: .claude/merge-gate.json must list "repos" as 1 to '
             '%d owner/repo strings. Merge in the GitHub UI instead.' % MAX_REPOS)
    return repos


def main():
    payload = json.loads(sys.stdin.read())
    if not isinstance(payload, dict):
        deny(GENERIC_DENY, 'payload is not a JSON object')
    # Presence, not truthiness: a subagent's payload carries agent_id whatever its value.
    if 'agent_id' in payload:
        deny('Subagents never merge pull requests. Ask the user, in the main conversation.')
    mode = payload.get('permission_mode')
    if not isinstance(mode, str) or mode not in MODES:
        deny('Merges are only put to the user in default, acceptEdits or auto mode; this '
             'session cannot show a prompt for it. Merge in the GitHub UI instead.')
    if any(name in os.environ for name in GH_ENV):
        deny(GENERIC_DENY, 'GH_HOST, GH_REPO or GH_CONFIG_DIR is set in the hook environment')

    # The allowlist is read first, because the settings check probes each allow rule with it.
    project = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    repos = allowed_repos(project)
    budget = [GLOB_BUDGET]
    rules = check_settings(project, repos, budget)

    tool_input = payload.get('tool_input')
    if not isinstance(tool_input, dict):
        deny(GENERIC_DENY, 'payload has no tool_input object')
    command = tool_input.get('command')
    repo_alt = '|'.join(re.escape(r) for r in repos)
    canonical = ('gh pr merge (?P<n>[1-9][0-9]{0,8}) -R (?P<repo>' + repo_alt + ') '
                 '(?P<method>--squash|--merge) --match-head-commit (?P<sha>[0-9a-f]{40})')
    m = re.fullmatch(canonical, command, re.ASCII) if isinstance(command, str) else None
    if not m:
        deny('This agent merges a pull request only in exactly this form, with nothing before '
             'or after it: gh pr merge <N> -R ' + repos[0] + ' --squash --match-head-commit '
             '<full 40-hex head SHA> (or --merge in place of --squash). Use the PR number and '
             'head SHA the user asked for.')
    # WHY again, with this command: only a canonical command is ever asked, so a rule that
    # matches it is the only one that matters, and the fixed probes miss a rule that names this
    # PR's number or SHA (`gh pr m* 77*`) or ends in a character they do not (`gh p*f`).
    for path, rule in rules:
        if merge_capable(rule, [command], budget):
            deny(GENERIC_DENY, 'allow rule matches this merge command in: ' + path)
    if 'description' in tool_input and tool_input['description'] != DESCRIPTION:
        deny('Set the tool description to exactly "' + DESCRIPTION + '", or omit it. The '
             'prompt shows it, so it must not describe the merge in the agent\'s own words.')

    method = 'squash' if m.group('method') == '--squash' else 'merge commit'
    sys.stdout.write(
        'ASK\n'
        'Merge PR #{n} in {repo} by {method}, exactly at head {sha}. Approve only if YOU asked '
        'to merge this PR just now. This approval covers this one command.\n'
        '{mode}\t{repo}\t{n}\t{sha}\n'.format(n=m.group('n'), repo=m.group('repo'),
                                            method=method, sha=m.group('sha'), mode=mode))


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # any failure in the check is a deny, never no-decision
        deny(GENERIC_DENY, 'internal error: ' + type(exc).__name__)
