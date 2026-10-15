$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$runtimeNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $runtimeNode = $nodeCommand.Source }
if (-not (Test-Path -LiteralPath $runtimeNode)) { throw '请安装 Node.js 24 或更高版本。' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'dist/index.html')) { throw '请先安装依赖并运行 pnpm build。' }
& $runtimeNode --env-file-if-exists=.env server/index.mjs
