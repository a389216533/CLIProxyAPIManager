param(
  [string]$TargetDir = "",
  [string]$BuildDir = "dist-windows"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($TargetDir)) {
  $commonSoftwareDirName = -join ([char[]](0x5E38, 0x7528, 0x8F6F, 0x4EF6))
  $TargetDir = Join-Path (Join-Path "E:\" $commonSoftwareDirName) "CPAManager"
}
$sourceDir = Join-Path $repoRoot $BuildDir
$sourceExe = Join-Path $sourceDir "CLIProxyAPIManager.exe"
$targetExe = Join-Path $TargetDir "CLIProxyAPIManager.exe"

function Stop-ViteDevServer {
  $listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -like "*CLIProxyAPIManager*") {
      Write-Host "Stopping Vite dev server PID $($listener.OwningProcess)..."
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-TargetProcess {
  if (-not (Test-Path -LiteralPath $targetExe)) {
    return @()
  }

  $stopped = @()
  Get-Process -Name "CLIProxyAPIManager" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $targetExe } |
    ForEach-Object {
      $stopped += $_.Id
      Write-Host "Stopping CPAManager PID $($_.Id)..."
      Stop-Process -Id $_.Id -Force
    }

  foreach ($id in $stopped) {
    Wait-Process -Id $id -Timeout 15 -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500

  $stillRunning = Get-Process -Name "CLIProxyAPIManager" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $targetExe }
  if ($stillRunning) {
    throw "Target process still running: $($stillRunning.Id -join ',')"
  }

  return $stopped
}

Push-Location $repoRoot
try {
  Write-Host "Publishing CLIProxyAPIManager to $TargetDir"
  Stop-ViteDevServer

  Write-Host "Building Windows release..."
  & (Join-Path $PSScriptRoot "build-windows.ps1") -OutputDir $BuildDir

  if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "Build output not found: $sourceExe"
  }

  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  $stopped = Stop-TargetProcess

  Write-Host "Copying release files..."
  Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force
  Copy-Item -LiteralPath (Join-Path $sourceDir ".env.example") -Destination (Join-Path $TargetDir ".env.example") -Force

  $sourceHash = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash
  $targetHash = (Get-FileHash -LiteralPath $targetExe -Algorithm SHA256).Hash
  if ($sourceHash -ne $targetHash) {
    throw "Hash mismatch source=$sourceHash target=$targetHash"
  }

  Write-Host "Starting CPAManager..."
  Start-Process -FilePath $targetExe -WorkingDirectory $TargetDir -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $running = Get-Process -Name "CLIProxyAPIManager" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $targetExe }

  Write-Host ""
  Write-Host "Publish succeeded."
  Write-Host "Stopped PID(s): $($stopped -join ',')"
  Write-Host "Running PID(s): $($running.Id -join ',')"
  Write-Host "SHA256: $targetHash"
  Write-Host "Output: $targetExe"
} finally {
  Pop-Location
}
