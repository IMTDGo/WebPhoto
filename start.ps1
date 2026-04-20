# WebPhoto 啟動腳本
# 使用專案內的 portable Node.js

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeBin = Join-Path $scriptDir "node"
$env:PATH = "$nodeBin;$env:PATH"

Write-Host "Node.js: $(& node --version)" -ForegroundColor Green
Write-Host "npm:     $(& npm --version)" -ForegroundColor Green
Write-Host ""
Write-Host "啟動 WebPhoto 伺服器..." -ForegroundColor Cyan
Write-Host "開啟瀏覽器: http://localhost:3000" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止`n" -ForegroundColor Gray

Set-Location $scriptDir
node server.js
