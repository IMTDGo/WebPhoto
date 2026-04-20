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
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $scriptDir -PassThru
if ($serverProc.HasExited) {
  Write-Host "伺服器啟動失敗，請先檢查 server.js。" -ForegroundColor Red
  exit 1
}

Write-Host "本機伺服器已啟動，正在建立公開網址..." -ForegroundColor Cyan
Write-Host "關閉此視窗或按 Ctrl+C 會同時停止公開網址與本機伺服器。" -ForegroundColor Yellow

try {
  & $cloudflaredExe tunnel --url http://localhost:3000 --protocol http2
}
finally {
  if (!$serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force
  }
}
