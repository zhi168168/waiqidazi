param([switch]$Prebuilt)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $projectRoot 'deploy'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
# A new versioned folder avoids overwriting or recursively deleting user files.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backend = Join-Path $outputRoot "cloudrun-$stamp"
$mini = Join-Path $outputRoot "miniprogram-cloud-$stamp"
New-Item -ItemType Directory -Path $backend,$mini | Out-Null
if ($Prebuilt) {
    Push-Location $projectRoot
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
        & node scripts/build-cloud-runtime.mjs (Join-Path $backend 'runtime')
        if ($LASTEXITCODE -ne 0) { throw 'Backend bundle failed' }
    } finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'Dockerfile.runtime') -Destination (Join-Path $backend 'Dockerfile')
    [IO.File]::WriteAllText((Join-Path $backend '.dockerignore'),"node_modules`n.env`n.git`n",[Text.UTF8Encoding]::new($false))
} else {
    $include = @('Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','index.html','vite.config.js','server','web')
    foreach ($name in $include) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $backend -Recurse }
}
foreach ($name in @('app.js','app.json','app.wxss','config.cloud.js','sitemap.json','project.config.json','assets','pages','utils')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "miniprogram/$name") -Destination $mini -Recurse
}
Copy-Item -LiteralPath (Join-Path $mini 'config.cloud.js') -Destination (Join-Path $mini 'config.js')
$projectConfigPath = Join-Path $mini 'project.config.json'
$projectConfig = Get-Content -LiteralPath $projectConfigPath -Raw | ConvertFrom-Json
$projectConfig.appid = 'wx5fc99e93e4a3c0ef'
[IO.File]::WriteAllText($projectConfigPath,($projectConfig | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
# Whitelisted backend contents only: never package .env, data, local history or node_modules.
$backendZip = Join-Path $outputRoot "waiqi-cloudrun-$stamp.zip"
$miniZip = Join-Path $outputRoot "waiqi-miniprogram-$stamp.zip"
# Use ZIP-standard forward slashes; PowerShell Compress-Archive emits backslashes
# on Windows, which Linux unpackers report as nonstandard archive paths.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
function New-PortableZip([string]$sourceDirectory, [string]$destinationZip) {
    $sourcePrefix = [IO.Path]::GetFullPath($sourceDirectory).TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::Open($destinationZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse -Force) {
            $entryName = $file.FullName.Substring($sourcePrefix.Length).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose() }
}
New-PortableZip $backend $backendZip
New-PortableZip $mini $miniZip
Write-Output "Backend: $backendZip"
Write-Output "Mini-program directory: $mini"
Write-Output "Mini-program archive: $miniZip"
