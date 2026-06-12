<#
.SYNOPSIS
    PreCompact hook — warn if memory bank is stale and no handoff was taken.
.DESCRIPTION
    Fires before Claude Code auto-compacts context. Goal: surface a reminder
    so Claude updates memory-bank/ before context is permanently summarized.
    Always exits 0 — advisory only, never blocks compaction.

    Two conditions suppress the warning (either is sufficient):
      1. handoff.md exists — user invoked the Handoff protocol; state is captured.
      2. Any memory-bank/*.md was modified within the last 8 hours — memory bank
         was updated this session; compaction summary will have up-to-date context.
#>

param()

# Drain stdin silently — PreCompact hooks receive a JSON payload we don't need.
# WHY: Avoids the hook hanging if PowerShell tries to read a closed pipe.
try { $null = $input | Out-Null } catch {}

# Condition 1: handoff taken this session — state is captured elsewhere.
if (Test-Path "handoff.md") {
    exit 0
}

# Condition 2: memory bank updated recently (within 8 hours = one work session).
# WHY: 8 hours is a reasonable upper bound for a single work session.
if (Test-Path "memory-bank") {
    $cutoff = (Get-Date).AddHours(-8)
    $recent = Get-ChildItem -Path "memory-bank" -Filter "*.md" -ErrorAction SilentlyContinue |
              Where-Object { $_.LastWriteTime -gt $cutoff } |
              Select-Object -First 1
    if ($recent) {
        exit 0
    }
}

# Neither condition met — warn before compaction proceeds.
Write-Host "[PRE-COMPACT WARNING] Memory bank appears stale and no handoff was taken."
Write-Host "  Context is about to be compacted. To preserve in-flight state:"
Write-Host "  1. Update memory-bank/activeContext.md with current focus and next steps"
Write-Host "  2. Update memory-bank/progress.md with any completed work this session"
Write-Host "  3. Or type 'Handoff' to capture full session state before compacting"
Write-Host "  Compaction will proceed regardless — this warning is advisory only."

exit 0
