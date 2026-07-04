param(
  [string]$OutputDir = "dist-windows",
  [switch]$ForceNpmInstall
)

$ErrorActionPreference = "Stop"

function Test-FrontendInstallRequired {
  if ($ForceNpmInstall) {
    return $true
  }

  $nodeModules = Join-Path ".\web" "node_modules"
  if (-not (Test-Path -LiteralPath $nodeModules)) {
    return $true
  }

  $nodeModulesTime = (Get-Item -LiteralPath $nodeModules).LastWriteTimeUtc
  foreach ($manifest in @(".\web\package.json", ".\web\package-lock.json")) {
    if ((Get-Item -LiteralPath $manifest).LastWriteTimeUtc -gt $nodeModulesTime) {
      return $true
    }
  }
  return $false
}

if (Test-FrontendInstallRequired) {
  npm --prefix .\web ci
} else {
  Write-Host "Skipping npm ci; web/node_modules is up to date. Use -ForceNpmInstall to reinstall."
}
npm --prefix .\web run build

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -o (Join-Path $OutputDir "CLIProxyAPIManager.exe") .\cmd\server

Copy-Item .\.env.example (Join-Path $OutputDir ".env.example") -Force
