$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

function Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Step "Node modules kontrolu"
if (-not (Test-Path "node_modules")) {
  npm ci
}

Step "Postgres servisini baslatma"
docker compose up -d postgres

Step "Prisma migrate deploy"
npm run prisma:migrate:deploy

Step "Prisma client generate"
npm run prisma:generate

Step "Next dev server baslatiliyor"
npm run dev
