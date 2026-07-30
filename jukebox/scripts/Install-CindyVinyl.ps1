# Installs Cindy Vinyl as a Desktop (+ Start Menu) app window on this PC.
# Default: home LAN URL (no Tailscale). Override with -Url for Tailscale HTTPS.
param(
    [string]$Url = "http://192.168.4.239:4541",
    [ValidateSet("edge", "chrome", "auto")]
    [string]$Browser = "auto",
    [switch]$StartMenuOnly,
    [switch]$DesktopOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StaticDir = Join-Path $ScriptDir "..\static"
$IconPath = Join-Path $StaticDir "cindy-vinyl.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = Join-Path $StaticDir "icon-192.png"
}
if (-not (Test-Path $IconPath)) {
    # Pull icon from the live Vinyl server when installing from a share.
    $iconDir = Join-Path $env:LOCALAPPDATA "CindyVinyl"
    if (-not (Test-Path $iconDir)) {
        New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
    }
    $remoteIco = Join-Path $iconDir "cindy-vinyl.ico"
    try {
        $base = ($Url -replace "/$", "")
        Invoke-WebRequest -Uri "$base/static/cindy-vinyl.ico" -OutFile $remoteIco -UseBasicParsing -TimeoutSec 8
        $IconPath = $remoteIco
    } catch {
        $IconPath = $null
    }
}

function Find-BrowserPath {
    param([string]$Kind)
    $candidates = @()
    if ($Kind -eq "edge") {
        $candidates = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        )
    } elseif ($Kind -eq "chrome") {
        $candidates = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
    }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

$BrowserPath = $null
if ($Browser -eq "auto") {
    $BrowserPath = Find-BrowserPath "edge"
    if (-not $BrowserPath) { $BrowserPath = Find-BrowserPath "chrome" }
} else {
    $BrowserPath = Find-BrowserPath $Browser
}

if (-not $BrowserPath) {
    throw "Could not find Edge or Chrome. Install one, or pass -Browser edge|chrome."
}

function New-CindyShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [string]$Icon
    )
    $dir = Split-Path -Parent $ShortcutPath
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $sc.TargetPath = $Target
    $sc.Arguments = $Arguments
    $sc.WorkingDirectory = Split-Path -Parent $Target
    if ($Icon -and (Test-Path $Icon)) {
        $sc.IconLocation = $Icon
    }
    $sc.Description = "Cindy Vinyl - play Cindy library"
    $sc.Save()
    Write-Host "Created: $ShortcutPath"
}

$argsApp = "--app=$Url"
$doDesktop = -not $StartMenuOnly
$doStart = -not $DesktopOnly

if ($doDesktop) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    New-CindyShortcut -ShortcutPath (Join-Path $desktop "Cindy Vinyl.lnk") `
        -Target $BrowserPath -Arguments $argsApp -Icon $IconPath
}

if ($doStart) {
    $startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    New-CindyShortcut -ShortcutPath (Join-Path $startDir "Cindy Vinyl.lnk") `
        -Target $BrowserPath -Arguments $argsApp -Icon $IconPath
}

Write-Host ""
Write-Host "Cindy Vinyl is ready."
Write-Host "  Opens:  $Url"
Write-Host "  Browser: $BrowserPath"
Write-Host ""
Write-Host "Same Wi-Fi / LAN as the Pi is required for the LAN address."
Write-Host "Away from home, use Tailscale and:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Url `"https://flightdeck.tail7de73e.ts.net:4540`""
