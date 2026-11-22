param([string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$dist = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist'
$stage = Join-Path $dist 'windows-package'
New-Item -ItemType Directory -Force $stage | Out-Null
& $Dotnet publish (Join-Path $PSScriptRoot 'PosPrintBridge.csproj') -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -p:DebugSymbols=false -o $stage
if ($LASTEXITCODE -ne 0) { throw 'POS Print Bridge publish failed.' }
$files = @(Join-Path $stage 'PosPrintBridge.exe')
foreach ($file in @('Install.cmd','README.txt')) {
    $copy = Join-Path $stage $file
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $copy -Force
    $files += $copy
}
$zip = Join-Path $dist 'POS-Windows-Print-Bridge.zip'
Compress-Archive -LiteralPath $files -DestinationPath $zip -Force
Get-Item -LiteralPath $zip
