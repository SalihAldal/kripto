param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$AppToken = "",
  [string]$Symbol = "BTCUSDT",
  [switch]$SkipTrade,
  [switch]$AllowReadyFail,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function New-Headers {
  param([string]$Token)

  $headers = @{}
  $headers["x-forwarded-for"] = "smoke-$([Guid]::NewGuid().ToString('N'))"
  if ($Token -and $Token.Trim().Length -gt 0) {
    $headers["x-kinetic-token"] = $Token
  } else {
    # Local smoke for same-origin internal flow.
    $headers["x-kinetic-internal"] = "1"
    $headers["sec-fetch-site"] = "same-origin"
  }
  return $headers
}

function Invoke-Check {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    [object]$Body = $null,
    [switch]$AllowNoOkField
  )

  $url = "$BaseUrl$Path"
  if ($DryRun) {
    Write-Host "[DRY] $Method $url" -ForegroundColor Yellow
    return $true
  }

  $attempt = 0
  $maxAttempts = 3
  while ($attempt -lt $maxAttempts) {
    try {
      if ($Method -eq "GET") {
        $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $Headers
      } else {
        $jsonBody = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 8 -Compress }
        $resp = Invoke-RestMethod -Uri $url -Method Post -Headers $Headers -ContentType "application/json" -Body $jsonBody
      }

      $hasOk = $null -ne $resp.PSObject.Properties["ok"]
      if ($hasOk) {
        if ($resp.ok -ne $true) {
          Write-Host "[FAIL] $Method $Path -> ok=false" -ForegroundColor Red
          return $false
        }
        Write-Host "[PASS] $Method $Path -> ok=true" -ForegroundColor Green
        return $true
      }

      if ($AllowNoOkField) {
        Write-Host "[PASS] $Method $Path -> 200 (ok field yok)" -ForegroundColor Green
        return $true
      }

      Write-Host "[FAIL] $Method $Path -> ok field yok" -ForegroundColor Red
      return $false
    } catch {
      $statusCode = $null
      if ($_.Exception.Response) {
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = $null }
      }
      if ($statusCode -eq 429 -and $attempt -lt ($maxAttempts - 1)) {
        Start-Sleep -Milliseconds (600 * ($attempt + 1))
        $attempt++
        continue
      }
      $msg = $_.Exception.Message
      Write-Host "[FAIL] $Method $Path -> $msg" -ForegroundColor Red
      return $false
    }
  }
  return $false
}

Write-Host ""
Write-Host "== KINETIC STAGING SMOKE ==" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"
if ($DryRun) {
  Write-Host "Mode: DRY RUN" -ForegroundColor Yellow
}
Write-Host ""

$headers = New-Headers -Token $AppToken
$results = @()

$results += Invoke-Check -Method "GET" -Path "/api/health/live" -Headers $headers -AllowNoOkField
$ready = Invoke-Check -Method "GET" -Path "/api/health/ready" -Headers $headers -AllowNoOkField
if ($AllowReadyFail -and -not $ready) {
  Write-Host "[WARN] /api/health/ready localde skip edildi." -ForegroundColor Yellow
  $ready = $true
}
$results += $ready
$results += Invoke-Check -Method "GET" -Path "/api/health" -Headers $headers
Start-Sleep -Milliseconds 200
$results += Invoke-Check -Method "GET" -Path "/api/dashboard/overview" -Headers $headers
Start-Sleep -Milliseconds 200
$results += Invoke-Check -Method "GET" -Path "/api/system/status" -Headers $headers
Start-Sleep -Milliseconds 200
$results += Invoke-Check -Method "GET" -Path "/api/risk/status" -Headers $headers
Start-Sleep -Milliseconds 200
$results += Invoke-Check -Method "POST" -Path "/api/ai/consensus" -Headers $headers -Body @{ symbol = $Symbol }
Start-Sleep -Milliseconds 200

if (-not $SkipTrade) {
  $results += Invoke-Check -Method "POST" -Path "/api/trades/open" -Headers $headers -Body @{ symbol = $Symbol; quantity = 0.05 }
}

$failed = ($results | Where-Object { $_ -eq $false }).Count
Write-Host ""
if ($failed -gt 0) {
  Write-Host "Smoke test tamamlandi: $failed adim basarisiz." -ForegroundColor Red
  exit 1
}

Write-Host "Smoke test tamamlandi: tum adimlar basarili." -ForegroundColor Green
exit 0
