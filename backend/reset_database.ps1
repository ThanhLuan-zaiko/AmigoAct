<#
.SYNOPSIS
    Resets the local dev Oracle schema: drops and recreates AMIGOACT_DB_USER,
    then applies schema.sql.

.DESCRIPTION
    Reads connection settings from .env (same file the app uses), exports them
    for the reset helper, and runs scripts/reset_db.py via `uv run`. The helper
    recreates the app user and rebuilds all tables from schema.sql.

    The Oracle container runs in WSL (gvenzl/oracle-free). Its port 1521 is
    forwarded to Windows localhost by WSL, so AMIGOACT_DB_HOST=localhost works.

.PARAMETER Force
    Skip the interactive confirmation prompt.

.PARAMETER AllowRemote
    Allow running against a non-localhost AMIGOACT_DB_HOST. Dangerous.

.PARAMETER EnvFile
    Path to the env file to read. Defaults to .env next to this script.

.PARAMETER SchemaFile
    DDL file applied after the user is recreated. Defaults to schema.sql next
    to this script.

.EXAMPLE
    .\reset_database.ps1            # asks for confirmation
    .\reset_database.ps1 -Force     # no prompt (e.g. from a task runner)
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$AllowRemote,
    [string]$EnvFile = "",
    [string]$SchemaFile = ""
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot is unreliable inside param() defaults on some hosts.
$scriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
}
if (-not $EnvFile) { $EnvFile = Join-Path $scriptDir ".env" }
if (-not $SchemaFile) { $SchemaFile = Join-Path $scriptDir "schema.sql" }
$SchemaFile = (Resolve-Path $SchemaFile).Path  # fails fast when missing

if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile - copy .env.example to .env and fill it in."
}

# --- Parse .env: KEY=value lines, ignoring comments and blanks -------------
$vars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $value = $Matches[2] -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
        $vars[$Matches[1]] = $value
    }
}

foreach ($required in @("AMIGOACT_DB_USER", "AMIGOACT_DB_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace($vars[$required])) {
        throw "$required is empty in $EnvFile - fill it in before resetting."
    }
}

$dbHost     = $vars["AMIGOACT_DB_HOST"];       if (-not $dbHost)    { $dbHost = "localhost" }
$port       = $vars["AMIGOACT_DB_PORT"];       if (-not $port)      { $port = "1521" }
$service    = $vars["AMIGOACT_DB_SERVICE"];    if (-not $service)   { $service = "MYORACLEDB" }
$adminUser  = $vars["AMIGOACT_DB_ADMIN_USER"]; if (-not $adminUser) { $adminUser = "SYSTEM" }

Write-Host "Target : ${dbHost}:${port}/${service}"
Write-Host "Schema : $($vars['AMIGOACT_DB_USER']) (dropped, recreated, rebuilt from $(Split-Path -Leaf $SchemaFile))"
Write-Host "Admin  : $adminUser (password comes from env var or a prompt, never this file)"

if (-not $Force) {
    $answer = Read-Host "Proceed? All data in this schema will be lost [y/N]"
    if ($answer -notin @("y", "Y", "yes")) {
        Write-Host "Aborted."
        exit 0
    }
}

# Export for the helper process - env vars take precedence over the .env file.
# The admin password is deliberately NOT forwarded: keep it out of .env.
foreach ($key in $vars.Keys) {
    if ($key -eq "AMIGOACT_DB_ADMIN_PASSWORD") {
        Write-Warning "AMIGOACT_DB_ADMIN_PASSWORD found in $EnvFile - it is ignored; remove it and let the script prompt."
        continue
    }
    Set-Item "Env:$key" $vars[$key]
}

$helper = Join-Path $scriptDir "scripts\reset_db.py"
$helperArgs = @("--schema", $SchemaFile)
if ($AllowRemote) { $helperArgs += "--allow-remote" }

Push-Location $scriptDir
try {
    & uv run python $helper @helperArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
