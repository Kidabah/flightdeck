# One-time helper: register cindyvinyl:// so Vinyl can Open folders/files in Explorer.
# Right-click → Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File install-cindy-open.ps1

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "CindyVinyl"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$helper = Join-Path $dir "open.ps1"
@'
param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = "Stop"
$raw = [uri]::UnescapeDataString($Url)
$raw = $raw -replace '^cindyvinyl:', ''
$select = $false
if ($raw -match '^//select/') {
  $select = $true
  $rest = $raw -replace '^//select/', ''
} elseif ($raw -match '^//open/') {
  $rest = $raw -replace '^//open/', ''
} else {
  $rest = $raw -replace '^/+', ''
}
$unc = '\\' + ($rest -replace '/', '\')
if (-not $unc -or $unc -eq '\\') { exit 1 }
if ($select) {
  Start-Process explorer.exe -ArgumentList "/select,`"$unc`""
} else {
  Start-Process explorer.exe -ArgumentList "`"$unc`""
}
'@ | Set-Content -Path $helper -Encoding UTF8

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$helper`" `"%1`""
$base = "HKCU:\Software\Classes\cindyvinyl"
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(default)" -Value "URL:Cindy Vinyl Open"
New-ItemProperty -Path $base -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name "(default)" -Value $cmd

Write-Host ""
Write-Host "Cindy Vinyl Open helper installed."
Write-Host "  Helper: $helper"
Write-Host "  Protocol: cindyvinyl://"
Write-Host ""
Write-Host "Back in Vinyl, On Cindy → Open should launch Explorer."
Write-Host "Press Enter to close."
[void][System.Console]::ReadLine()
