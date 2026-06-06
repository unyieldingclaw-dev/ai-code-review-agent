#!/usr/bin/env sh
# PreToolUse hook — 3-tier dangerous command guardrails for Claude Code.
# Reads the Bash tool input JSON from stdin, extracts the command string,
# and enforces BLOCK / CONFIRM / WARN tier matching via POSIX case matching.
# All output goes to stdout. Fails open: unexpected errors exit 0.

# Centralized tier messages — all pattern matches use these templates.
BLOCK_MSG="BLOCK: %s. Refusing this command."
CONFIRM_MSG="CONFIRM REQUIRED: %s. Run manually if intentional."
WARN_MSG="WARNING: %s. Proceeding."

# Read stdin
# WHY: cat is POSIX-portable; avoids bashisms. 2>/dev/null prevents noise if stdin is closed.
input=$(cat 2>/dev/null)
if [ -z "$input" ]; then
    printf "[HOOK ERROR] dangerous-commands.sh: could not read stdin.\nProceeding in fails-open mode.\n"
    exit 0
fi

# Extract command field — portable grep/sed, no jq dependency.
# WHY: grep/sed works on all POSIX systems. jq is not guaranteed installed.
# Limitation: assumes single-line JSON (Claude Code hook payloads always are).
cmd=$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | sed 's/"command":"//;s/"$//' 2>/dev/null)

block() {
    # BLOCK: irreversible or highly destructive — refuse unconditionally
    case "$cmd" in
        *"$1"*)
            printf "$BLOCK_MSG\n" "$2"
            exit 1
            ;;
    esac
}

confirm() {
    # CONFIRM: advanced op with legitimate uses — require explicit manual invocation
    case "$cmd" in
        *"$1"*)
            printf "$CONFIRM_MSG\n" "$2"
            exit 1
            ;;
    esac
}

warn() {
    # WARN: credential/secrets access — command proceeds, access is surfaced
    case "$cmd" in
        *"$1"*)
            printf "$WARN_MSG\n" "$2"
            ;;
    esac
}

# BLOCK: irreversible or highly destructive — refuse unconditionally
block "rm -rf"           "irreversible recursive deletion"      # WHY: recursive deletion is irreversible
block "mkfs"             "filesystem format"                    # WHY: formats/destroys entire filesystem
block "dd if="           "disk wipe or dump"                    # WHY: raw disk access, wipes or dumps data
block "git push --force" "force push (long form)"               # WHY: rewrites remote history irreversibly
block "git push -f"      "force push (short form)"              # WHY: same as --force, short flag form
# NOTE: POSIX case is case-sensitive. Adding lowercase variants to match ps1 OrdinalIgnoreCase behavior.
block "DROP TABLE"       "SQL table drop"                       # WHY: irreversible schema destruction
block "DROP DATABASE"    "SQL database drop"                    # WHY: destroys entire database
block "drop table"       "SQL table drop (lowercase)"           # WHY: parity with ps1 OrdinalIgnoreCase — catches lowercase SQL
block "drop database"    "SQL database drop (lowercase)"        # WHY: parity with ps1 OrdinalIgnoreCase — catches lowercase SQL
block "| bash"           "command piped to bash (curl|bash, wget|bash, etc.)"  # WHY: remote code execution vector
block "| sh"             "command piped to sh"                  # WHY: remote code execution via sh
block "|bash"            "command piped to bash (no-space form)"  # WHY: curl|bash without spaces evades space-prefixed pattern
block "|sh"              "command piped to sh (no-space form)"    # WHY: wget|sh without spaces evades space-prefixed pattern

# CONFIRM: advanced ops with legitimate uses — require explicit manual invocation
confirm "git filter-branch" "history rewriting"                 # WHY: rewrites commit history, rarely intentional
confirm "git update-ref"    "low-level ref manipulation"        # WHY: low-level plumbing, bypasses safety checks
confirm "sudo rm"           "privileged deletion"               # WHY: elevated deletion can remove system files
confirm "chmod -R 777"      "world-writable recursive chmod"    # WHY: makes entire tree world-writable
confirm "--no-verify"       "bypasses pre-commit hooks (local governance)"  # WHY: skips safety hooks on commit

# WARN: credential/secrets access — legitimate workflows exist, surface the access only
warn "id_rsa"           "SSH private key access"                # WHY: SSH private key — may be intentional (key setup)
warn ".pem"             "certificate or key file access"        # WHY: cert/key files — may be intentional (TLS mgmt)
warn ".env.production"  "production secrets file"               # WHY: production secrets — surface access, don't block
warn "credentials.json" "credential file access"                # WHY: credential file — may be intentional (auth setup)

exit 0
