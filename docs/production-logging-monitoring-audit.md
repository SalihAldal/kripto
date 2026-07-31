# Production Logging, Monitoring ve Audit

Bu dokuman, trading sistemindeki kritik olaylarin production-grade izlenmesi icin eklenen yapilari ozetler.

## 1) Structured Logging

Yeni helper: `src/server/observability/structured-log.ts`

Zorunlu alanlar:
- `requestId`
- `userId`
- `sessionId`
- `orderId`
- `transactionId`
- `symbol`
- `actionType`
- `timestamp`
- `status`
- `errorCode`
- `errorDetail`

Log seviyeleri: `DEBUG`, `INFO`, `WARN`, `ERROR`

Not:
- Spam engelleme icin sadece kritik eventler persistent log'a yazilir.
- Hassas alanlar `lib/logger.ts` redaction kurallariyla maskelenir.

## 2) Kritik Olaylar

Event bus ve route katmaninda asagidaki actionType'lar uretilir:
- `analysis_started`
- `shortlist_created`
- `coin_selected`
- `buy_order_placed`
- `buy_completed`
- `sell_order_created`
- `sell_completed`
- `stop_loss_triggered`
- `round_completed`
- `api_error`
- `retry_triggered`
- `manual_cancel`
- `recovery_after_restart`

## 3) Audit Log

Endpoint: `GET /api/audit`

Audit kayitlari:
- Ayar degisiklikleri (`settings.trading`, `risk.config`)
- Oto tur baslatma/durdurma
- Manuel trade tetikleme/iptal/kapatma

## 4) Monitoring

Endpoint: `GET /api/monitoring`

Metrikler:
- `activeOpenPositions`
- `pendingOrders`
- `failedOrders`
- `apiErrorRatePercent`
- `tradesLast24h`
- `workerHealth`
- `queueBacklog`
- `lastSuccessfulAnalysisAt`
- `criticalAlarms`

## 5) UI

Guncellenen ekranlar:
- `app/(platform)/system-command/page.tsx`
  - Monitoring snapshot kartlari
  - Kritik alarmlar
  - Audit log tablosu
- `app/(platform)/logs/page.tsx`
  - Filtreli log goruntuleme (`actionType`, `status`, `symbol`, `hasError`)

## 6) DB ve Index

Migration:
- `prisma/migrations/20260421123000_structured_logging_upgrade/migration.sql`

Ek indexler:
- SystemLog `createdAt`
- SystemLog context alanlari (`actionType`, `status`, `symbol`)
- AuditLog `action+createdAt`, `entityType+createdAt`

## 7) Ornek Log Kayitlari

```json
{
  "source": "trades-open-route",
  "actionType": "manual_trade_triggered",
  "status": "SUCCESS",
  "requestId": "2e01...",
  "userId": "cm1...",
  "transactionId": "d8b7...",
  "symbol": "BTCUSDT",
  "timestamp": "2026-04-21T11:35:19.123Z"
}
```

```json
{
  "source": "api",
  "actionType": "api_error",
  "status": "FAILED",
  "requestId": "f3a0...",
  "errorCode": "EXTERNAL_SERVICE_ERROR",
  "errorDetail": "Binance timeout",
  "timestamp": "2026-04-21T11:38:41.512Z"
}
```
