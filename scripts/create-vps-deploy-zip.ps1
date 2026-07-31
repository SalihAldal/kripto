param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$OutputDir = "",
  [string]$ZipName = "",
  [string]$FileList = "",
  [string]$ModifiedSince = "",
  [string]$GitBaseRef = "HEAD",
  [switch]$IncludeUntracked,
  [switch]$UseGitOnly,
  [switch]$SkipDependencyRoots,
  [switch]$DependencyRootsOnly,
  [string[]]$DependencyRoots = @(
    "src/server/decision-engine",
    "src/server/discovery",
    "src/server/exchange-simulator",
    "src/server/execution-management",
    "src/server/execution-safety",
    "src/server/learning-engine",
    "src/server/market-intelligence",
    "src/server/observability",
    "src/server/paper-validation",
    "src/server/replay",
    "src/server/repositories",
    "src/server/shadow-validation",
    "src/server/trading-core",
    "src/server/recovery",
    "src/server/notifications",
    "src/server/ai",
    "src/server/scanner",
    "src/server/simulation"
  ),
  [string[]]$IncludeRoots = @(
    "app", "src", "lib", "prisma", "services", "scripts", "components", "types",
    "ecosystem.config.cjs", "next.config.ts", "package.json", "package-lock.json",
    "tsconfig.json", "prisma.config.ts", "middleware.ts"
  )
)

$ErrorActionPreference = "Stop"

function Test-ExcludedPath {
  param([string]$RelativePath)
  $patterns = @(
    "\\node_modules\\",
    "\\\.next\\",
    "\\\.git\\",
    "\\\.cursor\\",
    "\\dist\\",
    "\\coverage\\",
    "\\\.turbo\\",
    "\\\.env$",
    "\\\.env\.",
    "\.log$",
    "\.tmp$",
    "\.dll\.node\.tmp"
  )
  foreach ($pattern in $patterns) {
    if ($RelativePath -match $pattern) { return $true }
  }
  return $false
}

function Get-GitChangedFiles {
  param([string]$Root, [string]$BaseRef, [switch]$Untracked)
  Push-Location $Root
  try {
    git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return @() }

    $files = @()
    $files += git diff --name-only --diff-filter=ACMRTUXB $BaseRef 2>$null
    $files += git diff --name-only --cached --diff-filter=ACMRTUXB 2>$null
    if ($Untracked) {
      $files += git ls-files --others --exclude-standard 2>$null
    }
    return $files | Where-Object { $_ -and $_.Trim() -ne "" } | Sort-Object -Unique
  }
  finally {
    Pop-Location
  }
}

function Get-AllFilesUnderRoots {
  param([string]$Root, [string[]]$Roots)
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($item in $Roots) {
    $full = Join-Path $Root $item
    if (-not (Test-Path $full)) { continue }
    if (-not (Get-Item $full).PSIsContainer) {
      $result.Add($item.Replace("\", "/"))
      continue
    }
    Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      $rel = $_.FullName.Substring($Root.Length).TrimStart("\", "/")
      $result.Add($rel.Replace("\", "/"))
    }
  }
  return $result | Sort-Object -Unique
}

function Get-ModifiedFiles {
  param([string]$Root, [datetime]$Since, [string[]]$Roots)
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($item in $Roots) {
    $full = Join-Path $Root $item
    if (-not (Test-Path $full)) { continue }
    if (-not (Get-Item $full).PSIsContainer) {
      if ((Get-Item $full).LastWriteTime -ge $Since) {
        $result.Add($item.Replace("\", "/"))
      }
      continue
    }
    Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.LastWriteTime -ge $Since) {
        $rel = $_.FullName.Substring($Root.Length).TrimStart("\", "/")
        $result.Add($rel.Replace("\", "/"))
      }
    }
  }
  return $result | Sort-Object -Unique
}

function New-LinuxCompatibleZip {
  param(
    [string]$ZipPath,
    [string]$ProjectRoot,
    [string[]]$RelativeFiles
  )

  if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $stream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::Create)
  $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

  foreach ($rel in $RelativeFiles) {
    $normalized = ($rel -replace "\\", "/").TrimStart("/")
    $src = Join-Path $ProjectRoot ($normalized -replace "/", [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $src)) { continue }

    $entry = $archive.CreateEntry($normalized, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
      $fileStream = [System.IO.File]::OpenRead($src)
      try {
        $fileStream.CopyTo($entryStream)
      }
      finally {
        $fileStream.Close()
      }
    }
    finally {
      $entryStream.Close()
    }
  }

  $archive.Dispose()
  $stream.Close()
}

function Resolve-DeployFiles {
  param([string]$Root)
  $files = @()

  if ($DependencyRootsOnly) {
    return Get-AllFilesUnderRoots -Root $Root -Roots $DependencyRoots
  }

  if ($FileList -and (Test-Path $FileList)) {
    $files = Get-Content $FileList | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith("#") }
  }
  elseif (Test-Path (Join-Path $Root ".git")) {
    $files = Get-GitChangedFiles -Root $Root -BaseRef $GitBaseRef -Untracked:$IncludeUntracked
    if ($UseGitOnly) { return $files }
    if ($files.Count -eq 0 -and $ModifiedSince) {
      $files = Get-ModifiedFiles -Root $Root -Since ([datetime]$ModifiedSince) -Roots $IncludeRoots
    }
  }
  elseif ($ModifiedSince) {
    $files = Get-ModifiedFiles -Root $Root -Since ([datetime]$ModifiedSince) -Roots $IncludeRoots
  }
  else {
    throw "Git repo yok. -ModifiedSince '2026-07-01' veya -FileList manifest.txt kullanin."
  }

  if (-not $SkipDependencyRoots -and $DependencyRoots.Count -gt 0) {
    $files += Get-AllFilesUnderRoots -Root $Root -Roots $DependencyRoots
  }

  return $files | Where-Object {
    $_ -and -not (Test-ExcludedPath $_) -and (Test-Path (Join-Path $Root ($_ -replace "/", "\")))
  } | Sort-Object -Unique
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectRoot "deploy"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
if (-not $ZipName) {
  $ZipName = "kriptopaneli-delta-$timestamp.zip"
}
$zipPath = Join-Path $OutputDir $ZipName
$manifestPath = Join-Path $OutputDir ($ZipName -replace "\.zip$", ".manifest.txt")

$relativeFiles = @(Resolve-DeployFiles -Root $ProjectRoot)
if ($relativeFiles.Count -eq 0) {
  throw "Zip icin dosya bulunamadi."
}

$missing = New-Object System.Collections.Generic.List[string]
$existingFiles = New-Object System.Collections.Generic.List[string]
foreach ($rel in $relativeFiles) {
  $src = Join-Path $ProjectRoot ($rel -replace "/", "\")
  if (-not (Test-Path $src)) {
    $missing.Add($rel)
    continue
  }
  $existingFiles.Add($rel)
}

$relativeFiles = @($existingFiles)
$relativeFiles | Set-Content -Path $manifestPath -Encoding UTF8

New-LinuxCompatibleZip -ZipPath $zipPath -ProjectRoot $ProjectRoot -RelativeFiles $relativeFiles
$copied = $relativeFiles.Count

$zipSizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)

Write-Host ""
Write-Host "VPS deploy zip hazir."
Write-Host "  Proje     : $ProjectRoot"
Write-Host "  Zip       : $zipPath"
Write-Host "  Manifest  : $manifestPath"
Write-Host "  Dosya     : $copied"
Write-Host "  Eksik     : $($missing.Count)"
Write-Host "  Boyut     : $zipSizeMb MB"
Write-Host ""
Write-Host "VPS hedef   : /var/www/kriptopaneli"
Write-Host "Ornek kurulum:"
Write-Host "  scp `"$zipPath`" root@76.13.138.159:/tmp/"
Write-Host "  ssh root@76.13.138.159 'cd /var/www/kriptopaneli && unzip -o /tmp/$ZipName'"
Write-Host ""
Write-Host "Not: Zip Linux uyumlu (forward slash). Dependency modulleri otomatik dahil."
Write-Host ""

if ($missing.Count -gt 0) {
  Write-Warning "Eksik dosyalar manifestte listelenmedi; kopyalanamadi: $($missing.Count)"
}
