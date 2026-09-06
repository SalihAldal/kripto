# KRIPTO ER02 - FEATURE CONTRACT & ROUTER INPUT RECOVERY REPORT

## Executive Verdict

- `PHASE2_VERDICT=PASS`
- `OVERALL_ENGINEERING_READINESS=PARTIAL`
- `NEXT_PAPER_PREFLIGHT=NO_GO`
- `PROFITABILITY_EVIDENCE=NOT_EVALUATED`

## İncelenen Sürüm ve Çalışma Kopyası

- HEAD: `a85a04677acc8dba27af3362f238f86a1d463ea5`
- Branch: `main`
- Worktree: `DIRTY`
- Node/NPM: `v24.13.0` / `11.6.2`
- Disk: `C:` boş alan yaklaşık `480.78 GB`

## Prompt 1 Bağımlılık Kontrolü

- ER01 contract kodu ve rapor çıktıları tekrar doğrulandı.
- `resolveTerminalEvidence`, `summarizeFunnel`, `evaluateRecoveryAssessment` aktif ve testli.
- Faz 2’de ER01’e sadece uyumluluk tüketici kontrolü yapıldı; ER01 contract geriye dönük bozulmadı.

## Düzeltilen Üretim Akışı

- `src/server/execution/execution-orchestrator.service.ts`
  - P4 router/regime input inşası, ad-hoc defaults yerine `buildFeatureContractSnapshot()` ile tek noktadan yapılır.
  - `ai.score -> expectedMovePercent` fallback kaldırıldı.
  - `featureContract` çıktısı metadata’ya eklenerek gözlemlenebilirlik güçlendirildi.
- `src/server/execution/er02-feature-contract.ts` (yeni)
  - Versioned contract: `er02-feature-contract-v1`.
  - Feature quality: `VALID/MISSING/STALE/INVALID`.
  - SourceType ayrımı: `LIVE_MARKET/RECORDED_REPLAY/SYNTHETIC_FIXTURE/UNKNOWN`.
  - Timestamp freshness/future-skew kontrolü.
  - Unit dönüşümleri: spread percent->bps, liquidity 0-100->0-1 (tek dönüşüm), slippage bps->percent.
  - Expected move kaynak kuralı ve horizon mismatch kontrolü.
- `src/server/forensics/p4-regime-strategy-shadow.ts`
  - `invalidFeatures` eklendi.
  - Strategy-specific required features devreye alındı.
  - Eksik/stale/invalid durumları yalnız ilgili stratejiyi etkiler.
- `src/server/microstructure/microstructure-engine.ts`
  - Strategy/regime alanları producer metadata’ya taşındı.
  - Source/schema/version/timestamp alanları metadata’ya eklendi.
- `src/server/opportunity/opportunity-engine.ts`
  - Producer metadata feature alanları ve schema/version bilgileri eklendi.

## Producer -> Consumer Feature Mapping (özet)

| Router Alanı | Producer | Ham Birim | Adapter Birimi | Kural |
|---|---|---|---|---|
| `spreadBps` | `context.spreadPercent` | percent | bps | `percent * 100`, tek dönüşüm |
| `liquidityScore` | `metadata.liquidityScore` | `0..100` veya `0..1` | `0..1` | `<=1` direkt, `<=100` `/100`, aksi INVALID |
| `acceleration` | `metadata.priceAcceleration` | normalized ratio | normalized ratio | finite değilse INVALID |
| `volumeAcceleration` | `metadata.volumeAcceleration` | ratio | ratio | finite değilse INVALID |
| `relativeStrength` | `metadata.relativeStrength` | ratio | ratio | finite değilse INVALID |
| `momentum` | `metadata.shortMomentumPercent` | percent | percent | missing/stale görünür |
| `breakoutHeld` | `metadata.breakoutHeld` | boolean | boolean | `false` ile `missing` ayrıdır |
| `expectedMovePercent` | metadata veya `analysisScorecard` | percent | percent | `ai.score` fallback yok |
| `entryFee/exitFee` | `metadata.takerFeePercent` | percent | percent | yoksa MISSING (0 varsayılmaz) |
| `entrySlippage/exitSlippage` | `metadata.expectedSlippageBps` | bps | percent | `/100` |
| `pumpScore` | `metadata.pumpScore` | `0..1` | `0..1` | `pumpRisk` yerine strength alanı |

## Hata -> Düzeltme Özeti

- Default doldurma ile gizlenen eksik alanlar kaldırıldı; `missingFeatures/staleFeatures/invalidFeatures` üretiliyor.
- `expectedMovePercent` için kalite skorundan türetim kaldırıldı.
- Liquidity normalize kuralı düzeltildi (`40` ve `80` artık farklı).
- Timestamp yok/future/stale senaryoları quality ile raporlanıyor.
- Replay/synthetic source bilgisi kaybolmuyor.
- Strategy-specific gereksinimler ile `breakoutHeld` eksikliği EARLY’yi gereksiz bloklamıyor.

## Strateji Bazlı Required Feature Durumu

- `EARLY_ACCELERATION`: `velocity`, `acceleration`, `volumeAcceleration`, `relativeStrength`
- `MOMENTUM_CONTINUATION`: `momentum`, `acceleration`, `flowRecovery`
- `BREAKOUT_RETEST`: `breakoutHeld`, `flowRecovery`, `acceleration`
- `STEADY_TREND`: `relativeStrength`, `exhaustion`, `spreadBps`
- `RANGE_MEAN_REVERSION`: `rangeScore`, `distanceFromMean`, `flowRecovery`, `retracement`
- Ortak required: expected move + cost inputları + liquidity + marketEventAt

## Test Kanıtları

- Focused ER02 suite:
  - `tests/er02-feature-contract-and-router-input.test.ts` (30 test)
  - Producer->router zinciri, unit/timestamp/source/strategy/cost kontrolleri
- ER01/P4/P7 regression:
  - `tests/er01-telemetry-verdict.test.ts`
  - `tests/p4-regime-strategy-shadow.test.ts`
  - `tests/p7-paper-only-activation.test.ts`
- Producer/selection regression:
  - `tests/phase04-microstructure-engine.test.ts`
  - `tests/p1-round-selection-event-driven.test.ts`

## Çalıştırılan Komutlar ve Exit Code

- `npm run test:run -- tests/er02-feature-contract-and-router-input.test.ts tests/p4-regime-strategy-shadow.test.ts tests/p7-paper-only-activation.test.ts tests/er01-telemetry-verdict.test.ts` -> `exit 0` (3 ardışık tekrar)
- `npm run test:run -- tests/phase04-microstructure-engine.test.ts tests/p1-round-selection-event-driven.test.ts` -> `exit 0`
- `npm run typecheck` -> `exit 0`
- `npm run build` -> `exit 0`

## Doğrulanmayan / Sınır Nedeniyle Çalıştırılmayan

- Paper campaign / auto-round run / live trading / exchange order: `NOT_RUN` (bilinçli, faz sınırı).
- Dış DB bağımlı auto-round integration (`ER01-K`) bu fazda yeniden açılmadı.

## Prompt 3 Handoff

- Canonical input authority artık `featureContract` üzerinden taşınıyor; doğrudan dağınık metadata okuyucuları Prompt 3’te temizlenmeli.
- Regime authority katmanları hâlâ çift kaynaklı (legacy regime metadata + P4 evaluator).
- Missing measured fee/transition data senaryoları bilinçli olarak MISSING bırakılıyor; policy gevşetilmedi.
