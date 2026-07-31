param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectRoot "deploy"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Push-Location $ProjectRoot
try {
  Write-Host "Building with webpack (local)..."
  $env:NODE_OPTIONS = "--max-old-space-size=4096"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}
finally {
  Pop-Location
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$zipName = "kriptopaneli-build-$timestamp.zip"
$zipPath = Join-Path $OutputDir $zipName

$paths = @(
  ".next/standalone",
  ".next/static",
  ".next/BUILD_ID",
  "public",
  "scripts/postbuild-standalone.cjs"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

foreach ($rel in $paths) {
  $src = Join-Path $ProjectRoot ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $src)) {
    Write-Warning "Skip missing: $rel"
    continue
  }
  if ((Get-Item $src).PSIsContainer) {
    Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
      $entryRel = ($_.FullName.Substring($ProjectRoot.Length).TrimStart("\", "/")).Replace("\", "/")
      $entry = $archive.CreateEntry($entryRel, [System.IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      try {
        $fs = [System.IO.File]::OpenRead($_.FullName)
        try { $fs.CopyTo($entryStream) } finally { $fs.Close() }
      } finally { $entryStream.Close() }
    }
  } else {
    $entry = $archive.CreateEntry($rel.Replace("\", "/"), [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
      $fs = [System.IO.File]::OpenRead($src)
      try { $fs.CopyTo($entryStream) } finally { $fs.Close() }
    } finally { $entryStream.Close() }
  }
}

$archive.Dispose()
$stream.Close()

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Build zip hazir: $zipPath ($sizeMb MB)"
Write-Host ""
Write-Host "UYARI: Windows build Prisma binary Linux'ta calismaz."
Write-Host "VPS'te build icin: npx next build --webpack (asagidaki adimlar)"
Write-Host ""
Write-Host "scp `"$zipPath`" root@76.13.138.159:/tmp/"
Write-Host "ssh root@76.13.138.159 'cd /var/www/kriptopaneli && unzip -o /tmp/$zipName'"
