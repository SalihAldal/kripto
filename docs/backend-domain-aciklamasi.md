# Backend Domain Aciklamasi

Bu domain modeli, trading platformunun ana sorgu hatlarini performansli sekilde desteklemek icin tasarlandi.

## Ana Domainler

- **Identity & Access**
  - `User`, `AuditLog`, `AppSetting`
- **Exchange & Market**
  - `ExchangeConnection`, `TradingPair`, `MarketSnapshot`
- **AI Karar Katmani**
  - `AiProvider`, `AiModelConfig`, `ScannerResult`, `TradeSignal`
- **Execution & Position**
  - `TradeOrder`, `TradeExecution`, `Position`, `ProfitLossRecord`
- **Risk & Strategy**
  - `RiskConfig`, `StrategyConfig`
- **Observability**
  - `SystemLog`, `AuditLog`

## Sorgu Senaryolari

- Trade gecmisi: `TradeOrder` + `TradeExecution` + `TradingPair`
- AI karar gecmisi: `TradeSignal` + `AiModelConfig` + `AiProvider`
- Sistem loglari: `SystemLog` (source/level/time indexli)
- Risk ayarlari: `RiskConfig` (user bazli unique)
- Acik pozisyonlar: `Position` (`status = OPEN`) + `TradeOrder`

## Tasarim Notlari

- Tum modellerde `id`, `createdAt`, `updatedAt` standardize.
- Enumlar ile side/type/status gibi alanlar guclu tiplenmis.
- Hata mesaji alanlari kritik modellerde mevcut (`errorMessage`, `rejectReason`, `lastErrorMessage`).
- JSON metadata ile provider veya strategy farkliliklari esnek tutuldu.
