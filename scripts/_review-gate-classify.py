"""Classify a PreToolUse payload as COMMIT / PUSH / MERGE / MULTI / AMBIGUOUS / UNREAD / NONE.

Reads the raw payload on stdin and exits 0. Writes, on stdout:
  * by default, one verdict token;
  * with --git-context, the command's repository path chain, or __UNSUPPORTED_GIT_CONTEXT__;
  * with --tag-push, a TAG-PUSH header line and then the tag names, or nothing (see TAG_PUSH).
Exits non-zero ONLY when the payload cannot be parsed at all, which the caller treats as "fall
back to the conservative raw matcher" rather than as "allow".

WHY a parser and not a substring match. The old gate matched two-word substrings against the
whole raw payload. That produced both failure directions at once, and both were measured:

  * False positives. A benign call whose `description` merely mentioned the verb was denied,
    and -- because the old code consumed the marker before comparing -- the denial destroyed
    an expensively-earned review marker. That is why the repository could not document its
    own gate from a shell.
  * False negatives. `git -C <dir> commit`, `git -c k=v commit`, `git -C <dir> push` and
    `gh api .../pulls/N/merge` each perform the guarded action without containing either
    substring. All four were measured passing the gate against matched controls that were
    correctly denied.

The fix is to ask the question the gate actually means: does this command line invoke git
with the guarded verb? That is a shell-parsing question, so it gets a parser. Splitting on
shell operators is what stops prose from matching -- in `echo "the git commit gate"` the
leading word of the only segment is `echo`, so no segment invokes git.

WHY one reading per shell (2026-10-31). The parser used to read every command with one mix of
bash rules, and only the ASCII quotes counted. Each of these classified NONE in both twins while
the shell that ran it pushed (measured against the pwsh Parser and against bash):
`echo "a<U+201D> ; git push ; <U+201C>b"` and `echo "a\\" ; git push ; \\"b"` in PowerShell, which
treats U+2018-U+201E as quotes and `\\` as an ordinary character; `git p''ush`, `git pu\\sh`,
``git pu`sh`` and `git -''C . push`, because a word was never de-quoted before it was compared;
`{ git push; }`, `if x; then git push; fi`, `! git push` and pwsh `& { git push }`, because shell
grammar words were read as the executable; and a bash heredoc whose body held an apostrophe,
which opened a quote that swallowed the push on the next line. So a command is now read as the
shell that runs it reads it: the payload's tool_name picks bash or pwsh, a launcher picks the
reading of the command it carries, and a payload with no known tool_name is read both ways.

One deliberate exception to reading only the invocation: the git-context names (GIT_CONTEXT_ENV) are
matched on the whole command text. That match runs only after the parse found exactly one commit or
push, and can only mark it unsupported, so prose can still never create a verdict -- at worst it
refuses a commit whose message or neighbouring command mentions a name.

UNREAD (2026-11-08): a segment the parse finds no guarded invocation in, but whose words still say
git ... push/commit or gh ... pr ... merge, follows a program the gate does not read (`flock /tmp/l
git push`, `nsenter --wd=x git push`). The gate cannot bind that to a review, so the hooks deny it
without a marker; see unread_segment.
"""

import bisect
import json
import re
import sys

# git's own global options. Those taking a separate argument must consume it, or the verb
# scan would mistake the argument for the subcommand.
GLOBAL_WITH_ARG = {'-c', '-C', '--exec-path', '--git-dir', '--work-tree', '--namespace',
                   '--config-env', '--super-prefix'}
GLOBAL_FLAGS = {'--no-pager', '--paginate', '-p', '--bare', '--no-replace-objects',
                '--literal-pathspecs', '--no-optional-locks', '--glob-pathspecs',
                '--noglob-pathspecs', '--icase-pathspecs', '--html-path', '--man-path',
                '--info-path', '--no-lazy-fetch'}

# Wrappers that may precede the real executable without changing what it does. Their own options
# are skipped too (leading_executable). xargs is not one: it is a launcher (nested_commands).
WRAPPERS = {'env', 'sudo', 'doas', 'command', 'builtin', 'nohup', 'time', 'nice', 'ionice', 'stdbuf',
            'setsid', 'eval', 'exec', 'timeout', 'script', 'chrt', 'taskset', 'unbuffer'}

# Grammar words that may stand where an executable would and run the command after them: bash's
# `{ ... }`, `!`, `if`/`while`/`until` conditions and `then`/`else`/`do` bodies, and pwsh's dot-source
# `. cmd`. Matched as the bare word only, since quoted they are ordinary words. Read in every
# reading, which over-gates where they mean something else: a pwsh `{ git push }` scriptblock that is
# never invoked is gated as a push.
RESERVED = {'{', '}', '!', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '.'}

# Launchers whose syntax explicitly identifies another command line. These are intentionally
# narrow: scanning every argument of npm/make/etc. turns test names and other data into fake
# invocations. Each supported launcher is decoded according to its own command-bearing option.
SHELL_LAUNCHERS = {'bash', 'sh', 'dash', 'zsh', 'ksh', 'fish', 'ash'}
# The launchers whose options after -c were measured (see _shell_payload_index).
BASH_GRAMMAR_SHELLS = {'bash', 'sh'}
POWERSHELL_LAUNCHERS = {'pwsh', 'powershell'}
# GNU xargs's getopt grammar (findutils): short options taking a required argument, attached or the
# next word; short options taking an optional one, attached only; and long options by argument kind
# (0 none, 1 required, 2 optional, given only with '='), matched exactly or by a unique prefix as
# getopt_long does. Measured in Git Bash 2026-11-07: `--replace git commit`, `--repl`, `-i`, `-l`
# and `--eof X` (X ran) take no next word; `--max-a 1` and `-d ,` do.
XARGS_SHORT_WITH_ARG = set('adEILnPs')
XARGS_SHORT_OPTIONAL = set('eil')
XARGS_LONG = {'null': 0, 'arg-file': 1, 'delimiter': 1, 'eof': 2, 'replace': 2, 'max-lines': 2,
              'max-args': 1, 'open-tty': 0, 'interactive': 0, 'no-run-if-empty': 0, 'max-chars': 1,
              'verbose': 0, 'show-limits': 0, 'exit': 0, 'max-procs': 1, 'process-slot-var': 1,
              'version': 0, 'help': 0}
# The characters pwsh.exe accepts before a parameter name: '/' or a dash, where a dash may be doubled
# with the same dash (`--c`, U+2013 twice). Measured 2026-11-07, pwsh 7.6: U+2013, U+2014 and U+2015
# ran -Command, U+2012, U+2212 and U+FF0D did not, nor did `-<U+2013>c`, `---c` or `/-c`.
PWSH_DASHES = '-' + chr(0x2013) + chr(0x2014) + chr(0x2015)
ASCII_LOWER = {c: c + 32 for c in range(65, 91)}
SSH_WITH_ARG = {'-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L',
                '-l', '-m', '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w'}
# The shells whose -c payload is also read with a lone `&` as an operator (N1): dash reads `&>` as `&`
# then `>`, so `dash -c 'echo a &>x git push'` backgrounds echo and runs `>x git push` (measured on
# ubuntu:noble and Git Bash's /usr/bin/dash, 2026-11-08). sh is dash on Debian; busybox ash did not
# run it, so ash over-guards. bash reads `&>` as one redirection and is not here. Only dash is known
# to read it that way, so only dash's two readings fold with _combine's unread rule: sh is bash on
# Git Bash and ash read it as a redirection, where `sh -c 'nsenter --wd=/o &>x git push'` runs git in
# /o, so the reading that finds a plain push must not stand in for the unread one (AMBIGUOUS).
AMP_SPLIT_SHELLS = {'sh', 'dash', 'ash'}

# Words worth stopping at while skipping a wrapper's options: the guarded programs, launchers whose
# arguments nested_commands() decodes, and further wrappers.
WRAPPER_TARGETS = ({'git', 'gh', 'cmd', 'ssh', 'xargs', 'busybox'} | SHELL_LAUNCHERS |
                   POWERSHELL_LAUNCHERS | WRAPPERS)
# Short options that take an argument, for the two wrappers whose options matter here: env's -C and
# sudo's -D (and -R, chroot) change the directory git runs in, and env's -S carries a whole command
# line. A cluster such as -iC is read up to the first of these; the rest is its argument.
# env (GNU `env --help`, plus BSD's -P): u unset, C chdir, S split-string, P altpath.
# sudo (sudo(8)): u user, g group, p prompt, h host, C closefrom, D chdir, r role, t type,
# U other-user (with -l), T command-timeout, R chroot.
WRAPPER_SHORT_WITH_ARG = {'env': 'uCSP', 'sudo': 'ugphCDrtUTR'}
WRAPPER_CHDIR_SHORT = {'env': 'C', 'sudo': 'DR'}
WRAPPER_CHDIR_LONG = {'env': ('--chdir',), 'sudo': ('--chdir', '--chroot')}
# A bare word starting with a digit, skipped after a wrapper's name or one of its options: a duration,
# CPU mask or priority (`timeout 5`, `taskset 0x1`, `chrt -f 10`). ASCII ranges only, so both twins
# match the same words.
INERT_WORD = re.compile(r'^[0-9][0-9A-Za-z.,:+-]*$')
# A word git or gh takes as its subcommand: when one follows the program, unread_verb reads only the
# words after the program, so `git stash push` and `gh pr view merge` are not unread. Matched whole.
SUBCOMMAND_WORD = re.compile(r'[A-Za-z][A-Za-z0-9-]*')

# Environment variables that point git at another repository, work tree, index or object store. Set
# for a commit or push, they make it act on something other than the tree the marker was computed
# from -- the environment spelling of --git-dir/--work-tree, which are already refused. Matched on the
# whole command text after names_git_context_env undoes every shell's quoting and escapes (bash and
# pwsh quotes, the typographic quotes U+2018-U+201E, backslash and backtick, cmd's ^, $'...' escapes
# and pwsh's `u{...}), so export, declare -x, set -a, PowerShell's $env: and Set-Item env: are all
# caught; written as explicit [Aa] classes so both twins match exactly ASCII, whatever their regex
# engines do with case folding.
GIT_CONTEXT_ENV = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
                   'GIT_COMMON_DIR')
GIT_CONTEXT_ENV_RE = re.compile(
    r'(?<![A-Za-z0-9_])(?:%s)(?![A-Za-z0-9_])' % '|'.join(
        ''.join('[%s%s]' % (c.upper(), c.lower()) if c.isalpha() else c for c in name)
        for name in GIT_CONTEXT_ENV))
# Fail-closed companion: a word that starts as a prefix of GIT_ and runs straight into $, a backtick,
# { or NUL may be one of those names assembled in a way the test above cannot undo (GIT_${X}DIR,
# GIT_$( )DIR, a NUL escape mid-name). It only adds denies, and deletes nothing that could hide a plain
# name. A word right after a backtick or a dot is not refused for a following backtick, so the Markdown
# of `git` or `.git` in a message passes; the check cannot tell an opening backtick from a closing one,
# so `true`GIT_`true`DIR is missed (backlogged).
_GIT_STEM = r'[Gg](?:[Ii](?:[Tt](?:_[A-Za-z0-9_]*)?)?)?'
GIT_CONTEXT_STEM_RE = re.compile(
    r'(?<![A-Za-z0-9_])(?:(?<![`.])%s`|%s[${\x00])' % (_GIT_STEM, _GIT_STEM))

# The whitespace pwsh splits words on; bash and cmd split on space and tab only (READINGS 'ws'). One
# shared superset was tried first and was wrong both ways: in the bash reading U+00A0 split
# `git -c a.b=c<U+00A0>x commit` so that x read as the verb, while bash kept one word and committed.
# Never \s, str.split() or str.strip(): Python's \s also matches U+001C-U+001F and .NET's does not,
# which made the twins disagree.
WS = ''.join(chr(c) for c in [0x20, 0x09, 0x0b, 0x0c, 0x85, 0xa0, 0x1680] +
             list(range(0x2000, 0x200b)) + [0x2028, 0x2029, 0x202f, 0x205f, 0x3000])
WS_CLASS = '[' + ''.join('\\' + 'u%04x' % ord(c) for c in WS) + ']'

# PowerShell treats these exactly as ' and " (the pwsh Parser splits `echo "a<U+201D> ; x ; <U+201C>b"`
# into three statements), so the pwsh reading maps them before it reads anything.
PWSH_QUOTES = {chr(0x2018): "'", chr(0x2019): "'", chr(0x201a): "'", chr(0x201b): "'",
               chr(0x201c): '"', chr(0x201d): '"', chr(0x201e): '"'}

# Characters that quote or escape inside a word in some reading. A command-position word is
# compared with all of them deleted (plain()), so `p''ush`, `pu\\sh`, ``pu`sh``, `pu^sh` and
# `<U+201C>push<U+201D>` all read as push. Deleting too much from a command word can only make it
# match a guarded verb it does not spell; it cannot stop a real one matching.
QUOTING = "'\"\\`^\r\n" + ''.join(PWSH_QUOTES)

# How each shell quotes, escapes and separates. cmd.exe has no single quotes and escapes with ^
# outside double quotes only; it is the reading of a `cmd /c` command line.
READINGS = {
    'bash': {'ws': ' \t', 'quotes': "'\"", 'esc': '\\', 'esc_in_dq': True, 'seps': ';&|\n()',
             'dollar_paren': True, 'backtick_subst': True, 'heredoc': True, 'herestring': False},
    'pwsh': {'ws': WS, 'quotes': "'\"", 'esc': '`', 'esc_in_dq': True, 'seps': ';&|\n\r(){}',
             'dollar_paren': True, 'backtick_subst': False, 'heredoc': False, 'herestring': True},
    'cmd': {'ws': ' \t', 'quotes': '"', 'esc': '^', 'esc_in_dq': False, 'seps': '&|\n\r()',
            'dollar_paren': False, 'backtick_subst': False, 'heredoc': False, 'herestring': False},
}
READING_BY_TOOL = {'Bash': 'bash', 'PowerShell': 'pwsh'}

# Budgets. Past any of them the verdict is AMBIGUOUS, a deny that consumes no marker. Each used to
# fail open (measured in review, 2026-11-02): a launcher past the depth cap returned nothing, so
# `xargs` nine times before `git push` was NONE; 2000 nested `$(` raised RecursionError here and
# "call depth overflow" in the ps1 twin, and the hooks' substring fallback missed `git -C . push`;
# and ~640 nested `$(` killed the ps1 hook process with an uncatchable .NET stack overflow, after
# which the wiring's bash fallback read empty stdin and allowed even a literal push. The ps1 twin
# uses the same three numbers, so both twins stop at the same command.
#
# MAX_LAUNCHER_DEPTH: launchers inside launchers (`xargs ssh h bash -c ...`) that are read; the
# cap the scan always had, now refusing rather than returning nothing.
MAX_LAUNCHER_DEPTH = 8
# MAX_SUBSTITUTION_DEPTH: `$(...)`, backtick and heredoc/here-string substitutions open at once.
# Measured 2026-11-02 in the real hook (pwsh -NoProfile -File review-reminders.ps1, pwsh 7.6.9):
# the plain `$(` chain killed the process between 630 and 640 levels; the heredoc chain, which costs
# three ps1 frames a level (scan, heredoc end, substitution), was still denied at 400 and fell to the
# substring fallback by 600 (inferred: pwsh's catchable call-depth limit). 32 levels is at most ~100
# scan frames plus 9 launcher levels, against the ~630 frames the hook survives: about 5x headroom in
# the worst chain and 20x in the plain one.
MAX_SUBSTITUTION_DEPTH = 32
# MAX_NESTED_READINGS: launcher payload texts read per classification, over every reading. Each
# costs one more scan of at most the command's length, and a payload of several words with a quoted
# one is read two ways (payload_texts), so nested launchers multiplied: `xargs` eight times took 7 s
# here over a 10 KB argument and 35 s in the ps1 twin over 4 KB. 64 bounds that to 64 extra scans. It still
# reads a Bash command with a one-text launcher payload in each of 64 segments; with no tool_name and
# a heredoc, which read the command four ways (two shells, bodies skipped and not), 16.
MAX_NESTED_READINGS = 64
# MAX_COMMAND_BYTES and MAX_CONTEXT_PATHS: hard caps, checked before the command is read. Past
# either the verdict is AMBIGUOUS. They exist because the hook has a 600 s timeout, after which it
# fails open, and in review (2026-11-02 to 2026-11-06) every attempt to price each shape's cost failed
# in the ps1 twin: `git -C. -C. ... push` at ~1 MB took 516 s through the hook wiring while inside
# MAX_WORK below, because its cost was quadratic and the hook resolves every -C path once more.
#
# MAX_COMMAND_BYTES: the command's size in UTF-8 bytes, checked first, before any reading. 128 KiB is
# Linux's MAX_ARG_STRLEN, the most one argument (the `bash -c` text) can hold, and Windows refuses a
# command line over ~32 K characters, so the cap refuses only commands those platforms could not run
# anyway; macOS alone loses the larger ones, such as a heredoc commit message over 128 KiB. The two
# limits are partly inferred: the Windows one was measured in review (WinError 206 past ~32 K), the
# Linux one is the kernel constant, not a measurement here.
MAX_COMMAND_BYTES = 131072
# MAX_CONTEXT_PATHS: the leading `cd "<path>" &&` paths plus the git -C paths of one invocation, the
# chain --git-context prints. Collection stops as soon as it passes the cap, and since the hooks deny
# AMBIGUOUS before they resolve any path, it also bounds their per-path resolution loop.
MAX_CONTEXT_PATHS = 64
# MAX_TAG_NAMES: tag names in one tag-only push. Past it --tag-push prints nothing, so the hooks take
# the ordinary push path (marker required). WHY: the hooks run several git commands per name, about
# 0.16 s a tag through the sh hook (loaded Windows 11, 2026-11-06), so the ~21,800 names that fit
# under MAX_COMMAND_BYTES would run past the 600 s timeout, and a timed-out hook fails open. 64
# bounds that loop to about 10 s on that host. Repeated names count; collection stops past the cap.
MAX_TAG_NAMES = 64
# MAX_WORK: a backstop below the caps. Total work per classification, over every reading, both
# passes and both shells: the length of every text read (the command, then each launcher payload),
# counted in UTF-16 code units as the ps1 twin's String.Length counts them, plus SEGMENT_WORK for
# every segment a scan finds. The count budgets above bound how many readings there are, not how
# long each one is, so 64 readings of one payload cost 64 scans: a padded `xargs` chain of 17 KB is
# ~970,000 units. A segment (`a;a;...`, `$(a)`, backticks) costs the ps1 twin ~170-260 us against
# ~13 us a character for that padded chain, so it is charged SEGMENT_WORK units. Measured through
# the hook wiring (pwsh 7.6.9, Windows 11, 2026-11-06), the costliest shape found under the caps and
# this budget, a push five `xargs` deep over `git "-" - - ...` (48 KB, ~1,000,000 units, classified
# twice by the hook), took 49.9 s, and it and similar shapes took 50-65 s on a loaded host; the
# costliest the size cap alone limits, `git - - ... push` at
# 128 KiB with no tool_name, took 22.7 s. Those are this host's numbers, not a bound on others.
MAX_WORK = 1_000_000
SEGMENT_WORK = 16
# MAX_UNREAD_NAMES: git and gh words the unread scan (unread_segment) reads in one segment before it
# finds a verb. Past it the verdict is AMBIGUOUS. 64, like the other count caps; each word read is
# also charged one unit of MAX_WORK.
MAX_UNREAD_NAMES = 64


class OverBudget(Exception):
    """A budget above was exceeded; classify_details turns it, like any other error, into AMBIGUOUS."""


def _budget(ctx):
    """The per-classification counters, shared by every reading of one command (see classify_details)."""
    return ctx.setdefault('budget', {'readings': 0, 'nest': 0, 'work': 0})


def _spend(budget, work):
    """Charge `work` to the classification's MAX_WORK budget."""
    budget['work'] += work
    if budget['work'] > MAX_WORK:
        raise OverBudget('total work')


def _utf16_units(text):
    """len(text) in UTF-16 code units, as the ps1 twin's String.Length counts it (an astral character
    is two). surrogatepass: a lone surrogate, which a JSON escape can spell, is one unit there too."""
    return len(text.encode('utf-16-le', 'surrogatepass')) // 2


def too_large(cmd):
    """True when cmd is over MAX_COMMAND_BYTES as UTF-8. surrogatepass encodes a lone surrogate as
    three bytes, the size of the U+FFFD .NET's UTF8 GetByteCount substitutes for it."""
    return len(cmd.encode('utf-8', 'surrogatepass')) > MAX_COMMAND_BYTES


def _context_paths_checked(paths):
    """paths, or OverBudget once there are more than MAX_CONTEXT_PATHS of them."""
    if len(paths) > MAX_CONTEXT_PATHS:
        raise OverBudget('context paths')
    return paths


def trim(text):
    return text.strip(WS)


def plain(word, keep_backslash=False):
    """`word` with every quoting and escape character deleted, plus a `$` that opens a quote."""
    out = []
    for i, ch in enumerate(word):
        if ch == '$' and i + 1 < len(word) and word[i + 1] in '\'"':
            continue
        if ch in QUOTING and not (keep_backslash and ch == '\\'):
            continue
        out.append(ch)
    return ''.join(out)


def _base(name):
    base = name.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return base[:-4] if base.endswith('.exe') else base


def ascii_lower(text):
    """text with only A-Z lowered: one case rule both twins can share (Python's lower() and .NET's
    ToLowerInvariant() disagree outside ASCII)."""
    return text.translate(ASCII_LOWER)


def names(tok, reading='bash'):
    """The program names a command word can mean: backslash read as a path separator, and as an escape.

    In the pwsh reading trailing whitespace is dropped: pwsh ran git for `& 'git ' commit` and for a
    trailing U+00A0 (measured 2026-11-07), though not for a leading space. Dropping all of WS
    over-gates names pwsh would not run, such as a trailing tab (measured not run).
    """
    found = {plain(tok, keep_backslash=True), plain(tok)}
    if reading == 'pwsh':
        found = {name.rstrip(WS) for name in found}
    return {_base(name) for name in found}

# The one push the gate lets through without a marker. The WHOLE command must be
# `cd "<absolute path>" && git push <remote>` followed only by `refs/tags/<t>` or `tag <t>` words.
# The hook then checks that every named tag is on a commit already in refs/remotes/origin/main.
# It lives here rather than in a helper of its own, like _review-gate-merge.py, so that it adds no
# file which `mb upgrade` could leave out, as once happened to the lib.
#
# WHY a whole-command match on the raw string, not the parsed segments above (the approach
# _review-gate-merge.py documents at its top):
#   * The parser skips VAR= prefixes, wrappers and -c/-C options, and lifts $(...) out. Any of
#     these can change what the push sends while the refspecs look the same.
#   * A chained command can re-point a tag after this hook has checked it.
#
# WHY [ \t] and not \s: a newline separates commands, so `git push origin<newline>refs/tags/v1`
# is a branch push.
#
# The name classes leave out ':' (src:dst, delete), '+' (force), '*' (pattern), '$' and quotes.
#
# WHY exactly one cd, and an absolute one: the hook checks the repository it resolves from the
# cd, while the shell pushes from wherever its own cd lands. These are the ways found so far for
# the two to part, each with rows in tests/test-review-gate-tag-push.sh:
#   * No cd: the hook would use its own working directory, which can be another repository.
#   * Relative paths, or a second cd: these resolve against two different directories.
#   * A leading '-', '+' or '~': bash and pwsh read these as the previous directory, location
#     history or HOME, which the .ps1 hook would read as a literal folder (a draft that allowed
#     them let `cd "<A>" && cd "-"` through while the shell pushed from another repo, 2026-10-30).
#
# The cd path is otherwise an ALLOWLIST: printable ASCII except its own quote, '$', '`', '\',
# '[', ']', '*' and '?'.
#   * '$' and '`': bash and pwsh expand inside double quotes, so `cd "$(git tag -f v1 <sha>)"`
#     would re-point the tag after the check.
#   * '\': escapes a quote in bash, so the shell could end the string where this pattern does
#     not. Use C:/... paths.
#   * '[ ] * ?': pwsh's cd expands wildcards, while the hook resolves the path literally.
#   * Anything non-ASCII: pwsh also ends a string at the typographic quotes U+2018-U+201E
#     (measured 2026-10-26).
#
# Each hook adds platform checks the shape cannot express. The .ps1 hook refuses a path that is
# not fully qualified (a Windows /...) and enters the resolved root with -LiteralPath. The .sh
# hook refuses a C:/... path off Windows, where it is relative. The .sh hook needs neither of the
# others: it resolves the path with the same bash cd that runs a Bash-tool push.
# The .ps1 twin uses this exact pattern text, which tests/test-review-gate-tag-push.sh compares.
TAG_PUSH = re.compile(r'''cd[ \t]+(?:"(?:[A-Za-z]:)?/[\x20\x21\x23\x25-\x29\x2B-\x3E\x40-\x5A\x5E\x5F\x61-\x7E]*"|'(?:[A-Za-z]:)?/[\x20-\x23\x25\x26\x28\x29\x2B-\x3E\x40-\x5A\x5E\x5F\x61-\x7E]*')[ \t]*&&[ \t]*git[ \t]+push[ \t]+[A-Za-z0-9_][A-Za-z0-9._-]*((?:[ \t]+(?:refs/tags/|tag[ \t]+)[A-Za-z0-9_][A-Za-z0-9._/-]*)+)''')
TAG_PUSH_NAME = re.compile(r'''(?:refs/tags/|tag[ \t]+)([A-Za-z0-9_][A-Za-z0-9._/-]*)''')


def opaque(word, reading):
    """True when a word spells characters through an escape plain() cannot undo.

    bash's ANSI-C `$'\\x70ush'` and pwsh's ``"pu`u{73}h"`` both mean push. Rather than decode them
    (and keep two decoders in step), a command-position word holding one is AMBIGUOUS, a deny.
    """
    if reading == 'pwsh':
        return '`u{' in word
    return re.search(r"\$'[^']*\\", word) is not None


ASSIGNMENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')
# gh's REST merge path in any ASCII case: whether GitHub accepts `/PULLS/` is unmeasured, and must not
# be measured (it would merge), so the gate fails closed. Spelled out rather than IGNORECASE, which
# also matches non-ASCII case forms and so would differ from the ps1 twin.
PULLS_MERGE = re.compile(r'/[pP][uU][lL][lL][sS]/\d+/[mM][eE][rR][gG][eE]')
CD_PREFIX = re.compile('^cd' + WS_CLASS + '+(?:"([^"]+)"|\'([^\']+)\')' + WS_CLASS + '*&&' + WS_CLASS + '*')


def _extract_backtick(text, start):
    """Return (body, closing-index) for a backtick substitution."""
    escaped = False
    i = start
    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
        elif ch == '\\':
            escaped = True
        elif ch == '`':
            return text[start:i], i
        i += 1
    return text[start:], len(text) - 1


def _substitutions(text, reading, ctx):
    """Commands a heredoc or here-string body runs: only its $(...) and backticks; quotes are literal there."""
    out = []
    esc = READINGS[reading]['esc']
    index = [None]
    i = 0
    while i < len(text):
        if text[i] == esc:
            i += 2
            continue
        if text.startswith('$(', i):
            segs, nested, end = _scan(text, reading, i + 2, True, ctx, index)
            out.extend(segs + nested)
            i = end + 1
            continue
        if READINGS[reading]['backtick_subst'] and text[i] == '`':
            body, end = _extract_backtick(text, i + 1)
            out.extend(segments(body, reading, ctx))
            i = end + 1
            continue
        i += 1
    return out


def _line_index(cmd):
    """Where each line of cmd starts, so heredoc and here-string ends are found without rescanning.

    Returns (exact, untabbed, closers): line text (less one trailing CR) to sorted start offsets, the
    same with leading tabs removed (for <<-), and the starts of lines opening with '@ and with "@.
    Scanning forward for each opener instead made a command full of unclosed ones quadratic (measured
    in review: 2000 unclosed heredocs took 33 s in the ps1 twin).
    """
    exact, untabbed, closers = {}, {}, {"'": [], '"': []}
    start = 0
    while True:
        newline = cmd.find('\n', start)
        end = len(cmd) if newline < 0 else newline
        line = cmd[start:end]
        key = line[:-1] if line.endswith('\r') else line
        exact.setdefault(key, []).append(start)
        untabbed.setdefault(key.lstrip('\t'), []).append(start)
        if line.startswith("'@") or line.startswith('"@'):
            closers[line[0]].append(start)
        if newline < 0:
            return exact, untabbed, closers
        start = newline + 1


def _first_at(starts, i):
    """The first offset in sorted `starts` that is at least i, or None."""
    k = bisect.bisect_left(starts or [], i)
    return starts[k] if starts and k < len(starts) else None


def _heredoc_word(cmd, i):
    """Parse the operator at cmd[i:] == '<<'. Return (delimiter, quoted, strip_tabs, end) or None."""
    j = i + 2
    strip_tabs = j < len(cmd) and cmd[j] == '-'
    if strip_tabs:
        j += 1
    while j < len(cmd) and cmd[j] in ' \t':
        j += 1
    k = j
    quote = None
    while k < len(cmd):
        ch = cmd[k]
        if quote:
            if ch == quote:
                quote = None
        elif ch in '\'"':
            quote = ch
        elif ch == '\\':
            k += 1
        elif ch in ' \t;&|<>()\n':
            break
        k += 1
    word = cmd[j:k]
    if not word:
        return None
    return _bash_unquote(word), any(c in word for c in '\'"\\'), strip_tabs, k


def _bash_unquote(word, dollar_quotes=False):
    """A heredoc delimiter word after bash's quote removal (plain() would delete what bash keeps).

    With dollar_quotes, `$'...'` and `$"..."` open quotes too, as bash reads a `-c` payload word:
    `bash -c $'git push'` and `bash -c $"git push"` both pushed (measured, Git Bash 2026-11-07). The
    caller passes only words opaque() accepts, so a `$'...'` here holds no backslash escape.
    """
    out = []
    quote = None
    i = 0
    while i < len(word):
        ch = word[i]
        if dollar_quotes and quote is None and ch == '$' and word[i + 1:i + 2] in ("'", '"'):
            quote = word[i + 1]
            i += 2
            continue
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                out.append(ch)
        elif quote == '"' and ch == '"':
            quote = None
        elif ch == '\\' and i + 1 < len(word) and (quote is None or word[i + 1] in '$`"\\'):
            i += 1
            out.append(word[i])
        elif quote is None and ch in '\'"':
            quote = ch
        else:
            out.append(ch)
        i += 1
    return ''.join(out)


def _heredoc_bodies(cmd, i, pending, reading, nested, ctx, index):
    """Skip the bodies of the heredocs pending at a newline; return the index after them.

    None when a delimiter line is missing: the operator is then not treated as a heredoc and the
    following lines are read as commands (bash would run them as data).
    """
    exact, untabbed, _ = index
    for delimiter, quoted, strip_tabs in pending:
        found = _first_at((untabbed if strip_tabs else exact).get(delimiter), i)
        if found is None:
            return None
        if not quoted:
            nested.extend(_substitutions(cmd[i:found], reading, ctx))
        newline = cmd.find('\n', found)
        i = len(cmd) if newline < 0 else newline + 1
    return i


def _herestring(cmd, i, index):
    """For pwsh `@'`/`@"` at cmd[i], return (body_start, body_end, after) or None if not a here-string."""
    quote = cmd[i + 1]
    j = i + 2
    while j < len(cmd) and cmd[j] in ' \t':
        j += 1
    if j < len(cmd) and cmd[j] == '\r':
        j += 1
    if j >= len(cmd) or cmd[j] != '\n':
        return None
    found = _first_at(index[2][quote], j + 1)
    return None if found is None else (j + 1, found, found + 2)


def _scan(cmd, reading, i, in_paren, ctx, index):
    """Split cmd[i:] on real shell operators; return (segments, nested, end).

    With in_paren the scan reads the body of a $(...) and stops at its closing parenthesis, whose
    index is `end`. `nested` holds the segments of every substitution, which run as commands.
    ctx['skip'] says whether heredoc and here-string bodies are skipped as data; skipping one sets
    ctx['skipped']. `index` is a one-item list holding cmd's _line_index(), built on first use and
    shared with the $(...) scans of the same text.

    Every substitution re-enters this function, so the open scans are counted against
    MAX_SUBSTITUTION_DEPTH; the count is put back at each return.

    Line continuations are read here in every pass; `#` and pwsh `<# #>` comments only in the pass
    that skips data, which then counts as having skipped some (see _read).
    """
    budget = _budget(ctx)
    budget['nest'] += 1
    if budget['nest'] > MAX_SUBSTITUTION_DEPTH + 1:
        raise OverBudget('substitution nesting')
    r = READINGS[reading]
    result = []
    nested = []
    buf = []
    quote = None
    escaped = False
    depth = 0
    heredocs = []
    # True where a word starts: at the start, after whitespace and after an operator. Only there does
    # `#` or pwsh `<#` open a comment; `a#b`, `$(true)#x` and pwsh `push<#x#>y` are words (measured).
    boundary = True
    # The unquoted `<` or `>` just added, if any, in the bash and cmd readings, and `>` in pwsh: the
    # `&` after it (`>&2`, `2>&1`) and bash's `|` after `>` (`>|`) belong to the redirection, not
    # operators (pwsh ran `git 2>&1 push`, measured). In pwsh only a `>` that starts a redirection
    # counts, at a word's start or after a stream digit or `*` there: after a touching `>`, pwsh read
    # `&` as an operator (`echo a>& git push` pushed, measured).
    redirect = ''
    # Whether the previous character started a word.
    started = False

    def flush():
        segment = ''.join(buf).strip(r['ws'])
        if segment:
            _spend(budget, SEGMENT_WORK)
            result.append(segment)
        buf.clear()

    while i < len(cmd):
        ch = cmd[i]
        at_boundary, boundary = boundary, False
        after_redirect, redirect = redirect, ''
        prev_started, started = started, at_boundary
        if escaped:
            buf.append(ch)
            escaped = False
            i += 1
            continue
        if quote == "'":
            buf.append(ch)
            if ch == "'":
                quote = None
            i += 1
            continue
        if quote == "$'":
            # bash ANSI-C quoting: \ escapes, so \' does not close it.
            buf.append(ch)
            if ch == '\\':
                escaped = True
            elif ch == "'":
                quote = None
            i += 1
            continue
        if ch == r['esc'] and (quote is None or r['esc_in_dq']):
            # A line continuation. bash deletes `\` + newline outside single quotes, and Git Bash
            # `\` + CRLF too (measured: it ran the push); pwsh reads a backtick + LF or CRLF outside
            # quotes as whitespace. Inside pwsh double quotes the backtick keeps the newline.
            newline = 2 if cmd.startswith('\n', i + 1) else 3 if cmd.startswith('\r\n', i + 1) else 0
            if newline and reading == 'bash':
                boundary = at_boundary
                i += newline
                continue
            if newline and reading == 'pwsh' and quote is None:
                buf.append(' ')
                boundary = True
                i += newline
                continue
            buf.append(ch)
            escaped = True
            i += 1
            continue
        if quote == '"' and ch == '"':
            buf.append(ch)
            quote = None
            i += 1
            continue
        # Command substitution executes even inside double quotes, but is inert in single
        # quotes. Scan its body as a separate command without splitting the outer argument.
        if r['dollar_paren'] and cmd.startswith('$(', i):
            segs, sub_nested, end = _scan(cmd, reading, i + 2, True, ctx, index)
            nested.extend(segs + sub_nested)
            buf.append(' ')
            i = end + 1
            continue
        if r['backtick_subst'] and ch == '`':
            body, end = _extract_backtick(cmd, i + 1)
            nested.extend(segments(body, reading, ctx))
            buf.append(' ')
            i = end + 1
            continue
        if quote == '"':
            buf.append(ch)
            i += 1
            continue
        # Comments, read as bash and pwsh read them: from a `#` that starts a word to the end of the
        # line, where quotes mean nothing, and pwsh's `<# ... #>` over any lines. Only in the pass that
        # skips data, so the pass that skips nothing still reads the text: the shells do not open a
        # comment everywhere this does (`echo ${x:- #}; git push` pushed in bash, measured).
        if ctx['skip'] and at_boundary and reading in ('bash', 'pwsh'):
            if ch == '#':
                ctx['skipped'] = True
                i = _line_end(cmd, i, reading)
                continue
            if reading == 'pwsh' and cmd.startswith('<#', i):
                ctx['skipped'] = True
                end = cmd.find('#>', i + 2)
                buf.append(' ')
                boundary = True
                i = len(cmd) if end < 0 else end + 2
                continue
        if ctx['skip'] and r['herestring'] and ch == '@' and i + 1 < len(cmd) and cmd[i + 1] in '\'"':
            if index[0] is None:
                index[0] = _line_index(cmd)
            found = _herestring(cmd, i, index[0])
            if found:
                ctx['skipped'] = True
                start, end, after = found
                if cmd[i + 1] == '"':
                    nested.extend(_substitutions(cmd[start:end], reading, ctx))
                buf.append(' ')
                i = after
                continue
        # `<<<` is a here-string, one operator: read past all three characters, or the `<<` at i + 1
        # opened a heredoc bash does not (found in review round 1).
        if r['heredoc'] and cmd.startswith('<<<', i):
            buf.append('<<<')
            i += 3
            continue
        # A heredoc is read only outside parentheses: `$((1<<x))` and `(( x <<= 1 ))` shift.
        if ctx['skip'] and r['heredoc'] and depth == 0 and cmd.startswith('<<', i):
            found = _heredoc_word(cmd, i)
            if found:
                delimiter, quoted, strip_tabs, end = found
                heredocs.append((delimiter, quoted, strip_tabs))
                buf.append(cmd[i:end])
                i = end
                continue
        if (ch == '&' and after_redirect) or (ch == '|' and after_redirect == '>' and reading == 'bash'):
            buf.append(ch)
            i += 1
            continue
        # bash's `&>` and `&>>` are one redirection operator wherever they stand, never the `&`
        # operator then `>`: `git &>x push`, `git&>x push` and `git -C . &>x push` ran push (measured,
        # Git Bash 5.3, 2026-11-07). tokens() drops the redirection with its target. ctx['amp'] is the
        # dash reading of an sh/dash/ash payload (N1, see AMP_SPLIT_SHELLS): there the `&` is an
        # operator and the `>` starts a redirection.
        if reading == 'bash' and ch == '&' and cmd.startswith('>', i + 1) and not ctx.get('amp'):
            buf.append(ch)
            i += 1
            continue
        if cmd.startswith('&&', i) or cmd.startswith('||', i):
            flush()
            boundary = True
            i += 2
            continue
        if ch == ')' and in_paren and depth == 0:
            flush()
            budget['nest'] -= 1
            return result, nested, i
        if ch == '(':
            depth += 1
        elif ch == ')' and depth > 0:
            depth -= 1
        if ch in r['seps']:
            flush()
            boundary = True
            if ch == '\n' and heredocs:
                if index[0] is None:
                    index[0] = _line_index(cmd)
                after = _heredoc_bodies(cmd, i + 1, heredocs, reading, nested, ctx, index[0])
                heredocs = []
                if after is not None:
                    ctx['skipped'] = True
                i = after if after is not None else i + 1
                continue
            i += 1
            continue
        if ch in r['quotes']:
            quote = ch
        elif reading == 'bash' and cmd.startswith("$'", i):
            quote = "$'"
            buf.append("$'")
            i += 2
            continue
        buf.append(ch)
        boundary = ch in r['ws']
        if (ch in '<>' and reading in ('bash', 'cmd')) or (ch == '>' and reading == 'pwsh' and (
                at_boundary or (prev_started and cmd[i - 1] in '123456*'))):
            redirect = ch
        i += 1
    flush()
    budget['nest'] -= 1
    return result, nested, len(cmd) - 1


def _line_end(cmd, i, reading):
    """Where the comment at cmd[i] ends: the next newline, which still separates; pwsh also ends a
    line at CR."""
    ends = [cmd.find('\n', i)] + ([cmd.find('\r', i)] if reading == 'pwsh' else [])
    ends = [end for end in ends if end >= 0]
    return min(ends) if ends else len(cmd)


def segments(cmd, reading='bash', ctx=None):
    """Split on real shell operators and include executable command substitutions."""
    result, nested, _ = _scan(cmd, reading, 0, False, ctx or {'skip': True, 'skipped': False}, [None])
    return result + nested


def _redirection_end(text, i, reading):
    """The index after the redirection operator that starts at text[i], a `<` or `>`: in bash `<`,
    `<<`, `<<-`, `<<<`, `<>`, `<&`, `>`, `>>`, `>|` and `>&` (tokens() passes `&>` and `&>>` at
    their `>`); in cmd `<`, `<&`, `>`, `>>` and `>&`."""
    after = text[i + 1:i + 2]
    if reading == 'cmd':
        return i + 2 if after == '&' or (text[i] == '>' and after == '>') else i + 1
    if text[i] == '>':
        return i + 2 if after in ('>', '|', '&') else i + 1
    if after == '<':
        return i + 3 if text[i + 2:i + 3] in ('<', '-') else i + 2
    return i + 2 if after in ('>', '&') else i + 1


def tokens(segment, reading='bash'):
    """Split a segment into shell words; adjacent quoted and unquoted pieces stay one word.

    In the bash and cmd readings a redirection is not a word: its operator ends a word wherever it
    stands (`git push>log`), and it is dropped with its target and a touching fd number
    (`2>/dev/null`), before the command name too.

    The pwsh reading differs in two ways, both measured (pwsh 7.6, 2026-11-07). A word that starts
    with a quote ends at its closing quote (`git "push"x` gave git `push` and `x`), where a doubled
    quote inside is an escaped one (`"pu""sh"` gave `pu"sh`). And a redirection is one only where it
    starts a word after the command name: `>`, `>>`, `N>` and `N>>` for a stream N of 1-6, `*>`, `*>>`
    and the merges `N>&1`, with the target touching or the next word (`git 2>x push` and `git > x
    push` gave git `push`). A touching one stays in its word (`push>log`, `a2>x`, `7>x`, `12>x` were
    arguments) and a leading one is a parse error (`2>/dev/null git push` ran nothing).
    """
    r = READINGS[reading]
    redirects = reading in ('bash', 'cmd')
    pwsh = reading == 'pwsh'
    words = []
    buf = []
    quote = None
    escaped = False
    target = False
    quoted_start = False

    def end_word():
        nonlocal target, quoted_start
        quoted_start = False
        if buf:
            if target:
                target = False
            else:
                words.append(''.join(buf))
            buf.clear()

    i = 0
    while i < len(segment):
        ch = segment[i]
        i += 1
        if escaped:
            buf.append(ch)
            escaped = False
            continue
        if quote:
            buf.append(ch)
            if ch == quote and pwsh and segment[i:i + 1] == quote:
                buf.append(quote)
                i += 1
            elif ch == quote:
                quote = None
                if pwsh and quoted_start:
                    end_word()
            elif ch == r['esc'] and quote == '"' and r['esc_in_dq']:
                escaped = True
            continue
        if ch == r['esc']:
            buf.append(ch)
            escaped = True
            continue
        if ch in r['quotes']:
            quoted_start = not buf
            quote = ch
            buf.append(ch)
            continue
        if ch in r['ws']:
            end_word()
            continue
        if pwsh and ch == '>' and words and (not buf or (len(buf) == 1 and buf[0] in '123456*')):
            buf.clear()
            if segment[i:i + 1] == '&':
                # A merge (`2>&1`) has no target: the stream digit ends it, and the rest of the word
                # is a word of its own (`2>&1x` gave git `x`, measured).
                i += 2 if segment[i + 1:i + 2] in tuple('0123456789') else 1
            else:
                i += 1 if segment[i:i + 1] == '>' else 0
                target = True
            continue
        if reading == 'bash' and ch == '&' and segment[i:i + 1] == '>':
            # `&>` and `&>>` take no fd number: `git 2&>y push` gave git `2` and `push` (measured).
            end_word()
            i = _redirection_end(segment, i, reading)
            target = True
            continue
        if redirects and ch in '<>':
            if buf and not target and all(c in '0123456789' for c in buf):
                buf.clear()
            end_word()
            i = _redirection_end(segment, i - 1, reading)
            target = True
            continue
        buf.append(ch)
    end_word()
    return words


def unquote_argument(value):
    value = trim(value)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


# One word that is opaque in every reading, since the payload is read in the launcher's reading, not the
# outer shell's.
OPAQUE_PAYLOAD = "$'\\x`u{0}'"


def word_payload_texts(word, reading):
    """The texts one payload word is read as: without its outer quotes, and in the bash reading also
    after bash's own quote removal, when that differs.

    WHY both: `bash -c "a"'; git push'` is one word of two quoted pieces, which bash hands over as
    `a; git push` (measured: it pushed), while the outer quotes alone are not a pair. The outer-quote
    text is kept because it is what this read before, so folding the two (_combine) finds no fewer
    invocations than that did. pwsh passed the same pieces as two arguments (measured: bash ran `a`),
    which tokens() splits there, so the pwsh reading keeps only the outer-quote text. An opaque word
    is not unquoted (as above); it reads as OPAQUE_PAYLOAD, a deny, because re-reading it as written
    missed what the outer shell decodes first (`bash -c X=1$'\\ngit push'` pushed and read NONE).
    """
    if opaque(word, reading):
        return [OPAQUE_PAYLOAD]
    texts = [unquote_argument(word)]
    if reading == 'bash' and not opaque(word, reading):
        removed = _bash_unquote(trim(word), dollar_quotes=True)
        if removed != texts[0]:
            texts.append(removed)
    return texts


def payload_texts(words, reading):
    """The texts a launcher's payload is read as: one word loses its outer quotes; several words
    are read twice, joined unquoted and joined as written, and the caller folds both with _combine.

    WHY unquoted: ssh and pwsh -Command join the argv the outer shell already unquoted, so
    `"git push" "origin"` runs `git push origin`. WHY as written too: xargs runs its argv with no
    shell, so `git -c "x=y z" push` keeps `x=y z` one word, and the unquoted join alone made it NONE.
    WHY never unquote the joined text: its first and last quotes belong to two different words, so
    `"git" push -m "x"` became one quoted word, `git" push -m "x`. A word plain() cannot undo
    (opaque) is kept as written, so it still reads as AMBIGUOUS.

    WHY one text when the two are equal (no word quoted): reading it twice doubled the work at
    every launcher level for nothing; see MAX_NESTED_READINGS.
    """
    if len(words) == 1:
        return word_payload_texts(words[0], reading)
    unquoted, written = ' '.join(w if opaque(w, reading) else plain(w) for w in words), ' '.join(words)
    return [unquoted] if unquoted == written else [unquoted, written]


def leading_cd_paths(cmd):
    """Return the quoted leading cd chain, in shell application order."""
    paths = []
    rest = cmd
    while True:
        match = CD_PREFIX.match(rest)
        if not match:
            return paths
        paths.append(match.group(1) if match.group(1) is not None else match.group(2))
        _context_paths_checked(paths)
        rest = rest[match.end():]


def is_git(tok, reading='bash'):
    # PRE-EXISTING HOLE, closed here. These two functions compared a case-SENSITIVE basename and
    # kept the .exe suffix, while names() above folds case and strips it. So the uppercase and
    # .exe spellings of the executable classified NONE while the lowercase one classified the
    # guarded verb -- measured with matched controls on the working tree.
    #
    # It is genuinely pre-existing rather than introduced by this parser: review-reminders.sh's
    # raw-substring fallback matches lowercase literals too, so BOTH matchers had it, before and
    # after the rewrite. Windows and macOS default filesystems are case-insensitive, so an
    # uppercase spelling really does invoke the same executable there -- and this repo develops on
    # Windows. This is the class the branch fix/block-tier-case-sensitivity is named for.
    return 'git' in names(tok, reading)


def is_gh(tok, reading='bash'):
    return 'gh' in names(tok, reading)


def _long_prefix(name, full):
    """True when `name` is a long option getopt would read as `full`: any prefix of it, from three
    characters. Over-matching an ambiguous prefix only refuses a command env rejects."""
    return len(name) >= 3 and full.startswith(name)


def _wrapper_option(wrapper, tok):
    """Read one option word of `wrapper`: return (chdir, split, takes_next).

    chdir: the option moves the directory git runs in. split: for env -S/--split-string, the value
    attached to the option ('' when the value is the next word), else None. takes_next: the option's
    argument is the next word. The option is recognised on its plain() form, as git's are, so `-''C`
    is -C; an attached -S value keeps its backslashes, which env reads (`\\_` is a space).
    """
    bare = plain(tok)
    if bare.startswith('--'):
        name, eq, value = bare.partition('=')
        for long_opt in WRAPPER_CHDIR_LONG.get(wrapper, ()):
            if _long_prefix(name, long_opt):
                return True, None, not eq
        if wrapper == 'env':
            if _long_prefix(name, '--split-string'):
                return False, plain(tok, keep_backslash=True).partition('=')[2] if eq else '', False
            if _long_prefix(name, '--unset'):
                return False, None, not eq
        return False, None, False
    letters = WRAPPER_SHORT_WITH_ARG.get(wrapper, '')
    body = bare[1:]
    for k, ch in enumerate(body):
        if ch in letters:
            attached = body[k + 1:]
            if wrapper == 'env' and ch == 'S':
                kept = plain(tok, keep_backslash=True)
                return False, kept[kept.index('S') + 1:], False
            return ch in WRAPPER_CHDIR_SHORT.get(wrapper, ''), None, attached == ''
    return False, None, False


def _split_value(attached, words, i):
    """env -S's value and the index after it: the attached value, or else the next word without its
    outer quotes. tokens() keeps a quoted value one word, so nothing needs rejoining."""
    if attached == '':
        return (unquote_argument(words[i + 1]), i + 2) if i + 1 < len(words) else ('', i + 1)
    return attached, i + 1


def leading_executable(words, reading='bash', depth=0):
    """Drop assignments, wrappers and grammar words, return (exe_word, remaining_words, chdir).

    A wrapper's options are skipped too. Taking the first option as the executable made `nice -n 10
    git commit`, `sudo -u root git commit`, `time -p git commit` and `env -u X git commit` classify
    NONE, so those commits ran with no review at all. Most wrappers' options are not modelled, so a
    word right after one of their options may be its argument. It is skipped unless it is a
    WRAPPER_TARGETS name -- and skipped even then when the next word is one too, as in `doas -u git
    git commit` (a user named git), so the argument is never taken for the program. A bare word that
    starts with a digit (INERT_WORD) is skipped after a wrapper's name or options: `timeout 5`.
    `chdir` is True when a wrapper option moved the directory git runs in. env -S's value is read the
    way env reads it: split into words that env then takes as its own options, assignments and
    command, ahead of the words that follow (`\\_` in it is a space).
    """
    i = 0
    chdir = False
    wrapper = None
    after_option = False
    while i < len(words):
        t = words[i]
        # Every skip below decides from plain(t), which cannot see into an opaque word ($'X=1\ngit push',
        # env -S$'git\x20push'), so skipping one hides what it runs. Stopping here makes it the executable,
        # which reads AMBIGUOUS. A word that starts as an assignment is one, whatever its value holds.
        if opaque(t, reading) and not ASSIGNMENT.match(t):
            break
        bare = plain(t)
        if wrapper is not None and bare.startswith('-'):
            if bare == '--':
                wrapper = None
                after_option = False
                i += 1
                continue
            opt_chdir, split, takes_next = _wrapper_option(wrapper, t)
            if split is not None:
                if depth >= MAX_LAUNCHER_DEPTH:
                    raise OverBudget('env -S depth')
                value, j = _split_value(split, words, i)
                inner = tokens(value.replace('\\_', ' '), 'bash')
                exe, rest, sub_chdir = leading_executable(['env'] + inner + words[j:], reading, depth + 1)
                return exe, rest, chdir or sub_chdir
            chdir = chdir or opt_chdir
            after_option = not takes_next
            i += 2 if takes_next else 1
            continue
        # A quoted assignment (`"A=1" git commit`) is skipped too: bash runs A=1 as a command there,
        # so this over-guards. names(), not a bare strip, for a wrapper: `/usr/bin/env git push` named
        # its wrapper by path, so this twin read `/usr/bin/env` as the executable and allowed the push.
        if ASSIGNMENT.match(bare) or t in RESERVED:
            after_option = False
            i += 1
            continue
        # bash's `coproc [NAME] command` runs the command; a NAME comes only before a compound command
        # (`coproc N { git push; }`, measured: it pushed). pwsh has no coproc (measured: nothing ran).
        if reading == 'bash' and t == 'coproc':
            i += 2 if i + 2 < len(words) and words[i + 2] in RESERVED else 1
            continue
        found = names(t, reading)
        hit = sorted(found & WRAPPERS)
        if hit:
            wrapper = hit[0]
            after_option = False
            i += 1
            continue
        if wrapper is not None and INERT_WORD.match(t):
            after_option = False
            i += 1
            continue
        if wrapper is not None and after_option and (
                not found & WRAPPER_TARGETS or
                (i + 1 < len(words) and names(words[i + 1], reading) & WRAPPER_TARGETS)):
            after_option = False
            i += 1
            continue
        break
    if i >= len(words):
        return None, [], chdir
    return words[i], words[i + 1:], chdir


# Lexical forms bash resolves before a name is set: a backslash-newline line continuation, $'...'
# escapes (\xHH, \NNN octal, \uHHHH, \UHHHHHHHH), and empty expansions ($(), $'', $"", ${}) between
# two halves of a name, and pwsh's `u{HEX}. Decoded or dropped before the name match; only escapes
# that yield ASCII are decoded, the rest are left as written. Every quote and escape character of
# any reading (the typographic quotes, backslash, backtick, cmd's ^) is then deleted.
CONTINUATION_RE = re.compile(r'\\\r?\n')
ESCAPE_RE = re.compile(r'\\x([0-9A-Fa-f]{1,2})|\\u([0-9A-Fa-f]{1,4})|\\U([0-9A-Fa-f]{1,8})|'
                       r'\\([0-7]{1,3})|`u\{([0-9A-Fa-f]{1,6})\}')
EMPTY_EXPANSION_RE = re.compile(r'''\$\(\)|\$''|\$""|\$\{\}''')
# A `$` straight before a quote is bash's $'...' or $"..." opener: with the quotes deleted it would stay in
# the middle of the name (GIT_$'D'IR is GIT_DIR, not GIT_$DIR).
DOLLAR_QUOTE_RE = re.compile(r'''\$(?=['"])''')


def _decode_escape(m):
    for group, radix in ((1, 16), (2, 16), (3, 16), (4, 8), (5, 16)):
        if m.group(group) is not None:
            n = int(m.group(group), radix)
            return chr(n) if n < 128 else m.group(0)
    return m.group(0)


def names_git_context_env(cmd):
    """True when the command text names a GIT_CONTEXT_ENV variable (see its comment)."""
    text = ESCAPE_RE.sub(_decode_escape, CONTINUATION_RE.sub('', cmd))
    # Before anything below removes the $ or backtick it looks for; quotes go so GI''T_$X still reads.
    if GIT_CONTEXT_STEM_RE.search(re.sub('["\'\\\\^‘-„]', '', text)):
        return True
    text = EMPTY_EXPANSION_RE.sub('', text)
    text = DOLLAR_QUOTE_RE.sub('', text)
    return GIT_CONTEXT_ENV_RE.search(re.sub('["\'\\\\`^\u2018-\u201e]', '', text)) is not None


def unread_segment(words, reading, budget=None):
    """The verb ('PUSH', 'COMMIT' or 'MERGE') when a segment with no guarded invocation still says it.

    That is: a word whose names() is git followed later by a word that is push or commit in ASCII
    lower case, or a gh word followed by pr and then merge. Such a segment runs a program the gate
    does not read (`flock /tmp/l git push`, `watch -n1 git push`); the gate cannot bind it to a review,
    so it is UNREAD, a deny. It over-guards text that says the words unquoted (`echo git push`, `git
    log --grep git push`), and misses a spelling names() does not undo (`$G push`). The caller runs it
    only in the pass that skips heredoc and here-string bodies and comments, so their text is never
    read here. One pass over the words; every git or gh word is charged to MAX_WORK, and more than
    MAX_UNREAD_NAMES of them before a verb raises OverBudget (AMBIGUOUS).
    """
    git_seen = gh_seen = pr_seen = False
    count = 0
    for w in words:
        # Every verb test needs a git or gh word first, and a verb word holds an ASCII p, c or m (push,
        # commit, pr, merge; ascii_lower folds nothing else). A word whose names() hold git or gh holds
        # a g or G (no other character lowers to g, in either twin's lower-casing; checked over every
        # code point). The shortcuts keep the cost per other word to one search: without them a 128
        # KiB command of plain words took the ps1 twin ~3 s a reading, against ~0.3 s on main.
        if (git_seen or gh_seen) and any(c in w for c in 'pPcCmM'):
            low = ascii_lower(plain(w))
            if git_seen and low in ('push', 'commit'):
                return 'PUSH' if low == 'push' else 'COMMIT'
            if pr_seen and low == 'merge':
                return 'MERGE'
            if gh_seen and low == 'pr':
                pr_seen = True
        if 'g' not in w and 'G' not in w:
            continue
        found = names(w, reading)
        is_git_word, is_gh_word = 'git' in found, 'gh' in found
        if is_git_word or is_gh_word:
            count += 1
            if budget is not None:
                _spend(budget, 1)
            if count > MAX_UNREAD_NAMES:
                raise OverBudget('unread names')
            git_seen = git_seen or is_git_word
            gh_seen = gh_seen or is_gh_word
    return None


def unread_verb(exe, rest, direct, reading, budget):
    """The unread test for a segment with no guarded invocation, or None.

    When the segment's own program is git or gh and a subcommand word follows, only the words after
    the program are read, so a subcommand's arguments are not mistaken for a verb after git (`git
    stash push`, `git grep push`), while `git submodule foreach git push` still reads. The exemption
    does not cover gh pr unless a plain word follows pr: `gh pr -R o/r merge 1` takes the full scan
    below (its `gh pr -R o/r view merge` twin is then an accepted false deny). Otherwise the
    raw words are read, then the words leading_executable decoded from env -S, which are a quoted
    word in `direct` (`env -S \"flock l git push\"`); when the two are the same words it is one scan.
    """
    program = names(exe, reading) & {'git', 'gh'}
    if program and rest and SUBCOMMAND_WORD.fullmatch(plain(rest[0])):
        # `gh pr -R o/r merge 1`: pr passes as a subcommand but a flag stands between it and the real
        # one, so the exemption holds only when a plain word follows pr. `gh pr -R o/r view merge` is
        # then UNREAD too, an accepted false deny (view cannot be told from merge past a flag).
        if not ('gh' in program and ascii_lower(plain(rest[0])) == 'pr' and
                not (len(rest) > 1 and SUBCOMMAND_WORD.fullmatch(plain(rest[1])))):
            return unread_segment(rest, reading, budget)
    verb = unread_segment(direct, reading, budget)
    decoded = [exe] + rest
    if verb is None and direct[-len(decoded):] != decoded:
        verb = unread_segment(decoded, reading, budget)
    return verb


def _git_verb_index(rest):
    """Index of the first non-option word after git's global options, or None."""
    i = 0
    while i < len(rest):
        t = plain(rest[i])
        if t in GLOBAL_WITH_ARG:
            i += 2
            continue
        if t.startswith('--') and '=' in t and t.split('=', 1)[0] in GLOBAL_WITH_ARG:
            i += 1
            continue
        if t in GLOBAL_FLAGS:
            i += 1
            continue
        if t.startswith('-'):
            # -C<dir> / -cfoo attached forms, and any other leading option: skip it.
            i += 1
            continue
        return i
    return None


def git_verb(rest):
    """First non-option token after git's global options, or None."""
    i = _git_verb_index(rest)
    return None if i is None else plain(rest[i])


def git_context_paths(rest):
    """Return git's -C path chain, or None for unsupported explicit work-tree context."""
    paths = []
    i = 0
    while i < len(rest):
        raw = rest[i]
        token = raw.strip('"\'')
        word = plain(raw)
        # Options are recognised on the plain word, as _git_verb_index() reads them, but -C's path
        # is still taken from the stripped word. A -C, --git-dir or --work-tree spelled with quotes
        # inside it would make the two disagree, so it is refused rather than bound to the wrong tree.
        if word != token and (word.startswith('-C') or word.split('=', 1)[0] in ('--git-dir', '--work-tree')):
            return None
        if word == '-C':
            if i + 1 >= len(rest):
                return None
            paths.append(rest[i + 1].strip('"\''))
            _context_paths_checked(paths)
            i += 2
            continue
        if word.startswith('-C') and len(word) > 2:
            paths.append(token[2:])
            _context_paths_checked(paths)
            i += 1
            continue
        option = word.split('=', 1)[0]
        if option in ('--git-dir', '--work-tree'):
            return None
        if word in GLOBAL_WITH_ARG:
            i += 2
            continue
        if word.startswith('--') and '=' in word and option in GLOBAL_WITH_ARG:
            i += 1
            continue
        if word in GLOBAL_FLAGS or word.startswith('-'):
            i += 1
            continue
        break
    return paths


def _verdict_from(tok, rest, reading='bash'):
    """Verdict if `tok` is git/gh invoked with a guarded verb, else None."""
    if opaque(tok, reading):
        return 'AMBIGUOUS'
    if is_git(tok, reading):
        i = _git_verb_index(rest)
        if i is not None and any(opaque(t, reading) for t in rest[:i + 1]):
            return 'AMBIGUOUS'
        # Compared in ASCII lower case, in both twins: git refuses an upper-case verb (measured), so
        # this only over-gates, and one rule keeps the twins agreeing.
        verb = git_verb(rest)
        verb = None if verb is None else ascii_lower(verb)
        if verb == 'commit':
            return 'COMMIT'
        if verb == 'push':
            return 'PUSH'
    elif is_gh(tok, reading):
        if any(opaque(t, reading) for t in rest[:2]):
            return 'AMBIGUOUS'
        # Matched with a literal space, not \s, whose sets differ between Python and .NET; a quoted
        # word holding whitespace (`"pr merge"`) keeps it, as gh receives it.
        flat = ' '.join(plain(t) for t in rest)
        if re.match(r'^pr merge( |$)', flat):
            return 'MERGE'
        if re.match(r'^api( |$)', flat) and PULLS_MERGE.search(flat):
            return 'MERGE'
    return None


def _shell_payload_index(bare, i):
    """Index in bare of a shell launcher's command string, given its -c cluster at bare[i].

    bash reads the options after -c too, and the string is the first word after them: `bash -c -e
    'cmd'`, `-c -o pipefail 'cmd'` and `-c -x -- 'cmd'` all ran cmd (measured, Git Bash 2026-11-07).
    Each o or O in a cluster (`-o`, `+O`) takes the next word, as do --rcfile and --init-file; `--`
    or `-` ends the options.
    """
    pending = bare[i][1:].count('o') + bare[i][1:].count('O')
    j = i + 1
    while j < len(bare):
        word = bare[j]
        if pending:
            pending -= 1
        elif word in ('--', '-'):
            return j + 1
        elif word.startswith('--'):
            pending = 1 if word in ('--rcfile', '--init-file') else 0
        elif word[:1] in ('-', '+') and len(word) > 1:
            pending = word[1:].count('o') + word[1:].count('O')
        else:
            return j
        j += 1
    return j


def _pwsh_command_option(option):
    """True when pwsh.exe reads the word as -Command: a lead from PWSH_DASHES (a dash may be doubled
    with itself) or '/', then a prefix of `command` in any ASCII case. Measured 2026-11-07: -c through
    -command, --c through --command and /c through /command ran; -commandw..., -con..., -cw and
    -Commandx did not."""
    if not option or option[0] not in PWSH_DASHES + '/':
        return False
    name = option[1:]
    if option[0] != '/' and name[:1] == option[0]:
        name = name[1:]
    return name != '' and 'command'.startswith(ascii_lower(name))


def _cmd_command_switch_end(option):
    """The index after the `/c` or `/k` in a cmd.exe switch word, or None.

    cmd.exe runs what follows the switch letter, attached or not, and after other switches in the
    same word: `/cgit push`, `/c"git push"`, `/d/cgit push`, `/s/c"git push"` and `/kgit push` all
    pushed (measured 2026-11-07), while `/dc` and `-c` ran nothing.
    """
    if not option.startswith('/'):
        return None
    for k in range(len(option) - 1):
        if option[k] == '/' and option[k + 1].lower() in ('c', 'k'):
            return k + 2
    return None


def _xargs_takes_next(option):
    """True when the xargs option word takes the next word as its argument (see XARGS_LONG)."""
    if option.startswith('--'):
        if '=' in option:
            return False
        name = option[2:]
        if name in XARGS_LONG:
            return XARGS_LONG[name] == 1
        kinds = [kind for long_name, kind in XARGS_LONG.items() if long_name.startswith(name)]
        return len(kinds) == 1 and kinds[0] == 1
    for k, letter in enumerate(option[1:]):
        if letter in XARGS_SHORT_OPTIONAL:
            return False
        if letter in XARGS_SHORT_WITH_ARG:
            return k == len(option) - 2
    return False


def nested_commands(exe, rest, reading='bash'):
    """Return (command, reading) for each text the launcher's payload is read as: alternative
    readings of ONE payload, which the caller folds with _combine (see payload_texts)."""
    base = names(exe, reading)
    bare = [plain(t) for t in rest]
    if base & SHELL_LAUNCHERS:
        for i, option in enumerate(bare[:-1]):
            if option.startswith('-') and not option.startswith('--') and 'c' in option[1:]:
                # bash's option grammar after -c (_shell_payload_index) was measured on bash and sh
                # only. Every other shell's payload is read both as the next word, as main read it,
                # and after that grammar, and the caller folds the two.
                j = _shell_payload_index(bare, i)
                at = sorted({i + 1, j}) if base & (SHELL_LAUNCHERS - BASH_GRAMMAR_SHELLS) else [j]
                texts = [t for k in at if k < len(rest) for t in word_payload_texts(rest[k], reading)]
                # N1: an sh, dash or ash payload holding `&>` is also read as dash reads it.
                amp = [t for t in texts if '&>' in t] if base & AMP_SPLIT_SHELLS else []
                label = 'dash' if 'dash' in base else 'ampsh'
                return [(t, 'bash') for t in texts] + [(t, label) for t in amp]
        return []
    if base & POWERSHELL_LAUNCHERS:
        # Every word pwsh could read as -Command is a candidate, and each one's payload is read: the
        # value of another parameter can spell one (`pwsh -wd /c -c "git push"` ran the push, measured
        # 2026-11-07), and which parameters take a value is not enumerated here. The caller folds them.
        return [(t, 'pwsh') for i, option in enumerate(bare) if _pwsh_command_option(option) and i + 1 < len(rest)
                for t in payload_texts(rest[i + 1:], reading)]
    if 'cmd' in base:
        for i, option in enumerate(bare):
            at = _cmd_command_switch_end(option)
            if at is None:
                continue
            # The command starts right after the switch letter: from the word as written when the
            # switch is spelled the same there, else from its plain form.
            first = rest[i][at:] if rest[i][:at] == option[:at] else option[at:]
            words = ([first] if first else []) + rest[i + 1:]
            if words:
                return [(t, 'cmd') for t in payload_texts(words, reading)]
        return []
    if 'ssh' in base:
        i = 0
        while i < len(rest):
            option = bare[i]
            if option == '--':
                i += 1
                break
            if not option.startswith('-'):
                break
            i += 2 if option in SSH_WITH_ARG and i + 1 < len(rest) else 1
        # First positional is the host; only what follows is the remote command.
        if i + 1 < len(rest):
            return [(t, 'bash') for t in payload_texts(rest[i + 1:], reading)]
        return []
    if 'xargs' in base:
        i = 0
        while i < len(rest):
            option = bare[i]
            if option == '--':
                i += 1
                break
            if not option.startswith('-'):
                break
            i += 2 if _xargs_takes_next(option) and i + 1 < len(rest) else 1
        # xargs runs its words itself, with no shell, so they keep the outer reading's quoting.
        if i < len(rest):
            return [(t, reading) for t in payload_texts(rest[i:], reading)]
        return []
    if 'busybox' in base and rest and names(rest[0]) & SHELL_LAUNCHERS:
        # The words are the argv of the shell busybox names, re-read whole, so they keep their
        # quoting: `sh -c "git push"` must stay -c and one word.
        return [(' '.join(rest), 'bash')]
    return []


def _guarded_invocations(cmd, reading, inherited_paths=None, depth=0, ctx=None):
    """Collect every guarded invocation so one marker cannot authorize a command chain.

    Each is (verdict, paths, unsupported), and an unread segment (see unread_segment) is ('UNREAD',
    [], False, verb): it counts like an invocation, so beside any other the verdict is MULTI. The
    readings 'dash' and 'ampsh' are the bash reading with a lone `&` as an operator (N1,
    AMP_SPLIT_SHELLS); 'ampsh' (sh, ash) folds without _combine's unread rule.
    """
    if ctx is None:
        ctx = {'skip': True, 'skipped': False}
    amp = reading in ('dash', 'ampsh')
    if amp:
        reading = 'bash'
    budget = _budget(ctx)
    if depth > MAX_LAUNCHER_DEPTH:
        raise OverBudget('launcher depth')
    if depth:
        budget['readings'] += 1
        if budget['readings'] > MAX_NESTED_READINGS:
            raise OverBudget('nested readings')
    # The text's length is charged before it is read; its segments are charged as the scan finds them.
    _spend(budget, _utf16_units(cmd))
    if reading == 'pwsh':
        cmd = ''.join(PWSH_QUOTES.get(ch, ch) for ch in cmd)
    prefix_paths = _context_paths_checked(list(inherited_paths or []) + leading_cd_paths(cmd))
    matches = []
    # Set before each scan of this text, which reads it whole before any launcher payload is read.
    ctx['amp'] = amp
    for seg in segments(cmd, reading, ctx):
        direct_tokens = tokens(seg, reading)
        exe, rest, chdir = leading_executable(direct_tokens, reading)
        if exe is None:
            continue
        v = _verdict_from(exe, rest, reading)
        if v:
            context = git_context_paths(rest) if is_git(exe, reading) else []
            matches.append((v, _context_paths_checked(prefix_paths + (context or [])), context is None or chdir))
            continue
        found = None
        for nested, nested_reading in nested_commands(exe, rest, reading):
            got = _guarded_invocations(nested, nested_reading, prefix_paths, depth + 1, ctx)
            found = got if found is None else _combine(found, got, unread_fold=nested_reading != 'ampsh')
        if found:
            # A wrapper option that moved the directory moves the payload's invocations too.
            matches.extend(m if m[0] == 'UNREAD' else (m[0], m[1], m[2] or chdir) for m in found)
        elif ctx['skip']:
            # Only in the pass that skips heredoc and here-string bodies and comments (rule a).
            verb = unread_verb(exe, rest, direct_tokens, reading, budget)
            if verb:
                matches.append(('UNREAD', [], False, verb))
    return matches


def _combine(first, second, unread_fold=True):
    """The guarded invocations of two readings of one command, never fewer than either finds.

    One reading finding a guarded invocation the other does not is still that invocation: the gate
    asks for its marker. Two readings finding different single invocations cannot both be checked
    with one marker and are AMBIGUOUS, not MULTI, whose "run them separately" would be wrong advice.

    An unread segment alone in one reading, beside one real invocation of its own verb alone in the
    other, is that invocation: one reading read the program the other could not (`dash -c 'echo a &>x
    git push'`). Beside nothing it stays UNREAD; beside anything else it folds as above, so one
    reading's PUSH never hides another reading's unread commit.

    unread_fold=False drops that rule, for _read's two passes: the unread test runs only in the
    skipping pass, so a lone UNREAD there beside a lone PUSH in the pass that skips nothing means the
    PUSH came from heredoc or comment text, and taking it bound an unread push to the marker
    (`nsenter --wd=/o git push <<EOF` with the same push in the body; Decision 4 rule b, ruling 2026-11-08). It is
    AMBIGUOUS.
    """
    for a, b in ((first, second), (second, first)):
        if unread_fold and len(a) == 1 and a[0][0] == 'UNREAD' and len(b) == 1 and b[0][0] == a[0][3]:
            return b
    if len(first) > 1 or len(second) > 1:
        return first + second
    if first and second and first[0] != second[0]:
        return [('AMBIGUOUS', [], False)]
    return first or second


def _read(cmd, reading, budget):
    """Guarded invocations of cmd in one reading: with heredoc and here-string bodies skipped, and
    without, combined. `budget` is the classification's counters, shared by both passes.

    Skipping a body is right only where the shell opens one, and the gate opened them where bash and
    pwsh do not: after `#`, inside `${...}` or `$[...]`, at `<<<`, at a `<#`-commented `@'`, and at a
    delimiter it read differently. In review each of those hid a push that the old scan, which skips
    nothing, caught. Rather than chase the shells' lexers, the command is also read with nothing
    skipped, so the result can never miss what that reading finds. The skipping reading still finds
    the push after a real heredoc whose apostrophe the other reads as an open quote. A `#` or `<# #>`
    comment is skipped the same way, by the skipping pass only, so `echo hi # it's` before a push is
    read both as the shell reads it and as written.
    """
    skipping = {'skip': True, 'skipped': False, 'budget': budget}
    found = _guarded_invocations(cmd, reading, ctx=skipping)
    if not skipping['skipped']:
        return found
    unskipped = _guarded_invocations(cmd, reading, ctx={'skip': False, 'skipped': False, 'budget': budget})
    return _combine(found, unskipped, unread_fold=False)


def classify_details(cmd, reading=None):
    if too_large(cmd):
        return 'AMBIGUOUS', [], False
    budget = {'readings': 0, 'nest': 0, 'work': 0}
    try:
        # With no tool_name to say which shell runs it, the command is read as bash AND as pwsh.
        matches = _read(cmd, reading, budget) if reading else _combine(_read(cmd, 'bash', budget),
                                                                        _read(cmd, 'pwsh', budget))
    except Exception:
        # A refusal is a verdict, never an exception (OverBudget, RecursionError, a bug): an exception
        # made this script exit 1, and the hooks' substring fallback then allowed `git -C . push`.
        return 'AMBIGUOUS', [], False
    if len(matches) > 1:
        return 'MULTI', [], False
    if matches:
        verdict, paths, unsupported = matches[0][:3]
        if verdict in ('COMMIT', 'PUSH') and names_git_context_env(cmd):
            return verdict, [], True
        return verdict, paths, unsupported
    return 'NONE', [], False


def classify(cmd, reading=None):
    return classify_details(cmd, reading)[0]


def payload_reading(data):
    """The reading the payload's tool runs its command with, or None when the tool is unknown."""
    tool = data.get('tool_name')
    if not isinstance(tool, str):
        tool = data.get('toolName')
    return READING_BY_TOOL.get(tool) if isinstance(tool, str) else None


def tag_push_names(cmd):
    """Tag names if `cmd` is exactly the tag-only push shape (TAG_PUSH) with at most MAX_TAG_NAMES
    of them, else []."""
    if too_large(cmd):
        return []
    match = TAG_PUSH.fullmatch(cmd)
    if not match:
        return []
    names = []
    for name in TAG_PUSH_NAME.finditer(match.group(1)):
        names.append(name.group(1))
        if len(names) > MAX_TAG_NAMES:
            return []
    return names


def main():
    # Bytes, decoded as UTF-8 here. Text-mode stdin is cp1252 on Windows (measured; see
    # dangerous-commands.sh), so raw UTF-8 from Claude Code turned U+201D into three other characters
    # and the pwsh reading never saw the quote: `echo "a<U+201D> ; git push ; <U+201C>b"` stayed NONE.
    # errors='replace', as the ps1 hook's UTF8Encoding reads it: a strict decode exited 1 on one
    # invalid byte, and the .sh hook's substring fallback then allowed `git -C . push ... # <0xFF>`.
    raw = sys.stdin.buffer.read().decode('utf-8', 'replace')
    if not raw.strip():
        sys.exit(1)
    try:
        data = json.loads(raw)
    except Exception:
        sys.exit(1)
    if not isinstance(data, dict):
        sys.exit(1)
    ti = data.get('tool_input')
    if not isinstance(ti, dict):
        # A harness spelling this camelCase produced a silent ALLOW on every tier,
        # including BLOCK-tier recursive deletion. Read both spellings.
        ti = data.get('toolInput')
    if not isinstance(ti, dict):
        sys.exit(1)
    cmd = ti.get('command')
    if not isinstance(cmd, str) or not cmd.strip():
        # A payload with no command is not a commit. Distinguish this from an unparseable
        # payload: it is a definite NONE, not an unknown.
        sys.stdout.write('NONE')
        return
    if '--tag-push' in sys.argv:
        # WHY a header line: a classifier from before --tag-push ignores the flag and prints its
        # verdict, PUSH, which the hook would otherwise read as a tag name. The hook takes the tag
        # route only when the first line is exactly this header.
        names = tag_push_names(cmd)
        if names:
            sys.stdout.write('\n'.join(['TAG-PUSH'] + names))
        return
    verdict, context_paths, unsupported = classify_details(cmd, payload_reading(data))
    if '--git-context' in sys.argv:
        if unsupported:
            sys.stdout.write('__UNSUPPORTED_GIT_CONTEXT__')
        else:
            # As UTF-8 bytes, the encoding they arrived in; cp1252 text-mode stdout cannot write
            # every path, and would re-encode the rest.
            sys.stdout.flush()
            sys.stdout.buffer.write('\n'.join(context_paths).encode('utf-8', 'surrogatepass'))
    else:
        sys.stdout.write(verdict)


if __name__ == '__main__':
    main()
