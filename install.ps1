# Thin launcher for PowerShell: runs the Python installer next to this file. Example:  .\install.ps1 --plan
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PYTHONPATH = (Join-Path $here 'src') + $(if ($env:PYTHONPATH) { [IO.Path]::PathSeparator + $env:PYTHONPATH } else { '' })
foreach ($cmd in @(@('py', '-3'), @('python'), @('python3'))) {
    if (Get-Command $cmd[0] -ErrorAction SilentlyContinue) {
        $rest = @(); if ($cmd.Count -gt 1) { $rest = $cmd[1..($cmd.Count - 1)] }
        & $cmd[0] @rest -m cctk @args
        exit $LASTEXITCODE
    }
}
Write-Error 'Python 3.9 or newer is needed. Install it from https://www.python.org/downloads/ and run this again.'
exit 1
