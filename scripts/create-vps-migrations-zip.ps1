param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$migrationsRoot = Join-Path $ProjectRoot "prisma\migrations"
if (-not (Test-Path $migrationsRoot)) {
  throw "Missing prisma/migrations at $migrationsRoot"
}

$outDir = if ($OutputDir) { $OutputDir } else { Join-Path $ProjectRoot "deploy" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$zipPath = Join-Path $outDir "kriptopaneli-prisma-migrations.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

try {
  $schemaPath = Join-Path $ProjectRoot "prisma\schema.prisma"
  $schemaEntry = $zip.CreateEntry("prisma/schema.prisma")
  $schemaStream = $schemaEntry.Open()
  try {
    $bytes = [System.IO.File]::ReadAllBytes($schemaPath)
    $schemaStream.Write($bytes, 0, $bytes.Length)
  }
  finally {
    $schemaStream.Dispose()
  }

  Get-ChildItem $migrationsRoot -Directory | Sort-Object Name | ForEach-Object {
    $migrationName = $_.Name
    $sqlPath = Join-Path $_.FullName "migration.sql"
    if (-not (Test-Path $sqlPath)) { return }

    $entryPath = "prisma/migrations/$migrationName/migration.sql"
    $entry = $zip.CreateEntry($entryPath)
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($sqlPath)
      $stream.Write($bytes, 0, $bytes.Length)
    }
    finally {
      $stream.Dispose()
    }
  }
}
finally {
  $zip.Dispose()
  $stream.Dispose()
}

$count = (Get-ChildItem $migrationsRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName "migration.sql") }).Count
Write-Host "Created $zipPath ($count migrations + schema.prisma)"
