param([switch]$Uninstall)
$ErrorActionPreference='Stop'
$launch=Join-Path $PSScriptRoot '..\desktop\launch.py'
$python=Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\pythonw.exe'
$icon=Join-Path $PSScriptRoot '..\static\cindy-vinyl.ico'
$sendToLink=Join-Path ([Environment]::GetFolderPath('SendTo')) 'Play with Cindy Vinyl.lnk'
$keys=@('HKCU:\Software\Classes\Directory\shell\CindyVinylPlay','HKCU:\Software\Classes\Folder\shell\CindyVinylPlay','HKCU:\Software\Classes\Directory\Background\shell\CindyVinylPlay')
if($Uninstall){
 foreach($key in $keys){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse}}
 if(Test-Path -LiteralPath $sendToLink){Remove-Item -LiteralPath $sendToLink}
 Write-Host 'Removed Play with Cindy Vinyl from folder menus.'
 exit
}
if(!(Test-Path -LiteralPath $launch) -or !(Test-Path -LiteralPath $python)){throw 'Cindy desktop launcher or Python 3.12 not found.'}
$launch=(Resolve-Path -LiteralPath $launch).Path
foreach($key in $keys){
 New-Item -Path $key -Force | Out-Null
 Set-Item -LiteralPath $key -Value 'Play with Cindy Vinyl'
 New-ItemProperty -LiteralPath $key -Name 'Icon' -Value $icon -PropertyType String -Force | Out-Null
 New-ItemProperty -LiteralPath $key -Name 'MUIVerb' -Value 'Play with Cindy Vinyl' -PropertyType String -Force | Out-Null
 New-ItemProperty -LiteralPath $key -Name 'Position' -Value 'Top' -PropertyType String -Force | Out-Null
 Remove-ItemProperty -LiteralPath $key -Name 'MultiSelectModel' -ErrorAction SilentlyContinue
 $argument=if($key -like '*\Background\*'){'%V'}else{'%1'}
 $command='"'+$python+'" "'+$launch+'" --folder "'+$argument+'"'
 New-Item -Path "$key\command" -Force | Out-Null
 Set-Item -LiteralPath "$key\command" -Value $command
}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($sendToLink)
$shortcut.TargetPath=$python
$shortcut.Arguments='"'+$launch+'" --folder'
$shortcut.WorkingDirectory=Split-Path -Parent $launch
$shortcut.IconLocation=$icon
$shortcut.Save()
Write-Host 'Installed Play with Cindy Vinyl. Also available under right-click > Send to > Play with Cindy Vinyl.'
