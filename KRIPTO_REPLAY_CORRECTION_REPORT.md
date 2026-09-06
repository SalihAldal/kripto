# KRIPTO REPLAY CORRECTION REPORT — Düzeltme 2/2

**Tarih:** 2026-09-06  
**Kapsam:** Context zamanları, gerçek negatif kontrol, kronolojik portföy replay  
**Doğrulanmış hata commit:** `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b`

---

## Fingerprint

| Alan | Değer |
|---|---|
| Başlangıç HEAD | `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b` |
| Final HEAD (uncommitted) | `e0f3ac1df41f0421906d2e315c63e8623f2c7a7b` |
| Final dirty fingerprint (core) | `sha256:replay-correction-v1:30aa687,a3c1a0f,66cf2a3,1e17b33,cbcbb0a,61b3d93` |
| Schema | `fix01-strategy-context-v2` |

---

## Verdict Özeti

| Verdict | Sonuç |
|---|---|
| `REPLAY_CORRECTION_VERDICT` | `PASS` |
| `AVAILABILITY_CAUSALITY_VERDICT` | `PASS` |
| `COUNTERFACTUAL_FILL_VERDICT` | `PASS` |
| `NEGATIVE_CONTROL_IMPLEMENTATION_VERDICT` | `PASS` |
| `PORTFOLIO_TIME_AND_CAPITAL_VERDICT` | `PASS` |
| `MARKET_EXPERIMENT_STATUS` | `NOT_RUN` |
| `PROFITABILITY_EVIDENCE` | `INSUFFICIENT_DATA` |
| `PAPER_CAMPAIGN_STARTED` | `false` |
| `LIVE_AUTHORIZATION` | `DISABLED` |
| `OVERALL_QA_STATUS` | `QA_PENDING` |

---

## 1. Geç Gelen Veri — Önce / Sonra

### Önce
- Trade filtresi `tradeTime || eventTime || receiveTime` ile geçmiş trade’leri erken dahil ediyordu.
- Mum `availableAt = closeTime` (REST geçmiş mumlar kapanış anında biliniyormuş gibi).
- Portföy replay her lifecycle’ın tüm geleceğini önceden hesaplıyordu.
- `tick.applyFill` NONE kararında bile uygulanabiliyordu.
- Negatif kontrol tick’leri ve fill’leri birlikte kaydırıyordu.

### Sonra
- **Trade:** `eventAt <= decisionAt` **ve** `receiveTime <= decisionAt`.
- **Mum:** `availableAt` producer’dan; REST backfill `availableAt = receivedAt`.
- **Partial mum:** yalnızca gözlenen `open` OHLC; `availableAt` zorunlu.
- **Portföy:** global olay kuyruğu (ENTRY → MARKET_TICK kronolojik).
- **Fill:** yalnızca actionable karar veya açık order late-fill.
- **NC:** piyasa tick’leri sabit; yalnızca giriş zamanı/fill yeniden üretilir.

---

## 2. Producer → Availability → Context

```
MarketCandleEvent.receiveTime
  → market-state-store.applyCandle (REST: availableAt=receivedAt)
  → DeepMarketState.klines1m[].availableAt
  → klinesToCausalCandles (availableAt <= decisionAt)
  → pr03-causal-features / strategy evaluators
```

Trade path: `receiveTime` = `tradeAvailableAtMs()`.

---

## 3. Negatif Kontrol

`buildCounterfactualEntryShift()`:
- Piyasa tick timestamp’leri **değişmez**.
- `entryAtMs` ve `fills[]` yeni zamanda quote ile yeniden üretilir.
- `exitTicks` = market ticks where `eventAtMs >= newEntryAt` (market zamanı).
- Eski `applyFill` olayları taşınmaz.
- `computeMaxEntryShiftMs()` ile yeterli exit tick garantisi.

`runCausalEntryShiftNegativeControl()`:
- `implementationVerdict` ve `significanceVerdict` ayrı.
- `marketTimestampsPreserved: true`.

---

## 4. Portföy Karşı Örneği

Fixture (test 23): sermaye 110, max 1 pozisyon.
- A: 10:00 giriş, 11:00 stop fill.
- B: 10:01 aday → `POSITION_LIMIT` (A hâlâ açık).
- B gelecekteki A kapanış sermayesini kullanamaz.

Metrikler ayrı: `endingCapital` (nakit), `endingEquity` (+ unrealizedMtm), `reservedCash`.

---

## 5. Fill Replay Sözleşmesi

`pr04-replay.ts` session modeli:
- `createPr04ExitReplaySession` / `stepPr04ExitReplayTick`.
- Orphan `applyFill` → `FILL_WITHOUT_OPEN_ORDER`.
- Late fill NONE tick’te → açık `openExitOrder` varsa uygulanır.
- `closedAtMs` gerçek kapanış tick’inden.

---

## 6. Test Sonuçları

| Komut | Sonuç |
|---|---|
| `tests/replay-correction.test.ts` ×3 | **7/7 PASS** |
| `tests/fix01-strategy-context-and-invalidation.test.ts` | **32/32 PASS** |
| `tests/pr05-offline-comparison.test.ts` | **36/36 PASS** |
| `tests/pr04-exit-and-position-management.test.ts` | **47/47 PASS** |
| `npm run typecheck` | **exit 0** |

### BLOCKED / NOT_RUN
| Kontrol | Durum |
|---|---|
| `tests/execution-correction.integration.test.ts` (Docker) | `BLOCKED` — Docker daemon kapalı |
| `tests/post-fix-final-qa.integration.test.ts` | `BLOCKED` — Docker |
| Kayıtlı market profitability deneyi | `NOT_RUN` |
| Tam 36-scenario zaman matrisi (tüm maddeler) | `PARTIAL` — odaklı 7 + mevcut FIX01/PR05 |

---

## 7. Geçersizleşen Eski PASS İddiaları

| Eski iddia | Gerçek |
|---|---|
| Causal NC tick shift ile uygulanıyor | Piyasa sabit değildi — **düzeltildi** |
| Portfolio capital constraint replay | Gelecek PnL önceden ekleniyordu — **düzeltildi** |
| applyFill audit path | NONE tick’te orphan fill mümkündü — **düzeltildi** |
| REST mum closeTime availability | Lookahead bias — **düzeltildi** |

---

## 8. Genel QA Handoff Komutları

```bash
# Docker UP olduktan sonra
npm run test:run -- tests/execution-correction.integration.test.ts
npm run test:run -- tests/post-fix-final-qa.integration.test.ts
npm run test:run -- tests/replay-correction.test.ts tests/pr05-offline-comparison.test.ts
npm run typecheck && npm run build
```

---

*Düzeltme 2/2 tamamlandı. Genel QA başlatılmadı.*
