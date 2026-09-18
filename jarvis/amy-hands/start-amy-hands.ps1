# Start Amy Hands + open Chrome extension loader helpers.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path "$Root\config.json")) {
  Copy-Item "$Root\config.example.json" "$Root\config.json"
}

# Restart Hands cleanly on :4701
Get-NetTCPConnection -LocalPort 4701 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400
Start-Process -FilePath "python" -ArgumentList "`"$Root\amy_hands.py`"" -WorkingDirectory $Root -WindowStyle Minimized

$ext = Join-Path $Root "chrome-extension"
Write-Host ""
Write-Host "Amy Hands starting on :4701"
Write-Host "Chrome tabs need the unpacked extension:"
Write-Host "  1) chrome://extensions"
Write-Host "  2) Developer mode ON"
Write-Host "  3) Load unpacked -> $ext"
Write-Host ""

Start-Process explorer.exe $ext
Start-Process "chrome.exe" "chrome://extensions" -ErrorAction SilentlyContinue
