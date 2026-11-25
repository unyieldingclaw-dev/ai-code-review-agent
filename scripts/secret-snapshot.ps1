$snapshotArgs = $args
$repo = $null
$wantRepo = $false
foreach ($argValue in $snapshotArgs) {
    if ($wantRepo) {
        $repo = $argValue
        $wantRepo = $false
    } elseif ($argValue -ceq '--repo') {
        if ($repo) { exit 3 }
        $wantRepo = $true
    } elseif ($argValue.StartsWith('--repo=', [StringComparison]::Ordinal)) {
        if ($repo) { exit 3 }
        $repo = $argValue.Substring(7)
    }
}

$python = $env:PMB_SNAPSHOT_PYTHON
if (-not $repo -or -not $python -or -not [IO.Path]::IsPathFullyQualified($repo) -or
    -not [IO.Path]::IsPathFullyQualified($python) -or -not [IO.File]::Exists($python) -or
    -not [IO.Directory]::Exists($repo)) { exit 3 }

# Use the host utility at its fixed installation path before launching the supplied interpreter.
$realpath = '/usr/bin/realpath'
if ([IO.Path]::DirectorySeparatorChar -eq '\') {
    $realpath = [IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'), 'Git', 'usr', 'bin', 'realpath.exe')
    if ([IO.Path]::GetExtension($python) -ine '.exe') { exit 3 }
}
if (-not [IO.File]::Exists($realpath)) { exit 3 }
Push-Location -LiteralPath $PSScriptRoot
try {
    $physicalRepo = & $realpath $repo
    if ($LASTEXITCODE -ne 0 -or -not $physicalRepo) { exit 3 }
    $physicalPython = & $realpath $python
    if ($LASTEXITCODE -ne 0 -or -not $physicalPython) { exit 3 }
    # MSYS emits either drive notation for ordinary paths or POSIX notation after a junction.
    $physicalPython = $physicalPython -replace '^([A-Za-z]):/', '/$1/'
    $physicalRepo = $physicalRepo -replace '^([A-Za-z]):/', '/$1/'
    $prefix = $physicalRepo.TrimEnd('/') + '/'
    if ($physicalPython.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { exit 3 }
    & $python -I -B (Join-Path $PSScriptRoot '_secret-snapshot.py') @snapshotArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
