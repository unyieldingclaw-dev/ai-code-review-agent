#!/usr/bin/env sh
# PreToolUse hook — 3-tier dangerous command guardrails for Claude Code.
# Reads the Bash tool input JSON from stdin and enforces BLOCK / CONFIRM / WARN tier
# matching against the extracted tool_input.command. Fails open: unexpected errors
# exit 0.
#
# WHY extract tool_input.command via python3 instead of matching raw stdin: raw-stdin
# matching false-positived on a trigger phrase appearing ANYWHERE in the JSON payload --
# e.g. a Bash tool call's own "description" field merely mentioning "rm -rf" in prose,
# never actually running it -- incorrectly BLOCKing/CONFIRMing a harmless action. This
# is not the same risk the original raw-stdin approach was written to avoid: that
# concern was specifically about a naive `grep -o '"command":"[^"]*"'` extraction
# breaking on a JSON-escaped quote inside the command and silently truncating the match.
# python3's json.loads is a real parser, not a fragile regex -- it handles escaped quotes
# correctly, so it closes the false-positive gap without reintroducing the
# truncation risk. Matches dangerous-commands.ps1's existing ConvertFrom-Json approach
# and this repo's established precedent (check-contract.sh, review-reminders.sh's
# resolve_cd_root()).
#
# WHY the extraction reads and writes BINARY, not text: on Windows this repo's python3 runs
# with sys.stdin/sys.stdout at cp1252 and errors='surrogateescape' (measured; PYTHONUTF8 and
# PYTHONIOENCODING are both unset repo-wide). Text-mode I/O then corrupts or crashes on any
# non-ASCII command -- an accented name, a curly quote, an em dash, CJK -- and a crash is not
# harmless here: it exits nonzero and drops the hook into the raw-stdin fallback below, which
# is exactly the false-positive mode this extraction exists to prevent. Verified live, the sh
# hook DENIED a CJK payload with "command is 120057 characters" (the byte length of the whole
# JSON file, not the command) while the .ps1 twin allowed it -- opposite verdicts on ordinary
# input. Reading via sys.stdin.buffer and writing via sys.stdout.buffer removes every
# dependence on locale and on those env vars.
#
# WHY BOTH sides had to change, and why fixing only stdout is WORSE than the original: the two
# payload shapes fail in opposite directions, so a one-sided fix just moves the bug.
#   - json.dumps default (ensure_ascii): non-ASCII arrives as \uXXXX, decodes to real characters,
#     and text-mode print() cannot encode them to cp1252 -> UnicodeEncodeError, zero bytes, exit 1.
#   - raw UTF-8 on the wire: text-mode stdin mis-decodes it as cp1252, and surrogateescape turns
#     the undecodable bytes into lone surrogates. The ORIGINAL code survives this only by
#     accident -- print() re-encodes through the same codec and handler, so the mojibake
#     round-trips back to the correct bytes. Add a strict .encode('utf-8') on top of that
#     text-mode read and the lone surrogates become fatal: UnicodeEncodeError, exit 1, raw-stdin
#     fallback again. Measured 2/2 correct for binary-both-sides, 1/2 for either one-sided form.
# Do not "simplify" either half back to text mode; each alone reintroduces a live bypass.
#
# WHY the error handlers and the nested try, added round 8 after review: strict UTF-8 codecs made
# the extraction FAIL -- and therefore fall back to raw-stdin matching -- for reasons that have
# nothing to do with the command being dangerous. Three classes were found by review, each a live
# sh/ps1 divergence:
#   - a lone surrogate (`"echo \ud800"`) is valid JSON but not encodable as strict UTF-8, so
#     `.encode('utf-8')` raised and the hook fell back. `surrogatepass` carries it through.
#   - non-UTF-8 wire bytes (latin-1) made `json.loads(bytes)` raise, so the hook fell back and
#     then BLOCKed on a trigger phrase in the `description` field -- exactly the false positive
#     the extraction exists to prevent. `surrogateescape` decodes any byte sequence.
#   - `json.loads` on BYTES also auto-detects UTF-16/32, and decoding first would destroy that.
#     Hence the nested try: bytes first, surrogateescape only as the fallback. Measured 8/8
#     payload classes correct; the single-codec forms scored 6/8 and 7/8.
#
# CORRECTED round 9, then corrected AGAIN by round 9's own review -- the UTF-16/32 half of that
# rationale is unreachable here, but not for the reason first written. `input=$(cat)` reads stdin
# through command substitution and the shell strips NUL bytes; UTF-16 is half NULs. The first
# correction claimed that mangles the payload into a parse failure and a fail-CLOSED denial. It
# does not: stripping NULs from UTF-16LE-encoded ASCII JSON returns the ASCII bytes EXACTLY
# (`u.encode('utf-16-le').replace(b'\x00', b'') == u.encode('ascii')`), so `json.loads` succeeds
# and extraction works normally. Measured: UTF-16LE, UTF-16BE and UTF-32LE payloads are all
# handled correctly; only a BOM'd payload fails, because the BOM's surviving 0xFF byte is not
# valid JSON. So the practical position is: UTF-16/32 mostly works by accident of NUL-stripping,
# BOM'd input falls back, and none of it is reachable anyway because Claude Code emits UTF-8.
# The branch's OPERATIVE purpose is the non-UTF-8 (e.g. latin-1) case, which is verified working.
# Do not delete the nested try on the strength of the UTF-16 argument alone.
# The rule this encodes: extraction may fail only when the payload is genuinely unparseable, never
# because a legal command contains an awkward character.
#
# WHY fall back to matching the whole payload (not to no matching at all) when python3 is
# missing or JSON parsing fails: disabling the guardrail on a missing dependency would trade
# a false-positive block for a silent, total loss of protection, the wrong direction for a
# safety gate. Its cost is that text in every OTHER field, such as `description`, is matched
# too. This fallback does NOT apply when python3 succeeds and tool_input.command is genuinely
# empty -- that's a real, parsed answer ("no command to check"), not an extraction failure.
#
# WHY the fallback DECODES the payload's JSON escapes first, CORRECTED 2026-10-14: this comment
# used to say raw matching "never misses a true positive". It missed every command whose danger
# needs whitespace other than a space. JSON writes a newline as the two characters `\n` and a tab
# as `\t`, so with python3 off PATH a pipe to `bash` split across a newline, a tab-separated
# signing key, a backslash-continued `git push --force`, and any `(^|[^a-z])git` row straight
# after a newline all got NO verdict, while the parsed path refused or prompted (measured). So
# did a bare `git merge`: in the payload it is followed by the closing `"`, not the end of string.
# The decoder below models json.loads for every string in the payload:
#   - `\" \\ \/ \b \f \n \r \t` and an ASCII `\uXXXX` become the character they stand for, and
#     `\u0000` becomes nothing, as the shell drops a NUL from the extracted command;
#   - a non-ASCII `\uXXXX` becomes `?`, and a surrogate PAIR becomes one `?`, since it is one
#     character. awk cannot portably write UTF-8, and no row treats a non-ASCII character as a
#     space, so a non-letter stand-in gets the same verdicts with two measured kinds of exception.
#     It is stricter where the C-locale pass counts a `?` as 1 byte and the real character as 2 to
#     4. It is weaker where a UTF-8 locale's `grep -i` folds a real character to an ASCII letter --
#     a class, not one character: U+017F (long s) matches `s` and U+0131 (dotless i) matches `i`,
#     so `commit.gpg<U+017F>ign` prompts on the parsed path and not here. In every measured case the
#     shell or git rejected the word, or git failed on the value, so the misses are false
#     positives', not bypasses. A pair once written as `??` let 140 escaped emoji in a signing gap
#     pass the {0,255} bound under a UTF-8 locale (measured). The .ps1 twin writes the real character, which is what its own
#     parsed path sees;
#   - an UNESCAPED `"` -- a JSON string delimiter, never command text -- becomes a space, so the
#     end of the command string reads as a word boundary, as the end of the extracted command does.
# Splitting on backslashes makes it one linear pass in which `\\` is consumed as a pair, so
# `\\n` (a backslash, then n) is never read as a newline. Any other escape is kept verbatim.
# WHY out() splits on quotes instead of calling gsub: gsub was measured QUADRATIC in the number of
# matches on gawk 5.4 (128K unescaped quotes: 10.6 s; split: 0.17 s), and this runs before the
# length bound, so a malformed payload full of raw quotes hung the hook for minutes.
#
# WHY hookSpecificOutput.permissionDecision, not exit code: settings.json wires this hook
# as "... 2>/dev/null || bash ... || true" for cross-platform fail-open portability, and
# that "|| true" suffix silently converts any nonzero exit code to 0 -- empirically
# confirmed while building review-reminders.ps1/.sh. permissionDecision:deny is read from
# stdout JSON regardless of the wrapping shell's final exit code.

input=$(cat 2>/dev/null)
if [ -z "$input" ]; then
    # WHY systemMessage JSON, not plain text: a PreToolUse hook's plain stdout never reaches the
    # model and is not shown in the visible transcript (per Claude Code's docs), so the fails-open
    # notice reached no one. systemMessage is shown to the user.
    printf '{"systemMessage":"[HOOK ERROR] dangerous-commands.sh: could not read stdin. Proceeding in fails-open mode."}\n'
    exit 0
fi

# WHY each text-tool stage below checks its own status, 2026-11-16: the script has no pipefail, so
# a failed awk, sed, tr or wc printed nothing and the guard went on with an empty view. An empty
# command matches no row (an allow), and an empty length skips the length bound. A failed stage
# now denies, and pipelines are split so that each stage's status is the one tested.
dc_unanalyzable() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "CONFIRM REQUIRED: a text tool ($1) failed while the guard prepared this command, so it cannot be checked reliably. Run manually if intentional."
    exit 0
}

cmd=""
dc_parsed=0
if command -v python3 >/dev/null 2>&1; then
    extracted=$(printf '%s' "$input" | python3 -c "
import sys, json
try:
    raw = sys.stdin.buffer.read()
    try:
        d = json.loads(raw)
    except UnicodeDecodeError:
        d = json.loads(raw.decode('utf-8', 'surrogateescape'))
    sys.stdout.buffer.write(d.get('tool_input', {}).get('command', '').encode('utf-8', 'surrogatepass'))
except Exception:
    sys.exit(1)
" 2>/dev/null)
    [ $? -eq 0 ] && cmd="$extracted" && dc_parsed=1
fi
if [ "$dc_parsed" -eq 0 ]; then
    cmd=$(printf '%s' "$input" | LC_ALL=C awk '
        function out(s,   q, m, i) { m = split(s, q, /"/); printf "%s", q[1]; for (i = 2; i <= m; i++) printf " %s", q[i] }
        # u8: write code point v as UTF-8 bytes, as the python3 path does (a lone surrogate as its
        # 3-byte form, like surrogatepass). WHY not `?`, which this used until 2026-11-15: ask()
        # offers the card only for printable ASCII, and `?` made `café` or a lone surrogate
        # look like ASCII here while the .ps1 saw the real character and denied.
        function u8(v) {
            if (v < 128) printf "%c", v
            else if (v < 2048) printf "%c%c", 192 + int(v / 64), 128 + v % 64
            else if (v < 65536) printf "%c%c%c", 224 + int(v / 4096), 128 + int(v / 64) % 64, 128 + v % 64
            else printf "%c%c%c%c", 240 + int(v / 262144), 128 + int(v / 4096) % 64, 128 + int(v / 64) % 64, 128 + v % 64
        }
        {
            n = split($0, p, /\\/)
            out(p[1])
            hi = 0; hv = 0
            for (k = 2; k <= n; k++) {
                ph = hi; hi = 0
                if (ph && !(substr(p[k], 1, 1) == "u" && p[k] ~ /^u[dD][c-fC-F][0-9A-Fa-f][0-9A-Fa-f]/)) { u8(hv); ph = 0 }
                if (p[k] == "" && k < n) { printf "\\"; out(p[++k]); continue }
                c = substr(p[k], 1, 1); r = substr(p[k], 2)
                if (c == "\"" || c == "/") printf "%s", c
                else if (c == "b") printf "\b"
                else if (c == "f") printf "\f"
                else if (c == "n") printf "\n"
                else if (c == "r") printf "\r"
                else if (c == "t") printf "\t"
                else if (c == "u" && r ~ /^[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]/) {
                    v = 0
                    for (j = 1; j <= 4; j++) v = v * 16 + index("0123456789abcdef", tolower(substr(r, j, 1))) - 1
                    r = substr(r, 5)
                    if (ph && v >= 56320 && v <= 57343) u8(65536 + (hv - 55296) * 1024 + (v - 56320))   # a pair
                    else if (v >= 55296 && v <= 56319 && r == "") { hi = 1; hv = v }   # high half: wait for a low one
                    else if (v > 0) u8(v)
                }
                else printf "\\%s", c
                out(r)
            }
            if (hi) u8(hv)
            printf "\n"
        }') || dc_unanalyzable awk
fi

# WHY join backslash-newline continuations before any tier matching: the shell parser
# removes a backslash followed by a newline before the command ever reaches git, so
#     git config commit.gpgsign \
#       false
# executes exactly as `git config commit.gpgsign false`. The hook, though, receives the raw
# two-line text, and no pattern's key-to-value glue matches a backslash or a newline -- so
# the gate stayed silent while signing was genuinely disabled. Verified live: the
# continuation form moved commit.gpgsign from true to false with no CONFIRM, while the
# identical one-line command fired correctly.
#
# WHY this predates the commit-signing work: the original patterns used the same ` *[= ] *`
# glue, so the hole existed from the first version and survived three review rounds before
# the fourth found it. It is not specific to signing either -- a BLOCK substring such as
# "git push --force" was equally evadable by wrapping the line.
#
# WHY this normalizes $cmd globally instead of building a separate copy for one tier: the
# goal is to make the hook's view of the command match what the shell will actually run,
# which is correct for every tier, so it happens once, here, before any matching.
#
# Contrast the argument-STRIPPING approach tried and withdrawn in review round 4: removing
# a command's message and search payloads made the hook's view deliberately DIFFER from
# reality, and introduced two defects of its own -- sed is line-based while .NET -replace is
# not, so the two shells disagreed on multi-line input, and an unquoted multi-word argument
# was only partly removed. It also bought little: anchoring the patterns to a `config`
# subcommand or a `-c` flag already resolved three of the four false positives that
# motivated it. Normalizing TOWARD what the shell does is safe; normalizing away from it is
# not.
#
# WHY awk rather than sed: a continuation spans two lines and sed is line-based; the common
# ':a;N;$!ba' slurp idiom also misbehaves on single-line input under GNU sed. This is plain
# POSIX awk -- when a line ends in a backslash, delete that backslash (and a trailing CR) and
# emit the line with NO separator at all, so the line that follows concatenates directly. This
# rule deliberately inserts nothing; the separate blank-run collapse below is what reproduces
# the shell's tokenization. See the DELETES-rather-than-substitutes note further down -- an
# earlier version of this comment described the withdrawn space-substituting attempt, which is
# the exact behaviour that shipped the round-5 mid-token bypass.
#
# WHY the join must collapse to exactly one space: a first attempt simply swapped the
# backslash for a space and left the continuation line's indentation in place. That works for
# the signing patterns, whose regexes glue with ` *`, but silently broke the BLOCK tier --
# those patterns are literal substrings, so "git push \<newline>  --force" joined to
# "git push   --force" and no longer contained "git push --force". Caught by a probe, not by
# inspection: the wrapped force-push produced no verdict at all while the one-line form
# blocked correctly.
# WHY the join DELETES rather than substitutes, and whitespace is collapsed separately:
# backslash-newline elision in the shell inserts nothing at all. Two earlier attempts each got
# half of this and each shipped a live bypass, both caught by review:
#   1. swap the backslash for a space, keep the continuation indent -> "git push \<nl>  --force"
#      became "git push   --force", which no longer contains the literal "git push --force".
#   2. swap for one space, strip the indent -> fixed that, but broke the no-whitespace case:
#      "rm -r\<nl>f /tmp" became "rm -r f /tmp", losing "rm -rf". Every literal BLOCK substring
#      was then evadable by wrapping a line mid-token. Verified live on both shells.
# Deleting the backslash-newline models the shell CLOSELY -- not exactly, and the difference is
# worth stating: a DOUBLED backslash is an escaped literal, so the shell ends the command there
# and does not join, while this rule strips one trailing backslash regardless of how many precede
# it and joins anyway. It also models only backslash-NEWLINE, not the shell's general rule that a
# backslash escapes ANY next character -- that gap was a live BLOCK-tier bypass, and it is the
# de-escaped second view below, not this rule, that closes it. Both divergences over-join, i.e.
# they can only produce extra matches. Collapsing runs of blanks afterwards reproduces the
# shell's tokenization, which treats any run of blanks as one separator.
# The property this protects, which must survive any future edit here: dangerous-commands.ps1's
# boundary regex uses \s (Unicode-aware, matches NBSP and other Unicode space separators) while
# dangerous-commands.sh's confirm_boundary() uses POSIX [[:space:]] (locale-dependent, typically
# ASCII-only). A single-character substitution -- an NBSP in place of the space after "git merge"
# -- therefore bypassed the CONFIRM gate on one platform but not the other, verified by direct
# execution. Folding tabs to a plain literal space lets both boundary checks compare against one
# ASCII character, with no character-class or locale ambiguity. This deliberately does NOT fold
# other Unicode whitespace (NBSP, em-space) to a boundary character on either side: those stay
# non-boundaries consistently everywhere, rather than a boundary on one platform only.
#
# WHY tab folding lives HERE and nowhere else, added round 8: it used to ALSO happen in a separate
# earlier step. Two sufficient mechanisms for one property meant no behavioural test could
# discriminate either -- neutering the earlier step left every tab assertion byte-identically
# green, so the regression guard for the parity bug above was already dead while still looking
# healthy. Redundant normalization in a matcher does not add safety; it removes testability.
# Keep exactly ONE folding site so the tests can prove it.
# WHY a length bound before any matching: the CONFIRM regexes below contain gap groups of the
# shape `git (<gap>)config (<gap>)`, and .NET's backtracking engine blows up on a long run that
# contains many `config` tokens and none of `|`, `;` or `&`. GNU grep uses a DFA and stays flat,
# so the blowup is .ps1-side -- but the bound is applied identically in BOTH shells because a
# guard that behaves differently per platform is the defect class this file has already shipped
# twice.
#
# WHY it CONFIRMs rather than truncating: truncation is fail-OPEN. A dangerous substring
# straddling the cut point would simply disappear. Refusing to silently analyze a command the
# guard cannot analyze reliably is the honest failure direction.
#
# WHY 50000, CORRECTED in round 8 -- the previous figure here was wrong in kind, not just in
# degree. This comment used to claim the bound held the .ps1 worst case to "roughly 8 seconds".
# Two things were wrong. First, the growth is CUBIC, not quadratic: measured in-process on the
# `config` gap shape, 1000/2000/4000/8000 chars took 0.027/0.202/1.438/11.486s -- ~8x per
# doubling, the signature of three nested unbounded quantifiers. Extrapolated, 50000 chars is
# roughly 47 MINUTES for ONE pattern, and there are two of this shape matched against two views.
# Second, the earlier 16s measurement that replaced the 8s figure used a no-separator payload,
# which is not the worst case at all (0.43s here) -- the `config`-token density is what drives it.
# A PreToolUse hook blocks the tool call, so that was a hang, not a slow path, and it was
# reachable by ordinary work: a large heredoc writing prose ABOUT `git config`, with no pipe or
# semicolon in it, is exactly the shape that triggers it.
#
# The blowup is fixed at its source, but ONLY where it exists. This is the part the first round-8
# attempt got wrong: it bounded EVERY gap group to {0,200} uniformly, which broke a live gate.
# Measured per pattern at 50000 chars. NOTE THE PAYLOAD SHAPE -- an earlier version of this table
# used dense `git config ` text, which is the worst case for the NESTED patterns but NOT for the
# single-gap ones; measuring both on the shape that is worst for each gives:
#     one unbounded gap  (`-c ...`, `--no-gpg-sign`)  4.3s   on dense `git ` text
#     two nested gaps    (`config (gap)...(gap)`)     >30s   times out; ~47 min extrapolated
# Only the NESTED pair blows up superlinearly, so only those four groups are bounded, now at
# {0,255} (0.74s at 50000 chars, measured at the earlier {0,300}). The two single-gap patterns
# are left UNBOUNDED on purpose.
#
# WHY 255 and not 300: POSIX guarantees a repetition bound only up to RE_DUP_MAX, whose minimum is
# 255. A grep that supports -z but caps bounds there would reject `.{0,300}` with exit 2, which
# dc_grep turns into a denial of EVERY command, because the signing rows run on every call. No such
# grep has been measured; macOS/BSD grep is the plausible case and is untested. BusyBox is NOT that
# case: it rejects -z before compiling any pattern, so this hook denies every command there at 255
# and at 300 alike (measured end to end, BusyBox 1.37.0 on Alpine with bash). GNU grep accepts both
# bounds. The .ps1 twin uses the same 255 so the two shells keep one regex text and one bound.
#
# WHOLE-HOOK cost on 50000-byte shapes, measured end to end, .ps1 side: median of 3 interleaved
# runs (min-max in brackets), without -> with the structural rm / force-push / command-execution
# rows, 2026-10-30 on one Windows machine. "+CR" is the same shape with one carriage return in the
# middle, so the CR-deleted view runs too:
#     dense `git ` +CR         30.81s [29.88-31.19] -> 32.78s [32.50-34.30]  <- slowest shape found so far
#     dense `git `             26.82s [22.12-29.15] -> 22.54s [21.86-24.86]  (ranges overlap: no change
#                                                                           resolved on this shape)
#     dense `git push ` +CR    18.30s [15.28-21.54] -> 22.81s [19.18-22.94]
#     dense `git push `         9.56s [9.33-11.31]  -> 12.28s [11.96-13.13]
#     dense `git config `      10.61s [10.37-11.49] -> 11.05s [10.23-11.31]
#     `rm -rrrrrrrr ` rep +CR   0.95s [0.67-1.14]   -> 11.54s [10.99-14.14]
#     `rm -rrrrrrrr ` repeated  0.60s [0.58-0.64]   ->  7.49s [7.43-8.05]
#     dense `rm -r `            0.66s [0.66-0.82]   ->  3.78s [3.61-3.96]
#     `rm -` + r x 49986        0.60s [0.56-0.61]   ->  0.57s [0.56-0.60]  (18.99s, median of 2, with
#                                                                           the flag letters unbounded,
#                                                                           2026-10-14)
#     ordinary text             0.63s [0.59-0.71]   ->  0.61s [0.56-0.65]
# Figures move between days on the same machine (dense `git ` without the rows: 18.04s on
# 2026-10-14, 26.82s here), so compare a row's two columns, not one date with another.
# ~33s is not a hang (the ~47-minute cubic case is gone) but a PreToolUse hook blocks the tool
# call for its whole duration, so this is the honest .ps1 figure for "what does a pathological
# 50 KB command cost". It is quadratic, not cubic: halving DC_MAX_CMD would quarter it. That trade
# has NOT been made here -- it is recorded so the next person changing DC_MAX_CMD knows the shape.
# The sh twin's medians were 1.4-4.1s on the periodic shapes above (Windows Git Bash, where process
# start-up dominates), and 1.58s to 1.92s on the first 50 KB of scripts/mb.sh. Its slow case is
# NON-periodic text instead. On ~50 KB of random draws from a handful of tokens (`git `, `push `,
# `stash `, `=`, `-a`, `x` and space; or `rm `, `-r`, `-`, `r`, `x` and space; or a mix of the
# two, plus one CR), the whole sh hook took 52.99s, 27.92s and 99.90s respectively, against
# 1.57-3.29s without these three rows (median of 3, 2026-10-31, one Windows machine). That is
# inside the 600s hook timeout, but slower than the .ps1 figure above. On a short command the rows
# add about 0.2s per call on the sh side (1.25s to 1.43s, median of 15).
#
# WHY leaving them unbounded is not laziness: in `git (<gap>)--no-gpg-sign` the gap holds the
# COMMIT MESSAGE, not flags. Bounding it to 200 silently disabled that CONFIRM for any commit
# message longer than about 185 characters, on BOTH shells -- and ordinary messages in this repo
# exceed that. It is exactly the shape the round-6 note below cites as canonical. The reasoning
# that justified the uniform bound ("real gaps are tiny: `--global` is 9 characters") is true of
# the `config` gaps and false of the message gap; one bound was applied to two different things.
# KNOWN COST of the {0,255} bound that remains: 256+ characters between `git` and `config`, or
# between `config` and the key, no longer matches. That is flag-and-path territory, where gaps
# really are short, and it does not lower the bar for an adversary -- anyone able to pad the
# command text already has the strictly easier S4/S5 bypasses documented as unfixable by any
# text matcher.
#
# WHY test assertions rather than a .NET regex timeout: a timeout converts the hang into a
# DENIAL, so a legitimate documentation command is still blocked, merely sooner -- see [NS-25],
# where guards firing on the TEXT of commands is this repo's most-repeated complaint. It is also
# ps1-only, reintroducing the per-platform divergence named above. The suites instead assert the
# SHAPE structurally (no pattern may carry more than one unbounded gap), on both platforms and in
# constant time, plus a bounded-cost timing check on the .NET side. The first attempt asserted
# wall-clock time on the BASH side too; that assertion could not fail, because GNU grep is a DFA
# and never got slow -- reverting all six bounds left the suite green at 108/0.
#
# KNOWN COST of the length bound itself: a genuinely legitimate single command larger than
# 50000 -- a very large heredoc, say -- prompts. That is a deliberate trade, not an oversight.
dc_fold=$(printf '%s' "$cmd" | awk '
    {
        line = $0
        if (sub(/\\[\r]?$/, "", line)) printf "%s", line
        else print line
    }') || dc_unanalyzable awk
cmd=$(printf '%s' "$dc_fold" | sed 's/[ 	][ 	]*/ /g') || dc_unanalyzable sed

# WHY a second, aggressively de-escaped view of the command: a shell strips a backslash before
# ANY character, not only before a newline, and concatenates adjacent quoted segments with no
# separator. So `r\m -r\f` runs as `rm -rf`, and `git config "commit."'gpgsign' false` runs as
# `git config commit.gpgsign false` -- both of which the faithful view above cannot see, because
# it deliberately models only backslash-NEWLINE elision. Both were live, unprompted bypasses of
# the BLOCK and CONFIRM tiers respectively, and both PRE-DATE the commit-signing work.
#
# WHY match against both views instead of replacing the faithful one: this view is deliberately
# NOT faithful -- it destroys information a real shell keeps. Matching it in ADDITION can only
# ever ADD a match, never remove one, so the change is strictly fail-closed.
#
# KNOWN COST, stated rather than hidden: stripping quotes creates matches a real shell would not
# produce -- `echo "rm" "-rf"` collapses to `echo rm -rf` and now trips BLOCK. That is the same
# accepted class as the documented quoted-invocation-as-text false positive below.
#
# WHY the de-escaped view also maps NEL, NBSP and the other Unicode spaces to a space, 2026-11-15:
# the .ps1 twin's `\s` matches them (.NET: [\f\n\r\t\v\x85\p{Z}]) and grep's [[:space:]] does not
# match NEL in any locale, nor NBSP under glibc's C.UTF-8. PowerShell runs `iwr x |<NEL>iex`
# (measured in review, 7.6), so on the sh fallback that pipe-to-iex got no verdict here while the
# .ps1 denied it. Only a run straight after `|` or `|&` is mapped, because that is the one place a
# `\s` in the .ps1 rows meets them; everywhere else this file keeps NBSP a non-boundary (see the
# whitespace note above, and the pinned `git<NBSP>merge` test). Mapping is monotone, like the rest
# of this view: it can only add matches. The list is U+0085, U+00A0, U+1680, U+2000-U+200A,
# U+2028, U+2029, U+202F, U+205F, U+3000, as UTF-8 bytes; the sed runs under LC_ALL=C so it
# matches those bytes in any locale.
#
# WHY every other non-ASCII character then becomes one `~`, 2026-11-15: it makes the C pass count a
# gap in this view in CHARACTERS, never more than the UTF-16 code units the .ps1 twin's {0,255}
# bounds count (one per BMP character, two per astral one), so this side is at least as strict.
# Before, a force push padded with about 70 emoji was denied by the .ps1 and got no verdict here:
# C counted 4 bytes per emoji and grep 3.0's UTF-8 pass misses astral characters in a gap. One `~`
# per emoji, not two, also keeps the verdict the old `?` fallback gave 140 escaped emoji in a
# signing gap (pinned in the tests), which the .ps1 does not give. `~` is ordinary gap text to
# every row, and the plain view keeps the original bytes, so this too can only add matches.
# The script's four substitutions, in order: (1) a run of spaces after `|` or `|&`; (2) 4-byte, (3)
# 3-byte, (4) 2-byte UTF-8 sequences to `~`. Longest first: a shorter pattern runs on what is left,
# so (2) must precede (3) and (4), or their ranges would split a 4-byte sequence differently.
dc_ws_sed=$(printf 's/[|](&?)([[:space:]]|\302\205|\302\240|\341\232\200|\342\200[\200-\212]|\342\200[\250\251\257]|\342\201\237|\343\200\200)+/|\\1 /g;s/[\360-\367][\200-\277][\200-\277][\200-\277]/~/g;s/[\340-\357][\200-\277][\200-\277]/~/g;s/[\300-\337][\200-\277]/~/g')
# WHY the status is checked: a sed that rejects this script (measured in review: BusyBox built on
# uClibc says "Invalid collation character" to the byte ranges) prints nothing, and an empty view
# would silently drop every match the de-escaped view exists to make. The pipeline's status is
# sed's, so on failure a command of printable ASCII (plus tab, LF, CR) falls back to the view as it
# was before 2026-11-15, without the rewrites, and any other command is refused.
# WHY only ASCII falls back, 2026-11-16: the fallback skips the NEL/NBSP folding after `|`, and
# `iwr x |<U+0085>iex` got no verdict here while the .ps1 twin denied it. For ASCII the skipped
# rewrites only fold tab, LF or CR after `|`, and the pipe rows still matched every such case
# probed in review (tab, LF, CRLF, CR before the shell name) with `sed -E` failing.
dc_strip=$(printf '%s' "$cmd" | tr -d '\\"'"'") || dc_unanalyzable tr
if ! cmd_loose=$(printf '%s' "$dc_strip" | LC_ALL=C sed -E "$dc_ws_sed;s/  */ /g"); then
    dc_loose_na=$(printf '%s' "$dc_strip" | LC_ALL=C tr -d ' -~\t\n\r') || dc_unanalyzable tr
    [ -z "$dc_loose_na" ] || dc_unanalyzable sed
    cmd_loose=$(printf '%s' "$dc_strip" | sed 's/  */ /g') || dc_unanalyzable sed
fi

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
}

# WHY the CONFIRM rows ask rather than deny, changed 2026-11-14: a deny told the agent to hand the
# user a command to run, which the user cannot do from the phone over Remote Control. An "ask"
# shows an Allow/Deny card with this reason, and the user's click is a per-action approval the
# agent cannot write. Measured 2026-11-14 in auto mode: the card appeared and waited for a click
# even though settings.json allows `Bash(git *)`. Three things this depends on:
# - BLOCK rows run BEFORE every CONFIRM row. A CONFIRM match exits with ask, so a BLOCK row after
#   it would never be reached and a BLOCK command would become a prompt.
# - The denies that say the guard could not analyze a command (length limit, a failed text tool) stay
#   deny: an unanalyzed command may hold a BLOCK pattern.
# - The card is offered only for a command of printable ASCII (plus tab, LF, CR). WHY, 2026-11-15:
#   grep and .NET disagree on non-ASCII input -- bytes vs characters vs UTF-16 units in the
#   {0,255} gaps, grep 3.0's astral defect, `[[:space:]]` vs `\s` (NBSP, NEL), `-i` folding of
#   U+017F and U+0131 -- so a BLOCK row could match in one twin and not the other, and the same
#   command became a deny there and a card here. Two review rounds found one such class after
#   another; this closes the class instead. Both twins deny such a command with the CONFIRM
#   reason, so they agree. The cost: a CONFIRM command holding any non-ASCII text (a commit
#   message with an accent, say) is a hard deny again, as before 2026-11-14.
ask() {
    # WHY no `| wc -c` count, 2026-11-16: with no pipefail a failed first `tr` printed nothing, wc
    # counted 0 and the card was offered for a command the .ps1 twin denies. Keeping tr's own output
    # lets its exit status decide: a failed tr denies, and any byte left over is non-ASCII.
    if ! _dc_na=$(printf '%s' "$cmd" | LC_ALL=C tr -d ' -~\t\n\r'); then
        deny "${1%% Approve only if you intend this.} The guard could not check this command for characters outside printable ASCII, so it is refused rather than offered as an approval card. Run manually if intentional."
        return
    fi
    if [ -n "$_dc_na" ]; then
        deny "${1%% Approve only if you intend this.} The command holds a character outside printable ASCII, which this guard cannot match the same way in its sh and PowerShell versions, so it is refused rather than offered as an approval card. Run manually if intentional."
        return
    fi
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
}

# WHY `wc -c` and not `${#cmd}`, corrected round 8: `${#cmd}` counts CHARACTERS IN THE CURRENT
# LOCALE, not bytes. Measured on one string of three U+00E9: 6 under LC_ALL=C, 3 under C.UTF-8 or
# en_US.UTF-8. So the round-8 change that moved the .ps1 side to UTF8.GetByteCount did NOT make the
# two shells agree "by construction" as its first version claimed -- it inverted the divergence,
# leaving bash counting low under exactly the UTF-8 locales CI runs under. `wc -c` counts bytes in
# every locale, which is the unit the .ps1 twin now uses, so the two agree for real.
DC_MAX_CMD=${DC_MAX_CMD:-50000}
cmd_len=$(printf '%s' "$cmd" | wc -c | tr -d '[:space:]')
case $cmd_len in '' | *[!0-9]*) dc_unanalyzable wc ;; esac
if [ "$cmd_len" -gt "$DC_MAX_CMD" ]; then
    deny "CONFIRM REQUIRED: command is ${cmd_len} bytes, above the ${DC_MAX_CMD}-byte limit this guard can analyze reliably. Run manually if intentional."
    exit 0
fi

# WHY a THIRD view with carriage returns deleted, added 2026-10-14: Git Bash deletes a CR while
# parsing, even with igncr off (measured: `ab<CR>cd` reaches the command as `abcd`), so
# `git push --for<CR>ce` runs as a force push. One CR inside a word walked past every tier, on both
# hooks and both paths.
# WHY in ADDITION rather than deleting CRs inside cmd_loose, as a first version did: deleting them
# there glued the words on either side of a CR together, so `x`, CR, `g"it" merge` lost the CONFIRM
# the CR-keeping view gave it. On Bash those were false positives, but the .ps1 twin judges the Bash
# tool too whenever pwsh is present, and it keeps every verdict (it must: PowerShell reads a lone CR
# as a statement break). Two policies made the verdict depend on which hook ran. An added view can
# only add a match, so both hooks now give one verdict on CR shapes, by the rule every view here
# follows.
# WHY computed only when the command holds a CR: otherwise this view equals cmd_loose and matching it
# again finds nothing new, while each `$(...)` here is a subprocess on every Bash tool call. Left
# empty, it matches no row: every case arm needs the pattern's text, and dc_grep is not given it.
# WHY after the length bound, and through a `case` in dc_has_cr(): the first version tested for a CR
# with `${cmd_loose#*<CR>}` above the bound. bash runs that in time quadratic in the string's
# length (measured on Git Bash: 0.35 s at 50K characters, 8.8 s at 200K), so an oversized command
# could outlast the hook's timeout, and a timed-out hook does not block the call. A `case` glob is
# linear (0.0012 s at 200K, measured). It sits in a helper because a `case` on a raw view is what
# the completeness tests forbid every matcher to do.
# dc_nl and dc_cr are also the trailing boundaries of confirm_boundary() below.
dc_nl='
'
dc_cr=$(printf '\r')
dc_has_cr() {
    case "$1" in *"$dc_cr"*) return 0 ;; esac
    return 1
}
cmd_loose_nocr=""
if dc_has_cr "$cmd_loose"; then
    dc_nocr=$(printf '%s' "$cmd_loose" | tr -d '\r') || dc_unanalyzable tr
    cmd_loose_nocr=$(printf '%s' "$dc_nocr" | sed 's/  */ /g') || dc_unanalyzable sed
fi

# WHY a lowered copy of each view above (the CR-deleted one only when it exists), hoisted here
# rather than folded per matcher: POSIX `case` is case-SENSITIVE, and every corresponding site in
# the .ps1 twin uses OrdinalIgnoreCase (literals) or RegexOptions.IgnoreCase (regexes). Four of
# the six matchers below -- block(), block_boundary() (since replaced by block_regex() for
# [NS-38]), confirm(), warn() -- used a bare `case` and so returned NO VERDICT AT ALL on a
# mixed-case payload the .ps1 twin caught. Only confirm_regex() (grep -i) and
# confirm_boundary() (which folded per call) already agreed. That is a live divergence across
# three tiers, not a cosmetic one: SQL keywords are case-insensitive to the engine, so a
# mixed-case drop executes exactly as the upper-case one does, and on the default
# case-insensitive Windows and macOS filesystems a shell resolves `RM` to the same binary as
# `rm`. Two lowercase SQL literals had been added to the BLOCK list to paper over this; they
# patched two entries and left the mechanism broken, so the mechanism is fixed here instead and
# those entries are gone.
#
# WHY folding is safe to apply this widely: lowering BOTH sides of an ASCII comparison is
# MONOTONE -- it can only ever ADD a match, never remove one -- so it cannot open a new bypass,
# only produce false positives. That is the same fail-closed argument the cmd_loose note above
# makes, and the same accepted cost: at CONFIRM and WARN tier a false positive is a prompt, at
# BLOCK tier it is a refusal. The word-boundary checks below are what keep that cost bounded.
#
# WHY hoisted: computing it once beside cmd_loose keeps every matcher reading the SAME views, so
# "did this matcher fold?" is answerable by reading one line of the matcher instead of tracing
# which of them recomputed it. confirm_boundary() used to recompute both per call.
#
# WHY `tr` and not a shell parameter expansion: ${var,,} is a bashism and this file targets POSIX sh.
#
# KNOWN RESIDUAL DIVERGENCE, measured 2026-08-26 rather than assumed: `tr 'A-Z' 'a-z'` folds ASCII
# ONLY, while .NET's OrdinalIgnoreCase folds non-ASCII too -- verified directly, a Greek upper-case
# string Contains() its lower-case form under OrdinalIgnoreCase and returns True. So for a non-ASCII
# payload the two shells still disagree, which is the same class of gap this whole change closes,
# one layer down. It is NOT a regression: before this change the sh side folded nothing at all, so
# every case this misses was already missed. And no pattern shipped in this file contains a
# non-ASCII character, so nothing in the current list is affected. Stated here rather than papered
# over -- an earlier draft of this comment claimed the two "match", which was simply false.
#
# WHY THE SUBJECT IS FOLDED HERE AND THE PATTERNS ARE NOT FOLDED AT ALL: every pattern below is
# a literal known when this file is written, so it is simply WRITTEN in lower case. The obvious
# alternative -- folding $1 inside each matcher -- was implemented, MEASURED, and reverted: it
# adds a `printf | tr` subshell per matcher CALL, about 25 per invocation, and this hook runs on
# every single Bash tool call. Measured on this machine over 10 runs of a benign command:
# 1.07s -> 2.33s per invocation, a 2.2x regression paid by every command the operator ever runs.
# Folding the subjects once costs two subshells total, three when the command holds a CR.
#
# THE TRAP THIS CREATES, and the guard for it: because the subjects are lower case, an UPPER-case
# pattern can now never match anything -- silently, and FAIL-OPEN, which is the worst direction
# for a guard to fail in. Nothing about the call site would look wrong. So both suites assert
# structurally that no pattern argument contains an upper-case letter, which converts that trap
# into a red test the moment someone writes one.
cmd_lc=$(printf '%s' "$cmd" | tr 'A-Z' 'a-z') || dc_unanalyzable tr
cmd_loose_lc=$(printf '%s' "$cmd_loose" | tr 'A-Z' 'a-z') || dc_unanalyzable tr
cmd_loose_nocr_lc=""
if [ -n "$cmd_loose_nocr" ]; then
    cmd_loose_nocr_lc=$(printf '%s' "$cmd_loose_nocr" | tr 'A-Z' 'a-z') || dc_unanalyzable tr
fi

block() {
    # BLOCK: irreversible or highly destructive — refuse unconditionally.
    # Checks the de-escaped view too -- see the cmd_loose note above -- and its CR-deleted copy,
    # and all of them folded to lower case -- see the cmd_lc note above. $1 MUST be written lower case.
    case "$cmd_lc" in
        *"$1"*)
            deny "BLOCK: $2. Refusing this command."
            exit 0
            ;;
    esac
    case "$cmd_loose_lc" in
        *"$1"*)
            deny "BLOCK: $2. Refusing this command."
            exit 0
            ;;
    esac
    case "$cmd_loose_nocr_lc" in
        *"$1"*)
            deny "BLOCK: $2. Refusing this command."
            exit 0
            ;;
    esac
}

dc_grep() {
    # dc_grep <ERE> <locale> <subject>... -- 0 on a match, 1 on no match. Shared by the two regex
    # matchers. A non-empty <locale> runs grep under LC_ALL=<locale>; an empty one runs it under
    # the caller's locale. Grep exiting 2 or higher denies and exits the script instead.
    #
    # WHY the subjects are joined by NUL into ONE grep: under -z a NUL ends a record, so each view
    # is still matched on its own -- no pattern can span from one view into the other, and `^`
    # and `$` anchor per view. It halves the grep calls. Each is a subprocess (~40ms measured on
    # Windows, against a ~1s hook that runs on every Bash tool call), and confirm_regex() below
    # and block_regex() each run up to two passes per row.
    #
    # WHY any other status denies instead of returning: grep exits 2 when it cannot evaluate
    # the pattern at all -- an option it does not support, a malformed expression. Inside an
    # `if`, that status reads exactly like "no match", so a grep that rejected -z would have
    # silently disabled every regex row, including the single-line `curl | bash` BLOCK that the
    # glob matcher this replaced handled with no external tool. Same honest direction as the
    # length bound above: a command the guard cannot analyze prompts, it does not pass.
    # That makes a grep with -z a hard requirement of the sh hook. Measured on Alpine: BusyBox grep
    # rejects -z ("unrecognized option: z"), so with bash but no pwsh every Bash command is refused:
    # with CONFIRM REQUIRED, unless a literal BLOCK row, which runs before any regex row, matches
    # first (measured on Alpine: `rm -rf` gets BLOCK, `ls` gets CONFIRM REQUIRED).
    # The hook's full requirement, python3 included, is stated once, in
    # standards/SECURITY-GUARDRAILS.md under "Platform requirement (sh hook)"; the deny message
    # points there rather than restating it.
    #
    # WHY block_regex() runs C first (it adds UTF-8 passes after it; see block_regex): grep's
    # character classes follow the locale. Measured under GNU
    # grep 3.0, C.UTF-8 made [[:space:]] match NBSP and em-space (which this file keeps
    # non-boundaries outside a pipe, see the whitespace note above; the C.UTF-8 pass block_regex()
    # adds may accept them, an accepted sh-stricter cost) and made [^a-z] stop matching an
    # invalid byte such as 0xFF, which the replaced glob matched in every locale -- reachable
    # through the raw-stdin fallback, since a parsed JSON string cannot carry that byte. Under the
    # byte locale, each class in the pipe row means one fixed set of bytes.
    #
    # WHY confirm_regex() runs a UTF-8 locale AND C, not either one alone (the UTF-8 pass was the
    # caller's locale until 2026-11-15; it is now C.UTF-8 by name; see confirm_regex) -- each alone
    # misses a signing bypass the other catches (all measured):
    #   - C alone: the rows bound their gaps with `.{0,255}`, and C counts that bound in BYTES
    #     while a UTF-8 locale counts CHARACTERS and the .ps1 twin counts UTF-16 code units.
    #     `git config --file /tmp/<120 CJK chars>/cfg` plus the key and a falsey value (408
    #     bytes) matches under C.UTF-8 and .NET and not under C, so the sh CONFIRM went silent
    #     while ps1 prompted.
    #   - The caller's locale alone: under tr_TR.UTF-8, -i does not fold `I` to `i`, so an
    #     upper-case key -- `git config COMMIT.GPGSIGN false`, which git accepts -- got no
    #     verdict; under a UTF-8 locale on a strict grep (GNU 3.7 and 3.11 measured; 3.0 is not
    #     strict) `.` does not match an invalid sequence, so a lone surrogate escape in a gap (the
    #     extraction writes it as bytes ED B3 BF) got none either; and under a UTF-8 locale on GNU
    #     grep 3.0 the full row misses a gap holding an astral character such as an emoji, though
    #     every fragment of the row matches it (3.11 does not). All pass under C. The first two
    #     are the sh twin of defects the .ps1 closes with CultureInvariant and .NET's `.`.
    # The union can only add matches. Its cost is a second grep per row, paid only when the
    # first misses -- that is, on almost every command -- and the NUL join above pays for it.
    # Since 2026-11-15 block_regex() pays it too, one more grep per regex BLOCK row.
    # What the union guarantees, and when, is stated once in standards/SECURITY-GUARDRAILS.md.
    # The list above is the measured record of the caller's pass missing; it is not exhaustive.
    #
    # WHY the argument count is checked: with no subject, printf emits one empty record and grep
    # answers "no match", so a caller that lost its subjects would pass every command silently.
    if [ "$#" -lt 3 ]; then
        deny "CONFIRM REQUIRED: internal error: dc_grep needs a pattern, a locale and at least one subject (got $# arguments), so this command cannot be checked reliably. Run manually if intentional."
        exit 0
    fi
    _dc_re=$1
    _dc_lc=$2
    shift 2
    if [ -n "$_dc_lc" ]; then
        printf '%s\0' "$@" | LC_ALL="$_dc_lc" grep -qziE -e "$_dc_re"
    else
        printf '%s\0' "$@" | grep -qziE -e "$_dc_re"
    fi
    _dc_rc=$?
    if [ "$_dc_rc" -gt 1 ]; then
        deny "CONFIRM REQUIRED: grep could not evaluate a guard pattern (exit ${_dc_rc}), so this command cannot be checked reliably. The sh hook needs a grep that supports -z, such as GNU grep; BusyBox grep does not. Its full platform requirement is in standards/SECURITY-GUARDRAILS.md under Platform requirement (sh hook). Run manually if intentional."
        exit 0
    fi
    return "$_dc_rc"
}

block_regex() {
    # Like block(), but matches an extended regex, case-insensitively, via dc_grep -- the
    # BLOCK-tier counterpart of confirm_regex() below, which documents the -z/-e rationale.
    #
    # WHY it exists, [NS-38]: a trailing pipe is a real shell line continuation. `curl x |`
    # followed by a newline and then `bash` runs exactly as `curl x | bash`. So do blank lines
    # between the two (verified live in bash). The literal-substring rows this replaced could
    # not span that newline, so a piped-to-interpreter command split across lines passed the
    # BLOCK tier with no verdict at all on the sh side. The .ps1 twin's `\s*` already spanned
    # it. A case glob cannot say "zero or more whitespace", so this tier needs a regex, and
    # grep -z lets the whitespace class reach across newlines.
    #
    # WHY the pipe rows are merged into one alternation rather than one row per interpreter:
    # each row costs a grep subprocess on every Bash tool call (see dc_grep), so one row is one
    # call, not two.
    #
    # WHY two passes, since 2026-11-15: C (see dc_grep for why), then C.UTF-8. Under C the {0,255}
    # gaps count BYTES, so a gap of about 90 CJK characters blocked in the .ps1 twin (which counts
    # UTF-16 code units) and got no verdict here. C.UTF-8 is named because Git Bash on Windows sets
    # no LANG or LC_* variable, so grep there runs as C -- measured 2026-11-15, `.{3}` did not match
    # three CJK characters with the locale unset and did under LC_ALL=C.UTF-8. The de-escaped view's
    # `~` rewrite (see cmd_loose) also makes its C pass count characters, which covers a host where
    # C.UTF-8 is missing or grep's UTF-8 pass is defective (grep 3.0 misses astral characters in a
    # gap). The union can only add matches. Its accepted cost: the C.UTF-8 pass may treat NBSP and
    # em-space as [[:space:]] (glibc's does not), so the sh twin may be the stricter one there.
    # Where a CONFIRM row also matches, ask() refuses non-ASCII commands, so both twins deny.
    # Checks the de-escaped view and its CR-deleted copy too -- see the cmd_loose notes above.
    if dc_grep "$1" C "$cmd" "$cmd_loose" ${cmd_loose_nocr:+"$cmd_loose_nocr"} \
        || dc_grep "$1" C.UTF-8 "$cmd" "$cmd_loose" ${cmd_loose_nocr:+"$cmd_loose_nocr"}; then
        deny "BLOCK: $2. Refusing this command."
        exit 0
    fi
}

confirm() {
    # CONFIRM: advanced op with legitimate uses — ask the user to approve it (see ask() above).
    # Checks the de-escaped view too -- see the cmd_loose note above -- and its CR-deleted copy,
    # and all of them folded to lower case -- see the cmd_lc note above. Without the fold,
    # `--No-Verify` and `SUDO RM` walked through this tier on the sh side while the .ps1 twin gated
    # both. $1 MUST be written lower case.
    case "$cmd_lc" in
        *"$1"*)
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
    case "$cmd_loose_lc" in
        *"$1"*)
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
    case "$cmd_loose_nocr_lc" in
        *"$1"*)
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
}

confirm_regex() {
    # Like confirm(), but matches an extended regex, case-insensitively.
    #
    # WHY a regex helper is needed at all: the commit-signing bypasses below cannot be
    # expressed as literal substrings. `git -c commit.gpgsign=false` and
    # `git config commit.gpgsign false` are the same action with the key and value separated
    # differently, and the second form -- the standard, PERSISTENT one, including --global --
    # was left completely ungated by an earlier literal-substring version of these patterns.
    #
    # WHY case-insensitive: git config keys and boolean values are both case-insensitive
    # (`git -c commit.GPGSign=false` resolves), so a case-sensitive match is evaded by one
    # shifted keystroke. The .ps1 twin applies -imatch to regex entries, so -i here keeps the
    # two shells in agreement.
    #
    # WHY grep -E rather than bash [[ =~ ]]: this file targets POSIX sh, and the ERE subset
    # used by these patterns is also valid .NET regex, so one REGEX serves both the sh and
    # ps1 twins instead of maintaining two dialects. The escaped string LITERALS are not
    # byte-identical -- sh double-quotes need \" where PowerShell single-quotes need '' --
    # see the note above the pattern list below.
    #
    # WHY -e: it is precautionary. None of the four patterns currently in the list begins with
    # a "-", but a future one plausibly could, and grep would then parse it as an option rather
    # than a pattern. An earlier version of this comment claimed several patterns already began
    # with "--"; they do not -- every one begins `(^|[^a-z])git `.
    #
    # WHY -z, and this is the round-6 blocker: WITHOUT it grep is LINE-BASED, so a pattern
    # cannot span a newline, while the .ps1 twin's -imatch runs over the whole string and can.
    # The two shells therefore returned OPPOSITE verdicts on an ordinary multi-line command --
    # `git commit -m "<two-line message>" --no-gpg-sign` passed silently in sh and was denied in
    # ps1. -z makes the whole payload a single record, restoring agreement.
    #
    # This is the SECOND time this exact mismatch has shipped in this file. The argument-
    # stripping approach withdrawn in round 4 was withdrawn *because* `sed` is line-based while
    # .NET -replace is not; the replacement then reintroduced the identical defect one function
    # over, via grep. Recorded here so a third instance is harder to write.
    #
    # Checks the de-escaped view and its CR-deleted copy too -- see the cmd_loose notes above.
    # Matched through dc_grep, which refuses to read a grep failure as "no match": first under
    # C.UTF-8, then under C -- see dc_grep for the three bypasses that need both passes.
    # WHY C.UTF-8 by name, 2026-11-15: until then the first pass was the caller's locale, and Git
    # Bash on Windows sets no LANG or LC_* variable, so there the character-counting pass never ran
    # -- a CJK-padded signing bypass asked on the .ps1 and got no verdict here. On a host with a
    # UTF-8 locale but no C.UTF-8, replacing the caller's pass would lose that match (found in
    # review); the de-escaped view's `~` rewrite (see cmd_loose) gives the C pass UTF-16 counting
    # there, measured in review on a container with C.UTF-8 hidden.
    if dc_grep "$1" C.UTF-8 "$cmd" "$cmd_loose" ${cmd_loose_nocr:+"$cmd_loose_nocr"} \
        || dc_grep "$1" C "$cmd" "$cmd_loose" ${cmd_loose_nocr:+"$cmd_loose_nocr"}; then
        ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
        exit 0
    fi
}

confirm_boundary() {
    # Like confirm(), but requires $1 to be bounded on BOTH sides: preceded by the
    # start of the string or a non-letter, and followed by a space, a newline, a CR or the literal
    # end of the string — not just any non-letter on the trailing side, which the
    # pipe row's `([^a-z]|$)` accepts. WHY the stricter trailing boundary: "git merge" as a
    # plain substring (or under that non-letter check) also matches
    # "git merge-base", a common, harmless read-only command this repo's own session
    # tooling uses constantly — the character after "merge" in "merge-base" is "-", a
    # non-letter, so a non-letter boundary rule would still false-positive there.
    # WHY a leading boundary too (found by code review, not present in the original
    # version): without one, "$1" also matches as a substring of a longer word — e.g.
    # "git commit -m 'legit merge of feature A'" contains the literal substring
    # "git merge " inside "le-GIT- -MERGE-of", which would wrongly trigger CONFIRM.
    # Requiring the character before "$1" to be absent (start of string) or a
    # non-letter closes that gap while still matching "git merge <branch>",
    # "git merge --no-ff <branch>", bare "git merge", and "; git merge <branch>".
    # WHY a literal space, not a [[:space:]]/\s character class, on the trailing
    # side: $cmd already had tabs folded to spaces before this function ever
    # runs (see the blank-run collapse above), and dangerous-commands.ps1
    # does the same normalization -- so both sides only ever need to check for a
    # plain ASCII space, a newline or a CR here, literal characters with no
    # character-class/locale/Unicode ambiguity to keep in parity.
    # WHY case-fold both sides before matching (found by opposition review, not
    # present in the original version): POSIX case globs are case-sensitive, but
    # dangerous-commands.ps1's `-imatch` is not -- so "GIT merge main" (the
    # executable name uppercase, the subcommand itself still lowercase, which git
    # accepts) was denied on PowerShell but silently allowed on bash. On Windows
    # this is a real, executable command, not a contrived case: the filesystem
    # resolves "GIT" to git.exe case-insensitively, and git's own subcommand
    # parsing only requires "merge" (not "GIT") to be lowercase. Folding both
    # $cmd and $1 to lowercase before the case match closes that platform gap
    # without touching confirm()/block()/block_boundary() (the last since replaced by
    # block_regex() for [NS-38]), which are unaffected
    # by this pattern and use the file's existing explicit-lowercase-variant
    # convention (see the "drop table"/"DROP TABLE" pairs above) instead.
    # Checks the de-escaped view too -- see the cmd_loose note above. This function was the
    # FIRST matcher the de-escaped-view retrofit missed (warn() was the second, [NS-40]), and
    # the gap was live: with only
    # the faithful view, `git m\erge main` and `git "merge" main` were both SILENT here while
    # the .ps1 twin CONFIRMed both -- a sh/ps1 divergence in the git merge CONFIRM tier,
    # reachable by the same escape and adjacent-quote techniques the retrofit closed in
    # block()/block_boundary() (since replaced by block_regex())/confirm()/confirm_regex().
    # The ps1 side never had the gap
    # because its `git merge` entry is one more row in the uniform $confirmPatterns loop.
    #
    # WHY the mutation proof did not catch this: deleting cmd_loose turned the escape tests red,
    # which proves the MECHANISM works where it is wired -- it says nothing about whether every
    # matcher is wired to it. Coverage failures wear correctness clothing. The cheap guard is a
    # COMPLETENESS invariant (enumerate every matcher, assert each references every view), which
    # is a different tool from a discrimination check.
    # The two folded views this used to recompute per call are now hoisted beside cmd_loose --
    # see the cmd_lc note above. This function was the only one that folded, which is what made
    # the other four's omission look deliberate rather than missed.
    #
    # WHY a newline is a trailing boundary too, added 2026-10-14: tabs are folded to spaces above
    # but newlines are not, so `git merge`, a newline, then another command -- which runs a bare
    # `git merge` -- got no verdict on either shell. The .ps1 twin's row gained `\n` alongside.
    # A CR is a boundary too, matching the .ps1 row: PowerShell reads a lone CR as a statement
    # break, and that hook judges the PowerShell tool. The arm decides a verdict alone only when
    # another character follows the CR (`git merge`, CR, `ls`): Git Bash deletes the CR and runs
    # `git mergels`, so on this hook that one is an accepted false positive, kept so the two hooks
    # give one verdict. A CR before a space, a newline or the end is a true positive on Git Bash,
    # and the CR-deleted view catches it as well.
    case "$cmd_lc" in
        "$1 "*|"$1$dc_nl"*|"$1$dc_cr"*|"$1"|*[!a-zA-Z]"$1 "*|*[!a-zA-Z]"$1$dc_nl"*|*[!a-zA-Z]"$1$dc_cr"*|*[!a-zA-Z]"$1")
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
    case "$cmd_loose_lc" in
        "$1 "*|"$1$dc_nl"*|"$1$dc_cr"*|"$1"|*[!a-zA-Z]"$1 "*|*[!a-zA-Z]"$1$dc_nl"*|*[!a-zA-Z]"$1$dc_cr"*|*[!a-zA-Z]"$1")
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
    # No CR arms here: this view has none.
    case "$cmd_loose_nocr_lc" in
        "$1 "*|"$1$dc_nl"*|"$1"|*[!a-zA-Z]"$1 "*|*[!a-zA-Z]"$1$dc_nl"*|*[!a-zA-Z]"$1")
            ask "CONFIRM REQUIRED: $2. Approve only if you intend this."
            exit 0
            ;;
    esac
}

warn() {
    # WARN: credential/secrets access — command proceeds, access is surfaced.
    # Folded to lower case -- see the cmd_lc note above. Filenames are the subject here and the
    # default Windows and macOS filesystems are case-insensitive, so `ID_RSA` and `id_rsa` name
    # the same file; the .ps1 twin's OrdinalIgnoreCase already surfaced both.
    #
    # WHY this checks the de-escaped view too, [NS-40]: it was the second matcher the cmd_loose
    # retrofit missed, after confirm_boundary(). Every warn pattern was evadable by one
    # backslash or one pair of quotes -- `cat ~/.ssh/id\_rsa` and `cat ~/.ssh/"id"_rsa` warned
    # on NEITHER shell, while plain `id_rsa` warned on both, and no BLOCK or CONFIRM row covers
    # these paths as a fallback. A bypass of SURFACING, not of enforcement: WARN never blocks,
    # so the command ran either way and what was lost was the notice. The .ps1 warn loop had
    # the same single-view limit and gets the same fix, so the two shells still agree.
    #
    # WHY `return` after a match, unlike the other matchers: warn() does NOT exit -- the
    # command proceeds. Without the return, a command matching several views (most of them, since
    # the loose view differs only when backslashes or quotes are present) would record the
    # warning twice.
    #
    # WHY record here and emit once at the end of the file, not print per row: stdout must be
    # nothing but ONE JSON object, so two matching rows must share one object. Inline rather than
    # a helper function, because the escape-parity test treats every top-level function in this
    # file as a matcher that must have rows unless it is excluded there by name, as deny(),
    # dc_grep() and dc_has_cr() are. The CR-deleted arm records too: a plain line would sit
    # beside the JSON object and void it.
    case "$cmd_lc" in
        *"$1"*)
            dc_warn_sys="${dc_warn_sys:+$dc_warn_sys }WARNING: $2. Proceeding."
            dc_warn_list="${dc_warn_list:+$dc_warn_list, }$2"
            return
            ;;
    esac
    case "$cmd_loose_lc" in
        *"$1"*)
            dc_warn_sys="${dc_warn_sys:+$dc_warn_sys }WARNING: $2. Proceeding."
            dc_warn_list="${dc_warn_list:+$dc_warn_list, }$2"
            return
            ;;
    esac
    case "$cmd_loose_nocr_lc" in
        *"$1"*)
            dc_warn_sys="${dc_warn_sys:+$dc_warn_sys }WARNING: $2. Proceeding."
            dc_warn_list="${dc_warn_list:+$dc_warn_list, }$2"
            return
            ;;
    esac
}

# BLOCK: irreversible or highly destructive — refuse unconditionally
block "rm -rf"           "irreversible recursive deletion"      # WHY: recursive deletion is irreversible
block "mkfs"             "filesystem format"                    # WHY: formats/destroys entire filesystem
block "dd if="           "disk wipe or dump"                    # WHY: raw disk access, wipes or dumps data
block "git push --force" "force push (long form)"               # WHY: rewrites remote history irreversibly
block "git push -f"      "force push (short form)"              # WHY: same as --force, short flag form
# WHY there are no longer lowercase twins of these two: they were added when block() matched
# case-sensitively, and they fixed the two entries someone thought of rather than the matcher.
# Every OTHER pattern in this file -- and both other tiers -- stayed evadable by one shifted
# keystroke, and a MIXED-case spelling evaded these two as well. block() now folds (see the
# cmd_lc note above), which covers every entry and every spelling, so the twins are redundant.
# This also restores structural parity with the .ps1 twin, whose $blockPatterns never had them.
block "drop table"       "SQL table drop"                       # WHY: irreversible schema destruction
block "drop database"    "SQL database drop"                    # WHY: destroys entire database
# PowerShell-native rows, the same three literals as the .ps1 twin's $blockPatterns. WHY here too:
# the PowerShell matcher falls back to this file when pwsh is absent or fails, and once CONFIRM rows
# ask rather than deny, a missing BLOCK row here turned `Format-Volume ...; git merge main` into an
# approval card on this side while the .ps1 denied it. Pipe-to-iex is in the pipe row below.
block "remove-item -recurse -force" "recursive force deletion (PowerShell rm -rf equivalent)"        # WHY: PS equivalent of rm -rf
block "remove-item -force -recurse" "recursive force deletion (PowerShell rm -rf, flags reversed)"  # WHY: flag order varies
block "format-volume"               "disk volume format (PowerShell)"                                # WHY: destroys all data on a volume
# WHY one regex replaces the four literal pipe rows ("| bash", "| sh", "|bash", "|sh"), [NS-38]:
# see block_regex() -- a trailing pipe continues the command onto the next line, and a literal
# cannot span the newline. It matches every input the four rows matched: measured over a
# 4,900-input differential (spacing, case, CR/LF, NBSP, trailing byte) with zero losses.
#   `\|&?`          -- also bash's `|&`, which pipes stdout AND stderr into the interpreter.
#                      The four rows missed `curl x |& bash` on both shells.
#   `[[:space:]]*`  -- no space, one space, and now newlines and blank lines after the pipe.
#   `([^a-z]|$)`    -- the trailing boundary the rows had. Without it, "| sh" false-positives
#                      on "| sha256sum" / "| shasum", tools this repo's own review-gate hash
#                      verification depends on. A digit, `_`, `-`, `.` or `/` after the name
#                      still counts as a boundary, as before: `| bash5` blocks.
# KNOWN GAPS, recorded in standards/SECURITY-GUARDRAILS.md rather than matched. Both shells: a
# comment line between the pipe and the interpreter (a real shell skips it), an interpreter
# reached through another word (`| sudo sh`, `| env bash`, `| /bin/bash`), and any interpreter
# other than bash, sh and PowerShell's iex/Invoke-Expression (zsh, dash, python, ...). The iex
# alternative, like the .ps1 rows it mirrors, takes no `|&` and no trailing boundary, so
# `| iexplore` blocks in both twins. The .ps1 twin used `\b` until 2026-11-15, which
# let `| bash5` and `| bash_x` through there; it now uses this file's `([^a-z]|$)`.
#
# Each *_regex row needs one example in tests/test-dangerous-commands.sh's `_dc_ex` table, keyed by
# row order within its matcher. The escape-parity invariant fails loudly on a row without one;
# when inserting a row between existing ones, renumber the examples after it.
# The second alternative is the .ps1 twin's two pipe-to-iex rows, `\|\s*Invoke-Expression` and
# `\|\s*iex`, with the same shape: no `&`, no trailing boundary. Merged into this row rather than
# added as a row of its own because each row costs grep subprocesses on every Bash tool call.
block_regex "\|(&?[[:space:]]*(bash|sh)([^a-z]|$)|[[:space:]]*(invoke-expression|iex))" "command piped to a shell interpreter (curl|bash, wget|sh, iwr|iex, etc.)"  # WHY: remote code execution vector

# WHY three STRUCTURAL rows beside the literal ones above, ported from a sibling project's local fix
# and rewritten from its PCRE into POSIX ERE: the literals match one
# spelling each, and real commands reorder, split and abbreviate. `git push origin main --force`,
# `git -C . push -f`, `git push origin +main`, `rm -r -f x`, `rm x -rf` and `rm --rec --forc x` all
# executed with no verdict from this file. The literals STAY: a regex row can only add matches, so
# nothing they caught can regress, and they cost no subprocess.
#
# WHY these matter more than defense in depth: the template ships `Bash(git *)` as an allow rule,
# and /code-review's `allowed-tools` pre-approves `Bash(awk *)` for its turn. An allow rule resolves
# BEFORE Claude Code's auto-mode classifier (docs: permission-modes, "How the classifier evaluates
# actions"), so a force push or `git -c alias.x='!cmd' x` reached through `Bash(git *)` is approved
# with no review of any kind unless this hook stops it.
#
# Shared shape, and why each part is there:
#   `[^;&|[:cntrl:]]` -- the SEGMENT class: a flag only counts inside the same simple command, so
#                        `rm -r x` then a newline then `tail -f log` is not a force-delete. It excludes
#                        newline without a literal newline in the row. The .ps1 twin spells the same
#                        byte set `[^;&|\x00-\x1F\x7F]`. Backslash-newline needs no special case: the
#                        join above has already removed it.
#   `{0,255}`         -- the gaps between words. Unbounded, .NET backtracking on them was quadratic:
#                        per view on a 50 KB payload, `rm -r -r ...` took 11.24s and `git push push
#                        ...` 6.11s, against 0.01s and 0.00s bounded. 255 is the POSIX ceiling (see
#                        WHY 255 above). The bound counts bytes under C, characters under UTF-8, and
#                        UTF-16 code units in the .ps1 twin, so a long non-ASCII gap blocked there
#                        and not here (measured: 90 CJK characters, 294 bytes) until block_regex()
#                        added its UTF-8 passes -- see block_regex() for what still differs.
#   `{0,32}`          -- runs of letters inside a flag token. The rm cluster alternative's outer and
#                        inner runs, unbounded together, took about 8-9s per view on `rm -rrrr...`
#                        (50 KB). Unbounded one at a time, each of the other runs measured no slower
#                        than the bounded row on the shapes tried, so they are bounded for
#                        uniformity, not for a measured need.
#                        The cost: more than 32 letters before or between the flag letters is not
#                        matched.
#   no quote classes  -- the de-escaped view strips quotes and backslashes before matching, so
#                        `git push origin '+main'` and `alias.x='!cmd'` arrive unquoted there. A quote
#                        class here would also defeat the escape-parity guard in the tests.
# These rows match common spellings and are NOT exhaustive: a command deliberately respelled --
# padded past a bound, abbreviated further, quoted around a separator, held in a variable, or set up
# by an earlier command or user config -- can get through. The forms tested, blocked and not, are the
# fixture table in the PMB repository's tests/test-dangerous-commands.sh.
#
# rm: `rm` (or `rm.exe`) as a word -- not after `-`, so docker's `--rm` is not it -- then, within one
# segment, a recursive token and a force token in either order, or one short token holding both.
# `-(-|[a-z]{0,32})r` takes `-r`, `-vr`, `--recursive` and getopt's unambiguous `--rec`; `f`
# likewise. On the PowerShell side the same row also reads `rm -r -fo x` and `rm x -Recurse -Force`,
# since `rm` is an alias of Remove-Item there. This row needs the word `rm`, so other Remove-Item
# spellings are not matched by it.
block_regex "(^|[^a-z0-9_-])rm(\.exe)? ([^;&|[:cntrl:]]{0,255} )?(-(-|[a-z]{0,32})r[^;&|[:cntrl:]]{0,255} -(-|[a-z]{0,32})f|-(-|[a-z]{0,32})f[^;&|[:cntrl:]]{0,255} -(-|[a-z]{0,32})r|-[a-z]{0,32}(r[a-z]{0,32}f|f[a-z]{0,32}r))" "irreversible recursive deletion (rm with recursive and force flags, in any order)"
# force push: `git` as a word, then `push` after a space or `=` within the segment -- `=` so that
# `git -c alias.p=push p origin main --force` counts -- then a force indicator anywhere after it:
# `--force` (and so its `-with-lease`/`-if-includes` forms), `--mir` and longer prefixes of
# `--mirror` (which overwrites and deletes remote refs), a short flag cluster holding `f` (`-uf`,
# `-4f`), or a `+refspec`. `push.default` and `--push-option` do not count: `push` must be followed
# by a space. Git also accepts `--mi` and `--m` for `--mirror`; those are not matched.
# `git stash push` must not count -- it never touches a remote -- and ERE has no lookbehind. So the
# space before `push` must follow one of six alternatives, each "a character that is not the next
# letter back, then the tail of `stash`": [^h], [^s]h, [^a]sh, [^t]ash, [^s]tash, [^ ]stash. They
# fail, and the row does not match, when the word before ` push` is a standalone `stash` (any case;
# preceded by a space, or the first word), and when the first word is a bare tail of it (`h`, `sh`,
# `ash`, `tash`). So `git -C stash push --force` and `git --namespace stash push --force` are not
# matched; `git -C /tmp/stash push --force` is. The `-C /x/<tail>` fixtures and `git -C . push`
# pin the alternatives.
# ACCEPTED FALSE POSITIVES: text naming the flags, e.g. `git log --grep 'push --force'` and
# `git commit -m 'drop rm -r and -f'` -- quotes do not end a segment.
block_regex "(^|[^a-z])git(\.exe)? ([^;&|[:cntrl:]]{0,255}([^;&|[:cntrl:]h]|[^;&|[:cntrl:]s]h|[^;&|[:cntrl:]a]sh|[^;&|[:cntrl:]t]ash|[^;&|[:cntrl:]s]tash|[^;&|[:cntrl:] ]stash) |[^;&|[:cntrl:]]{0,255}=)?push( [^;&|[:cntrl:]]{0,255})? (--force|--mir|-[a-z0-9]{0,32}f|\+[^ [:cntrl:]])" "force push (--force, --mirror or -f in any position, or a +refspec)"
# Commands run through a tool's own arguments: a git alias whose value starts with `!` runs as a
# shell command (also reached through `GIT_CONFIG_PARAMETERS`), and awk runs one through system()
# or `"cmd" | getline` (and gawk's coprocess `"cmd" |& getline`). `system` must not follow a `.`, so
# `grep 'os.system('` later in the same command is not awk's. The awk gap is bounded too: unbounded
# it took 5.91s per view on 50 KB. Unlike the other rows that gap is `.`, not the segment class,
# because an awk program holds `;` between its statements and this matcher cannot tell a quoted `;`
# from a command separator. ACCEPTED FALSE POSITIVE as a result: `awk ... ; grep "system(" f` blocks.
# DELIBERATELY NOT PORTED, with the reason in the standard: find -exec/-ok (Claude Code never lets a
# prefix rule approve find's exec actions) and sed's `e` command (no shipped settings allow rule or
# command `allowed-tools` approves sed, so it already meets the prompt or the classifier).
block_regex "alias\.[a-z0-9_.-]+(=| +)!|(^|[^a-z0-9_-])[gmn]?awk .{0,255}([^.a-z0-9_]system ?\(|\|&? ?getline)" "arbitrary command execution through a tool's own arguments (git alias !cmd, awk system() or cmd | getline)"

# CONFIRM: advanced ops with legitimate uses — ask the user to approve each one (see ask() above)
confirm "git filter-branch" "history rewriting"                 # WHY: rewrites commit history, rarely intentional
confirm "git update-ref"    "low-level ref manipulation"        # WHY: low-level plumbing, bypasses safety checks
confirm "sudo rm"           "privileged deletion"               # WHY: elevated deletion can remove system files
# WHY this one reads `-r` when the real flag is `-R`: patterns are matched against a lower-cased
# command (see the cmd_lc note above), so the pattern must be lower case to match at all. The
# real `chmod -R 777` is still caught, because the subject is folded before comparison. The cost
# is that `chmod -r 777` -- a different, and near-nonsensical, command -- now also prompts. That
# false positive is not new: the .ps1 twin's OrdinalIgnoreCase has always had it.
confirm "chmod -r 777"      "world-writable recursive chmod"    # WHY: makes entire tree world-writable
confirm "--no-verify"       "bypasses pre-commit hooks (local governance)"  # WHY: skips safety hooks on commit
# WHY these sit beside the hook-skip flag above: same class of action -- routing around
# local governance -- and that flag already establishes the class as CONFIRM-worthy. An
# agent stopped from skipping hooks was NOT stopped from skipping signing. Reported from
# ai-code-review-agent after an agent disabled signing twice in one session, once right
# after saying it would stop; the gate never fired because no pattern covered it. (Signing
# was unset in that repo, so nothing was actually bypassed -- the gap, not the damage, is
# what was observed.)
# WHY all four falsey spellings: `git config --type=bool` resolves false, 0, no and off to
# false -- verified directly. Truthy spellings are deliberately NOT matched: gating a
# command that turns signing ON would train the operator to dismiss the prompt.
# WHY --unset AND --unset-all: both remove the key entirely, dropping signing back to its
# default-off -- the same outcome by a different route. --unset-all sits beside --unset in
# `git help config`; an earlier version of this pattern required whitespace immediately
# after "--unset" and so could never match it. --replace-all needs no pattern of its own:
# it SETS a value, so the set-form pattern below already covers it.
# WHY the value may be quoted: `git config commit.gpgsign "false"` is ordinary shell style,
# not evasion, and the earlier bare-value-only pattern missed it entirely.
# WHY the key patterns require a `config` subcommand or a `-c` flag, rather than merely a
# `git` token: requiring only `git` made every git command carrying the key as TEXT fire --
# `git commit -m "...commit.gpgsign false..."`, `git log -S "..."`, `git show ... # ...`.
# Anchoring to the flag or subcommand that actually SETS config is what separates a command
# from its data; the normalization block near the top removes the remaining message and
# search payloads. This file is TEMPLATE_OWNED and mb upgrade overwrites it downstream, so
# a noisy pattern cannot be tuned by adopters -- and a tier that fires on ordinary commits
# trains the operator to dismiss it, which is the worse failure direction here.
# WHY the pattern strings differ in ESCAPING between this file and the .ps1 twin while
# remaining identical as regexes: sh double-quotes need \" and PowerShell single-quotes
# need '' for the same two characters. The engine-visible pattern is the same; the parity
# block in tests/test-dangerous-commands.sh asserts equal BEHAVIOUR rather than equal text.
# KNOWN LIMITS -- deliberate, and documented rather than matched.
#
# NOT COVERED (a real shell reaches the same outcome; this file cannot see it):
#   - GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n. CORRECTED RATIONALE: an earlier
#     version of this comment said these "set the key before `git` appears in the string", which
#     implied a re-anchored pattern could catch them. It could not. The env-var mechanism is a
#     SUBSTITUTE for `-c`/`config`, so the anchor token these patterns require is simply absent
#     from the invocation, wherever you look for it (verified against git 2.55).
#   - appending "[commit]\ngpgsign=false" straight into .git/config bypasses git entirely
#   - tag.gpgsign and push.gpgSign are a different namespace, out of scope for a commit gate
#   - a computed value: `git config commit.gpgsign $(echo false)`. The literal alternation
#     (false|no|off|0) cannot see through command substitution.
#   - an indirected key: `K=commit.gpgsign; git config "$K" false`. Resolving it requires
#     EVALUATING the shell, not reading it.
# The last two are not fixable by any text matcher, at any level of effort. Writing patterns
# that appeared to cover them would convert an honest limit into a false claim of coverage --
# and the plain .git/config append is simpler than all of them and stays open regardless.
#
# ACCEPTED FALSE POSITIVES: three are enumerated in standards/SECURITY-GUARDRAILS.md under
# "Accepted false positives". They are NOT repeated here -- an earlier version of this comment
# listed only one of the three, so a maintainer reading the code next to the regexes did not
# learn the other two existed. One list, one home.
#
# The de-escaped second view adds a fourth accepted over-match, also listed there: stripping
# backslashes and quotes produces strings a real shell would not (`echo "rm" "-rf"` collapses to
# `echo rm -rf` and trips BLOCK). That is the price of closing the mid-word-escape and
# adjacent-quote bypasses, and it errs toward refusing.
#
# WHY THESE TWO GAPS ARE `.*` AND NOT `[^|;&]*`, round 9 -- the character class was a LIVE
# BYPASS, not a safety measure. Any `|`, `;` or `&` inside the gap made the pattern unmatchable,
# and for these two patterns the gap holds the COMMIT MESSAGE. Verified live, both shells:
#   git commit -m "docs: R&D notes" --no-gpg-sign            -> ALLOWED (no prompt)
#   git commit -m "parser: handle a|b" --no-gpg-sign         -> ALLOWED
# None of those is an evasion attempt; an ampersand in a commit message is ordinary English.
# (A third form, `git -c "alias.x=a|b" config --global commit.gpgsign false`, was allowed by the
# same defect in the CONFIG patterns below rather than by these two -- it is fixed there, not here.)
#
# The class also did not achieve what it cost: NEWLINE was never in the excluded set, so the gap
# already spanned commands freely. It blocked ordinary messages and not the thing it was for.
#
# The two nested-gap `config` patterns keep a BOUND (`.{0,255}`) because they are the cubic pair
# and need one -- but they no longer exclude separators either. That exclusion was left in place
# for one round on the argument that a separator there means a different command; it was then
# measured to be a live hole of its own:
#     git -c "alias.x=a|b" config --global commit.gpgsign false          -> was ALLOWED
#     git -c core.pager='less | head' config --global commit.gpgsign false -> was ALLOWED
# `core.pager` with a pipe is an ordinary git configuration, and both forms permanently unsign
# every commit in every repo. Bounding alone is enough for the ReDoS; measured at 50000 chars the
# bounded-dot form is 0.795s, marginally FASTER than the class it replaces (0.942s).
#
# ACCEPTED COST, and it is the fail-CLOSED direction: `git config user.name x | grep
# commit.gpgsign false` now prompts, as does `git status | grep -- --no-gpg-sign`. Telling those
# apart from the real bypasses above needs shell tokenization, which this matcher does not do --
# so the choice is which way to be wrong, and a spurious prompt is the honest direction where a
# silent miss is not. Both are recorded in the accepted-false-positive list in
# standards/SECURITY-GUARDRAILS.md rather than left for the next reviewer to rediscover.
confirm_regex "(^|[^a-z])git (.*)-c *[\"']?commit\.gpgsign[\"']? *= *[\"']?(false|no|off|0)([^a-z0-9]|$)" "bypasses commit signing (local governance)"
confirm_regex "(^|[^a-z])git (.{0,255})config (.{0,255})[\"']?commit\.gpgsign[\"']? *[= ] *[\"']?(false|no|off|0)([^a-z0-9]|$)" "bypasses commit signing (local governance)"
confirm_regex "(^|[^a-z])git (.{0,255})config (.{0,255})--unset(-all)? +[\"']?commit\.gpgsign" "bypasses commit signing (local governance)"
confirm_regex "(^|[^a-z])git (.*)--no-gpg-sign" "bypasses commit signing (local governance)"
confirm_boundary "git merge" "merge into a shared/base branch — standards/SECURITY-GUARDRAILS.md CONFIRM tier"  # WHY: precipitating incident for that CONFIRM-tier row was a plain `git merge`, not `gh pr merge` (already denied elsewhere)

# WARN: credential/secrets access — legitimate workflows exist, surface the access only
dc_warn_sys=""; dc_warn_list=""  # filled by warn(), emitted once below
warn "id_rsa"          "SSH private key access"                # WHY: SSH private key — may be intentional (key setup)
warn ".pem"             "certificate or key file access"        # WHY: cert/key files — may be intentional (TLS mgmt)
warn ".env.production"  "production secrets file"               # WHY: production secrets — surface access, don't block
warn "credentials.json" "credential file access"                # WHY: credential file — may be intentional (auth setup)

# WHY JSON, not the plain "WARNING:" lines this tier used to print: a PreToolUse hook's plain
# stdout never reaches the model and is not shown in the visible transcript (per Claude Code's
# docs; it only records it) -- neither the user nor the model ever saw a WARN.
# systemMessage reaches the user per Claude Code's docs (a headless run cannot show it);
# additionalContext reaches the model (measured 2026-10-14, main agent and subagent). The
# model-facing text omits the "WARNING:" token so each match still yields exactly one, which the
# existing one-notice-per-match tests count.
# WHY no JSON escaping: every value is a reason literal from the warn rows above. A future reason
# containing `"` or `\` would emit invalid JSON here -- tests/test-hook-warn-output.sh catches it
# by byte-comparing this output with the .ps1 twin, whose ConvertTo-Json escapes properly.
if [ -n "${dc_warn_sys:-}" ]; then
    printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' \
        "$dc_warn_sys" "dangerous-commands hook: this command matches $dc_warn_list (WARN tier: surfaced, not blocked)."
fi

exit 0
