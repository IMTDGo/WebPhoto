$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$nodeExe = Join-Path $scriptDir "node\node.exe"
$cloudflaredExe = Join-Path $scriptDir "cloudflared.exe"

if (!(Test-Path $nodeExe)) {
  Write-Host "找不到 node\node.exe，請先確認 portable Node.js 在專案資料夾內。" -ForegroundColor Red
  exit 1
}

if (!(Test-Path $cloudflaredExe)) {
  Write-Host "找不到 cloudflared.exe，請先下載後再執行。" -ForegroundColor Red
  exit 1
}

Write-Host "啟動本機上傳伺服器 (http://localhost:3000)..." -ForegroundColor Cyan
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $scriptDir -PassThru -NoNewWindow
if ($serverProc.HasExited) {
  Write-Host "伺服器啟動失敗，請先檢查 server.js。" -ForegroundColor Red
  exit 1
}

# Wait for server to be ready (up to 30 seconds)
Write-Host "等待伺服器就緒..." -ForegroundColor Yellow
$ready = $false
$maxRetries = 60
$retryCount = 0
while ($retryCount -lt $maxRetries -and (-not $ready)) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
      $ready = $true
    }
  } catch {
    # Server not ready yet
  }
  $retryCount++
}

if (-not $ready) {
  Write-Host "伺服器啟動超時 (${maxRetries} 次嘗試後仍未就緒)" -ForegroundColor Red
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "[OK] 本機伺服器已就緒！正在建立 Cloudflare Tunnel..." -ForegroundColor Green

try {
  & $cloudflaredExe tunnel --url http://localhost:3000 --protocol http2
}
finally {
  Write-Host "關閉 Tunnel，停止本機伺服器..." -ForegroundColor Yellow
  if (!$serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  }
}