param(
    [Parameter(Mandatory, Position = 0)][string]$Source,
    [Parameter(Position = 1)][string]$Argument1,
    [Parameter(Position = 2)][string]$Argument2,
    [Parameter(Position = 3)][string]$Argument3,
    [switch]$AllowMixed
)
$parser = Join-Path $PSScriptRoot '_review-evidence-check.py'
$python = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) { exit 1 }
$arguments = @($parser, $Source)
if ($PSBoundParameters.ContainsKey('Argument1')) { $arguments += $Argument1 }
if ($PSBoundParameters.ContainsKey('Argument2')) { $arguments += $Argument2 }
if ($PSBoundParameters.ContainsKey('Argument3')) { $arguments += $Argument3 }
if ($AllowMixed) { $arguments += '--allow-mixed' }
& $python.Source @arguments
exit $LASTEXITCODE
