# Production Grade Entegrasyon Rehberi

Bu dokuman, Binance TR baglantili sistemde asagidaki 6 modulu tek bir state-safe production akisinda birlestirir:

1. Satis bug fix
2. Alim-satim emir gorunurlugu
3. PnL raporlama (gunluk/haftalik/aylik/ozel tarih)
4. Tur bazli otomatik al-sat
5. Cok katmanli AI analiz motoru
6. Risk kontrollu agresif optimizasyon

## 1) Veritabani Degisiklikleri ve Migrationlar

### Mevcut migrationlar

- `prisma/migrations/20260401211746_init/migration.sql`
- `prisma/migrations/20260421195000_add_trade_lifecycle_event/migration.sql`
  - `TradeLifecycleEvent` tablosu (persist event timeline)
- `prisma/migrations/20260421200500_add_auto_round_job/migration.sql`
  - `AutoRoundJob`, `AutoRoundRun` tablolari (tur motoru state machine)

### Onemli tablolar

- `TradeOrder`, `TradeExecution`, `Position`, `ProfitLossRecord`
- `TradeLifecycleEvent`
- `AutoRoundJob`, `AutoRoundRun`
- `RiskConfig`, `AppSetting` (risk breaker, paused state, api failure state)

## 2) Backend Servis Yapisi (Modul Bazli)

### 2.1 Satis bug fix / order guvenligi

- `src/server/execution/post-trade-settlement.service.ts`
- `src/server/repositories/execution.repository.ts`
- `src/server/execution/execution-orchestrator.service.ts`

Uygulananlar:
- pending close order tespiti
- duplicate sell/order engeli
- fill teyidi olmadan CLOSED yazmama
- close hata siniflandirma (min_notional, step, api, timeout vb.)
- race condition ve partial fill guvencesi

### 2.2 Islem gorunurlugu / event log

- `src/server/execution/execution-event-bus.ts`
- `src/server/repositories/trade-lifecycle.repository.ts`
- `app/api/trades/events/route.ts`
- `app/api/trades/stream/route.ts`
- `app/api/trades/fast-entry/route.ts`

Uygulananlar:
- SSE + persisted lifecycle event
- scanner/buy/sell timeline
- error/reject reason kodlari
- sayfa yenilense de event kaybi olmamasi

### 2.3 PnL modulu

- `src/server/reports/pnl-report.service.ts`
- `app/api/reports/pnl/route.ts`
- `app/api/reports/pnl/export/route.ts`
- `app/(platform)/pnl-report/page.tsx`
- `src/features/trading/components/pnl-report-dashboard.tsx`

Uygulananlar:
- period filtreleri (daily/weekly/monthly/custom)
- coin, ai, mode filtreleri
- realized/unrealized ayrimi
- fee dahil net pnl
- CSV/Excel export

### 2.4 Tur bazli otomatik al-sat

- `src/server/execution/auto-round-engine.service.ts`
- `src/server/repositories/auto-round.repository.ts`
- `app/api/trades/rounds/start/route.ts`
- `app/api/trades/rounds/stop/route.ts`
- `app/api/trades/rounds/status/route.ts`
- `src/features/dashboard/components/auto-round-control-panel.tsx`

Uygulananlar:
- tek aktif tur motoru
- scan -> sec -> buy -> sell wait -> close -> next round
- acik pozisyon varken yeni round trade yok
- restart recovery

### 2.5 AI consensus engine (cok katmanli)

- `src/server/ai/indicator-suite.ts`
- `src/server/ai/hybrid-decision-engine.ts`
- `src/server/ai/analysis-orchestrator.ts`
- `src/server/scanner/ai-request-formatter.ts`
- `src/types/ai.ts`

Uygulananlar:
- AI-1 teknik, AI-2 sentiment/momentum, AI-3 risk
- role score + composite score + veto
- aciklanabilir `decisionPayload` ve `roleScores`
- rule-based + AI hybrid karar

### 2.6 Risk kontrollu agresif optimizasyon

- `src/server/risk/risk-evaluation.service.ts`
- `src/server/risk/risk-status.service.ts`
- `src/server/repositories/risk.repository.ts`
- `src/server/execution/signal-quality-gate.service.ts`
- `src/server/execution/smart-targeting.service.ts`
- `src/server/execution/execution-orchestrator.service.ts`
- `src/server/execution/position-monitor.service.ts`
- `app/api/risk/config/route.ts`
- `app/api/risk/status/route.ts`

Uygulananlar:
- max risk per trade (% capital)
- max daily/weekly loss breaker
- stop-loss required gate
- kalitesiz sinyal eleme
- smart TP + partial TP plan
- volatility-aware dinamik hedefleme

## 3) Frontend Ekranlari

- Dashboard: `app/(platform)/dashboard/page.tsx`
  - trade flow panel + auto-round panel
- PnL: `app/(platform)/pnl-report/page.tsx`
- Risk: `app/(platform)/risk-management/page.tsx`
- System command/performance: `app/(platform)/system-command/page.tsx`

## 4) Event / Order / Log Takip Akisi

### Event
- publish noktalari:
  - scanner-start/summary/selection
  - buy-order, sell-target, settlement
  - position-monitor, risk-gate, quality-gate
- persistence:
  - `TradeLifecycleEvent`

### Order
- buy/sell lifecycle:
  - create order -> poll status -> execution write -> position update
- duplicate/race guard:
  - pending close order check
  - one-position constraints
  - cooldown ve volatility blocker

### Log
- system log: `SystemLog`
- audit log: `AuditLog`
- lifecycle log: `TradeLifecycleEvent`

## 5) Config Dosyalari

- Runtime config: `lib/config.ts`
- Ornek env: `.env.example`
- Risk update endpoint: `app/api/risk/config/route.ts`

## 6) Test Senaryolari

### Mevcut unit testler
- `tests/core-service.test.ts`
- `tests/scanner.test.ts`
- `tests/risk-engine.test.ts`
- `tests/pnl-calculator.test.ts`
- `tests/mock-provider.test.ts`
- `tests/use-risk-pulse.test.ts`
- `tests/ai-hybrid-engine.test.ts`
- `tests/signal-quality-gate.test.ts`
- `tests/smart-targeting.test.ts`

### Calistirma

```bash
npm run lint
npm run test -- --run
npm run build
```

## 7) Kurulum Notlari (Production)

1. `.env.example` -> `.env` kopyala, production degerlerini gir.
2. DB:
   - `npm run prisma:generate`
   - `npm run prisma:migrate`
3. Seed gerekiyorsa:
   - `npm run prisma:seed`
4. Uygulama:
   - `npm run build`
   - `npm run start`
5. Health:
   - `/api/health/live`
   - `/api/health/ready`
   - `/api/health`

## 8) State-Safe ve Race Condition Koruma Ozet

- Acik pozisyon varken yeni trade engeli
- Pending close order varken yeni close order engeli
- Scanner pause/resume koordinasyonu
- Auto-round tek loop registry
- Exchange status polling ile phantom close engeli
- Risk breaker + API failure cooldown

## 9) Dosya Bazli Degisim Ozet Listesi

### AI ve karar
- `src/server/ai/analysis-orchestrator.ts`
- `src/server/ai/hybrid-decision-engine.ts`
- `src/server/ai/indicator-suite.ts`
- `src/server/scanner/ai-request-formatter.ts`
- `src/types/ai.ts`

### Execution / risk / order
- `src/server/execution/execution-orchestrator.service.ts`
- `src/server/execution/post-trade-settlement.service.ts`
- `src/server/execution/position-monitor.service.ts`
- `src/server/execution/signal-quality-gate.service.ts`
- `src/server/execution/smart-targeting.service.ts`
- `src/server/repositories/execution.repository.ts`
- `src/server/risk/risk-evaluation.service.ts`
- `src/server/risk/risk-status.service.ts`
- `src/server/repositories/risk.repository.ts`

### Lifecycle / visibility
- `src/server/execution/execution-event-bus.ts`
- `src/server/repositories/trade-lifecycle.repository.ts`
- `app/api/trades/events/route.ts`
- `app/api/trades/stream/route.ts`
- `app/api/trades/fast-entry/route.ts`

### PnL
- `src/server/reports/pnl-report.service.ts`
- `app/api/reports/pnl/route.ts`
- `app/api/reports/pnl/export/route.ts`
- `app/(platform)/pnl-report/page.tsx`
- `src/features/trading/components/pnl-report-dashboard.tsx`

### Tur motoru
- `src/server/execution/auto-round-engine.service.ts`
- `src/server/repositories/auto-round.repository.ts`
- `app/api/trades/rounds/start/route.ts`
- `app/api/trades/rounds/stop/route.ts`
- `app/api/trades/rounds/status/route.ts`
- `src/features/dashboard/components/auto-round-control-panel.tsx`

### Config / docs / tests
- `lib/config.ts`
- `.env.example`
- `docs/production-system-integration.md`
- `tests/ai-hybrid-engine.test.ts`
- `tests/risk-engine.test.ts`
- `tests/signal-quality-gate.test.ts`
- `tests/smart-targeting.test.ts`
