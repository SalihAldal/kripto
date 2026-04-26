# Production Deployment Rehberi

Bu dokuman, sistemi dev/stage/prod ayrimi ile guvenli sekilde canliya alma adimlarini verir.

## 1) Ortam Ayrimi ve Env

- Development: `.env.development.example`
- Stage: `.env.stage.example`
- Production: `.env.production.example`

Temel prensip:
- `NODE_ENV`: `development` veya `production`
- `APP_ENV`: `dev` / `stage` / `prod`
- Stage ve prod ortamlarinda:
  - `STARTUP_STRICT_ENV=true`
  - `APP_TOKEN`, `APP_TOKEN_NEXT`, `APP_ENCRYPTION_KEY` zorunlu
  - `NEXT_PUBLIC_API_BASE_URL` zorunlu

Deploy oncesi:
```bash
npm run env:check
```

## 2) Build ve Runtime

```bash
npm ci
npm run prisma:generate
npm run build
```

Source map stratejisi:
- `NEXT_DISABLE_BROWSER_SOURCEMAPS=true` ise browser sourcemap kapali.
- `next.config.ts` uzerinden `productionBrowserSourceMaps` kontrol edilir.

## 3) PM2 ile Calistirma

`ecosystem.config.cjs` iki process tanimlar:
- `kinetic-web`
- `kinetic-worker`

Komutlar:
```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
```

## 4) Docker ile Calistirma

Image build:
```bash
docker build -t kinetic-app:latest .
```

Stage/local benzeri:
```bash
docker compose up -d --build
```

Production compose:
```bash
docker compose -f docker-compose.prod.yml up -d
```

`docker/entrypoint.sh` su davranislari destekler:
- `RUN_MIGRATIONS_ON_BOOT=true` => migrate deploy
- `RUN_SEED_ON_BOOT=true` => seed
- `APP_ROLE=web|worker` => web veya worker process baslatma

## 5) Healthcheck ve Readiness

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- Full health: `GET /api/health`

Canliya almadan once:
1. `/api/health/live` => 200
2. `/api/health/ready` => 200
3. `/api/health` iceriginde heartbeat/circuit/recovery durumlarini kontrol et

## 6) Worker / Queue Dayanikliligi

- Worker ayri process olarak kosabilir (`APP_ROLE=worker` + `SCANNER_WORKER_ENABLED=true`).
- PM2/Docker restart policy ile crash sonrasi otomatik ayağa kalkar.
- Job/state kaybi icin mevcut failsafe-recovery mekanizmasi (`runRestartRecovery`) startupta devreye girer.
