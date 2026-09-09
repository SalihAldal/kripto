# Ekonomik Strateji Kimliği ve Üretim Sınırı

Bu belge **çalışan 12h paper** (`paper-12h-post-fix-2026-09-10T01-08-00Z`, job `cmtung3ii000dunyklzmdpt7g`) ile **tarihsel replay/araştırma** yolunu ayırır. Paper ortasında strateji değiştirilmez.

## Çalışan paper — gerçek üretim karar yolu

| Katman | Bileşen | Durum |
|--------|---------|--------|
| Universe | `market-data-daemon` → Binance TR exchangeInfo, TRY+USDT filtre | **Aktif** |
| Scanner | `OpportunityEngine.scan()` + `MicrostructureEngine` | **Aktif** |
| Arka plan | `pump-early-catcher`, `top-gainer-discovery` (watchlist/metadata) | **Aktif** — doğrudan round selection'da `getPumpFastEntry` çağrılmıyor |
| Seçim | `runCooperativeRoundSelection` → canonical candidate store | **Aktif** |
| Learning lane | `aiMode: learning`, pre-trade memory **advisory** (`P1`) | **Aktif** — hard veto yalnızca gerçek risk vetosu |
| AI | `runAIConsensusFromInput`, gate `ADVISORY` | **Aktif** |
| Strateji router | P4: `EARLY_ACCELERATION`, `MOMENTUM_CONTINUATION`, `BREAKOUT_RETEST`, `STEADY_TREND`, `RANGE_MEAN_REVERSION` | **Aktif** |
| Bot/strategy weights | `frozen-strategy-snapshot.json` (rsi-macd 58, volume-spike 60, scalping 58, trend 66, breakout-volume 64) | **Dondurulmuş** |
| TDC / OI | `TRADE_DECISION_CORE_ENABLED=false` | **Kapalı** |
| Entry (paper) | Orchestrator + smart-entry + quality gates | **Aktif** |
| Sembol | USDT sinyal → TRY execution (`resolvePaperExecutionSymbol`) | **Aktif** |
| Exit | Smart-exit, trailing, `maxDurationSec=600`, paper soft-exit deferral | **Aktif** — PR04 yalnızca env ile |
| Settlement | `post-trade-settlement` + learning memory toplama | **Aktif** |

## Tarihsel replay — gerçekten ne çalışıyor?

| Bileşen | Replay | Üretimle eşdeğer? |
|---------|--------|-------------------|
| `evaluateEntrySignal` / OI V1-V2 | Gerçek (UM OI + funding) | **Hayır** — paper'da OI kapalı |
| `evaluateLocalConfirmedEntry` | Gerçek (TRY 1m + UM 1h) | **Kısmi** — P4 router/AI/scanner yok |
| `evaluateEconBreakoutEntry` (bu branch) | Gerçek (TRY 1m + saatlik bar) | **Kısmi** — yalnızca giriş hipotezi |
| `runTrySpotReplayUniverse` | Gerçek portföy simülasyonu | **Kısmi** — kapalı bar, order book yok |
| OpportunityEngine / Microstructure | **Yok** | **Hayır** |
| AI consensus | **Yok** | **Hayır** |
| Haber / order book / liquidation | **Yok** — uydurulmaz | **Hayır** |

## OI ailesi — ölçülen vs üretim

- **Ölçülen:** `STRATEGY_VARIANTS` (5 OI varyantı) yalnızca `KRIPTO_DEEP_DATASET` (10 sembol, 365 gün) üzerinde replay.
- **Üretim paper'da ölçülmemiş:** Geniş altcoin scanner, pump lane, microstructure, AI advisory, P4 router.
- **OI başarısızlığı ≠ scanner başarısızlığı** — ayrı failure domain.

## Bu branch'teki hipotez bütçesi (sınırlı, önceden tanımlı)

1. **econ_breakout_rs** — hacim + göreli güç destekli kırılma/devam (TRY onaylı).
2. **econ_pullback_reclaim** — kırılma sonrası ilk kontrollü geri çekilme + reclaim.

OI yalnızca karşılaştırma baseline olarak raporlanır; hipotez olarak varsayılmaz.

## Veri kapsamı

- `KRIPTO_DEEP_DATASET`: 10 büyük coin — **altcoin scanner doğrulamaz**.
- `KRIPTO_ECON_TRY_DATASET`: Binance TR type-1 TRY çiftleri, likidite ekranı, listing/survivorship metadata (`build-econ-try-universe-dataset.ts`).

## Kabul ve teslim

- Kabul: `STRATEGY_ACCEPTANCE` değiştirilmez.
- Geçen aday: bu branch'te kod + sabit parametreler + `artifacts/econ-strategy-experiments.json`.
- Geçmeyen: üretime alınmaz; paper'a dokunulmaz.
