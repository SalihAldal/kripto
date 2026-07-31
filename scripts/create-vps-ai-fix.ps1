param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ZipName = "kriptopaneli-ai-fix.zip"
)

$roots = @(
  "src/server/ai",
  "src/server/scanner",
  "src/server/simulation"
)

& (Join-Path $PSScriptRoot "create-vps-deploy-zip.ps1") `
  -ProjectRoot $ProjectRoot `
  -ZipName $ZipName `
  -DependencyRootsOnly `
  -DependencyRoots $roots `
  -SkipDependencyRoots
