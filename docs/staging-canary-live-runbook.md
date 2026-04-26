# Staging -> Canary -> Live Runbook

Bu dokuman release gate'i team lead seviyesinde standartlastirmak icin hazirlandi.
Amac: staging dogrulama, canary kontrollu gecis ve full live aktivasyonunu risksiz yapmak.

## 1) Staging QA Checklist

### 1.1 Ortam ve baglanti
- [ ] `.env` degerleri staging profilinden yuklendi
- [ ] `DATABASE_URL` staging DB'ye bakiyor
- [ ] `REDIS_URL` staging Redis'e bakiyor
- [ ] `BINANCE_ENV=testnet`
- [ ] `EXECUTION_MODE=paper` (veya `dry-run`)
- [ ] `APP_TOKEN` set edildi

### 1.2 Build + kalite gate
- [ ] `npm install`
- [ ] `npm run prisma:generate`
- [ ] `npm run prisma:migrate:deploy`
- [ ] `npm run prisma:seed`
- [ ] `npm run qa:gate`

### 1.3 API smoke test
- [ ] `GET /api/health/live` -> 200
- [ ] `GET /api/health/ready` -> 200
- [ ] `GET /api/health` -> heartbeat/circuit dolu
- [ ] `GET /api/dashboard/overview` -> `ok:true`
- [ ] `GET /api/system/status` -> `ok:true`
- [ ] `GET /api/risk/status` -> `ok:true`
- [ ] `POST /api/ai/consensus` -> `ok:true`
- [ ] `POST /api/trades/open` -> `ok:true` (reject de olsa kontrollu olmali)

PowerShell smoke script:
```bash
npm run smoke:staging
```

Token gerekiyorsa:
```bash
powershell -ExecutionPolicy Bypass -File .\scripts\staging-smoke.ps1 -BaseUrl "https://staging.your-domain.com" -AppToken "your-app-token"
```

Localde DB/Redis bagli degilse:
```bash
npm run smoke:staging -- -AllowReadyFail
```

### 1.4 UI smoke test
- [ ] `/dashboard` aciliyor, kartlar doluyor
- [ ] `/market-watch` scanner + orderbook akiyor
- [ ] `/ai-analysis` buton ile consensus geliyor
- [ ] `/risk-management` config kaydediyor
- [ ] `/logs` ekrani loglari listeliyor
- [ ] `/system-command` emergency stop / resume calisiyor
- [ ] mobilde tasma yok (360px)
- [ ] desktop hizalama bozuklugu yok (>=1440px)

### 1.5 Risk ve trade zinciri
- [ ] trade open istegi event stream'e dusuyor (`/api/trades/stream`)
- [ ] risk gate reject durumunda mesaj kontrollu (internal stack yok)
- [ ] emergency stop aktifken yeni trade acilmiyor
- [ ] resume sonrasi trade akisina geri donuluyor

## 2) Canary Gecis Plani

Canary: yeni versiyonun sinirli trafikle canliya alinmasi.

### 2.1 Canary hedefi
- Trafik payi: %5 -> %20 -> %50 -> %100
- Her adimda min. gozlem suresi: 10-15 dk

### 2.2 Canary izlemesi
- [ ] 5xx oraninda artış var mi?
- [ ] `POST /api/trades/open` hata oranı
- [ ] `GET /api/system/status` latency
- [ ] Redis/DB baglanti kopmasi
- [ ] Circuit breaker OPEN artis trendi
- [ ] Risk pause sayisi anormal artiyor mu?

### 2.3 Rollback kosulu
Asagidakilerden biri olursa rollout durdur ve rollback yap:
- 5xx oraninda ani artış
- trade endpointlerinde zincirleme hata
- risk/pause mekanizmasinda beklenmeyen davranis
- health/ready endpointlerinin bozulmasi

## 3) Canliya Cikis Komut Sirasi

Asagidaki sirayi staging ve production ortamina gore ayni mantikla uygula.

### 3.1 Staging komut akisi
```bash
# .env icinde staging degerlerini ayarla
npm install
npm run prisma:generate
npm run release:staging
npm run start
```

### 3.2 Production preflight
```bash
# .env icinde production degerlerini ayarla
npm install --omit=dev
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run qa:gate
```

### 3.3 Production deploy
```bash
npm run build
npm run start
```

Docker kullaniyorsan:
```bash
docker compose up --build -d
```

## 4) Post-deploy Kontrol

Deploy sonrasi ilk 15 dk su kontroller zorunlu:
- [ ] `GET /api/health/live`
- [ ] `GET /api/health/ready`
- [ ] `GET /api/health`
- [ ] `GET /api/dashboard/overview`
- [ ] `POST /api/ai/consensus` (1 sembol)
- [ ] `POST /api/trades/open` (paper/dry-run modunda)
- [ ] `/dashboard` ve `/market-watch` UI kontrolu

## 5) Notlar

- Production'da `EXECUTION_MODE=live` sadece canary adimlari temizse acilmali.
- API key'ler sadece server env tarafinda kalmali.
- Client tarafina token/secrets tasinmamali.
