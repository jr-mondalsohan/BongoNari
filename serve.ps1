$ErrorActionPreference = "Stop"
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    $candidates = @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
    $nodePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $nodePath) {
        throw "Node.js 22.13 or newer is required. Install Node.js, then run this task again."
    }
    $nodePath = (Resolve-Path $nodePath).Path
}
else {
    $nodePath = $node.Source
}

$versionOutput = & $nodePath --version
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    throw "Could not determine the installed Node.js version."
}
$version = [Version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if ($version -lt [Version]::new(22, 13, 0)) {
    throw "Node.js 22.13 or newer is required. Installed version: $versionOutput"
}

& $nodePath (Join-Path $PSScriptRoot "server.js")
exit $LASTEXITCODE
