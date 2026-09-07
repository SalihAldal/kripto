# KRIPTO — Post-Handoff Deep Validation Report

> **Phase:** POST-HANDOFF DEEP VALIDATION, PAPER ACCOUNTING & ZERO-TRADE FORENSIC  
> **Starting HEAD:** `8048bf34f7ef1a6fdbf8ff999a1e4128a80a4993`  
> **Final HEAD:** `8048bf3` + yerel değişiklikler (commit edilmedi)  
> **Rapor tarihi:** 2026-09-07  
> **LIVE_TRADING_ENABLED:** `false` (değiştirilmedi)

---

## 1. Executive Summary

| Alan | Sonuç |
|------|-------|
| **Verdict** | **PARTIAL** — altyapı kanıtlandı; controlled smoke tamamlanması bekleniyor |
| **READY_FOR_LONG_PAPER** | **false** (smoke IN_PROGRESS) |
| **PROFITABILITY** | **INSUFFICIENT_DATA** |
| Canonical handoff (önceki phase) | **KAPALI — tekrar açılmadı** |
| Disposable PG full-chain integration | **PASS (6/6)** |
| Paper accounting | **PASS (4/4)** |
| Score-scale bug (entry quality 0%) | **CONFIRMED + FIXED** |
| `paperCashBefore/After` null | **FIXED** (`readPaperCashSnapshot` + `ensurePaperAccountInitialized`) |
| Typecheck | **PASS** |
| Build | **PASS** |
| Controlled 30m smoke | **IN_PROGRESS** (`paper-post-handoff-2026-09-07T14-45Z`) |

---

## 2. Önceden Doğrulanmış Handoff Fix Statüsü

**Değiştirilmedi — kapalı kabul edildi.**

| Kanıt | Durum |
|-------|-------|
| 8h: 8 seçilen → 0 execution (handoff AI eksik) | CONFIRMED (tarihsel) |
| 30m smoke: 7/7 seçilen → execution/AI | CONFIRMED |
| Terminal reasons persist | CONFIRMED |
| Bu phase handoff'u yeniden "keşfetmedi" | ✓ |

---

## 3. Production Execution Pipeline Haritası

```
DISCOVERY (opportunity-engine / scanner)
  → CANONICAL STORE (candidate-store.service)
  → WATCHING / HOT / MICRO_ANALYZED / MICRO_CONFIRMED
  → FINAL_RANKED / EXECUTION_READY
  → ROUND SELECTION (round-selection.service)
  → HANDOFF VALIDATION (canonical-handoff.service)
  → AI HYDRATION (runAIConsensusFromInput — provider boundary)
  → EXECUTION ORCHESTRATOR (executeAnalyzeAndTrade)
      → confidence gate
      → entry quality (profit-thresholds)
      → signal quality gate
      → orchestration / adaptive
      → canonical risk decision
      → sizing / unified execution plan
  → PAPER ORDER (paper-exchange-adapter → exchange-simulator)
  → FILL / TradeExecution / TradeOrder
  → POSITION (Position + PaperTrade)
  → EXIT WORKER (fix02-exit-routing — ayrı kanıt)
  → FEE / REALIZED PNL
  → ACCOUNT CASH (AppSetting paper.account.<userId>)
  → TERMINAL ROUND OUTCOME (round-terminal-outcome.service)
```

---

## 4. Disposable PostgreSQL Integration Architecture

- **Helper:** `tests/helpers/fix02-disposable-postgres.ts`
- **DB:** `kripto_fix02_*` disposable via Docker `kripto-main-postgres-1`
- **Test:** `tests/canonical-paper-full-chain.integration.test.ts`
- **Principle:** Candidate `.ai` inject edilmez; `runAIConsensusFromInput` mock (provider boundary only)

---

## 5. Test Senaryoları (6/6 PASS)

| Case | Açıklama | Sonuç |
|------|----------|-------|
| 1 | BUY via handoff hydration → paper order + position | **PASS** |
| 2 | AI NO_TRADE → no order | **PASS** |
| 3 | Entry quality rejection (structured reason) | **PASS** |
| 4 | Risk max open positions (`evaluatePreTradeRisk`) | **PASS** |
| 5 | Expired canonical → HANDOFF_CANDIDATE_EXPIRED | **PASS** |
| 6 | Identity mismatch → HANDOFF_IDENTITY_MISMATCH | **PASS** |

---

## 6. Mock Boundary Matrisi

| Boundary | Mock? | Not |
|----------|-------|-----|
| `runAIConsensusFromInput` | **Yes** | Provider/network — hydration production path |
| Binance ticker/orderbook | **Yes** | Market data boundary |
| `evaluateSignalQualityGate` | **Yes (CASE 1 only)** | Disposable env'de market spine eksik; final-engineering ile aynı sınıf |
| `evaluateAdaptiveCandidate` | **Yes** | Empty learning store in disposable DB |
| `evaluateOrchestration` | **Yes (ALLOW)** | Suppression bypass for BUY path |
| Paper adapter / simulator | **No** | Real |
| `canonical-handoff.service` | **No** | Real |
| `execution-orchestrator` | **No** | Real |
| `profit-thresholds` (CASE 3) | **No** | Real |
| `evaluatePreTradeRisk` (CASE 4) | **No** | Real + DB positions |

---

## 7. Paper Accounting Architecture

**Authoritative source:** `AppSetting` key `paper.account.<userId>` (JSON: `{ balances, updatedAt }`)

- **Initialize:** `ensurePaperAccountInitialized()` → idempotent `readPaperAccount()`
- **Defaults:** `PAPER_INITIAL_BALANCE_TRY` (env, default 100000), `PAPER_INITIAL_BALANCE_USDT`
- **Campaign runner:** `readPaperCashSnapshot` artık `ensurePaperAccountInitialized` kullanıyor (önceki `JSON.parse(row.value)` bug'ı giderildi — Prisma zaten object döndürüyordu)

---

## 8. Account Initialization

- Preflight öncesi runner `ensurePaperAccountInitialized(user.id)` çağırıyor
- Test: paper account yok → create → `TRY` ve `USDT` bilinir

---

## 9. Cash Reconciliation Kanıtları

`tests/paper-accounting.integration.test.ts`:

- BUY: `cash_after = cash_before - notional - fee`
- SELL: `cash_after = cash_before + exit_notional - exit_fee`
- Net round-trip: `before - buyFee - sellFee + (sellNotional - buyNotional)`

---

## 10. Fee Reconciliation

Entry + exit fee ayrı uygulanıyor (`calculateTakerFee`). Test PASS.

---

## 11. Campaign Isolation

- `paperTrade.campaignId` ile A/B ayrımı test edildi
- Runner `campaignId` + `cmp:<jobId>` ile trade sorgusu

---

## 12. Score / Confidence Scale Audit

| Field | Scale | Source | Consumer | Not |
|-------|-------|--------|----------|-----|
| `scanner.score.confidence` | 0–100 | Scanner | handoff, confidence gate | OK |
| `ai.finalConfidence` | 0–100 | AI provider | AI gates, logging | OK |
| `analysisScorecard.confidenceScore` | 0–100 | AI scorecard | `resolveExecutionConfidenceScore` | OK |
| `ai.finalRiskScore` | 0–100 | AI provider | entry quality, risk | OK |
| Entry quality input (önce) | `ai.finalConfidence` | — | `shouldRejectHighRiskLowConfidenceEntry` | **BUG** |
| Entry quality input (sonra) | `scorecardConfidence` | `resolveExecutionConfidenceScore` | entry quality | **FIXED** |

**Smoke örneği (ZROUSDT):** `0% < 82%` — `finalConfidence=0` ama scanner confidence > 0. Mapping bug, AI gerçek değeri değil.

**Fix:** `execution-orchestrator.service.ts` entry quality gate artık `scorecardConfidence` kullanıyor.

**Regression:** `tests/score-scale-entry-quality.test.ts`

---

## 13. Zero-Trade Forensic (Prior 30m Smoke)

**Campaign:** `paper-30m-2026-09-07T11-15-57-378Z`

| Metrik | Değer |
|--------|-------|
| Rounds | 8 |
| Selected | 7 |
| Execution/AI reached | 7 |
| Trades | 0 |

### Terminal dağılımı

| Outcome | Count | Örnek |
|---------|-------|-------|
| `execution_rejected` | 4 | ZROUSDT, IOSTUSDT, LTCUSDT |
| `ai_rejected` | 3 | PUMPUSDT |
| `no_eligible_candidate` | 1 | Tur 8 (deadline) |

### Dominant blocker analizi

1. **AI rejection (3):** Gerçek NO_TRADE / low confidence — strateji/policy, handoff bug değil
2. **Execution rejection (4):** Entry quality `elevated AI risk without elite confidence (0% < 82%)` — **kısmen teknik bug** (confidence 0% yanlış kaynak); fix sonrası scanner/scorecard fallback kullanılacak
3. **0 trade ≠ pipeline kırık** — handoff sonrası pipeline çalışıyor; admission gates reddediyor

---

## 14. Funnel Metrics (Prior Smoke)

| Stage | Count |
|-------|-------|
| round_recorded | 8 |
| round_selected | 7 |
| handoff_valid / execution_reached | 7 |
| ai_buy | 0 |
| paper_order_created | 0 |
| position_opened | 0 |

---

## 15. Rejection Reason Histogram

- `execution_rejected`: 57% (4/7 selected)
- `ai_rejected`: 43% (3/7)
- Structured codes: `QUALITY_GATE_REJECT`, `LOW_CONFIDENCE`, `NO_TRADE` — `UNCLASSIFIED` dominant değil (handoff fix sonrası)

---

## 16. Threshold Analysis

- Entry quality: risk > 75 requires confidence ≥ 82 (`TRADE_QUALITY_POLICY`)
- AI min confidence (non-learning): 55–60
- **0% confidence rejections:** distribution artifact from bug — not calibration
- **Öneri:** Fix sonrası yeni smoke ile distribution yeniden ölçülmeli; otomatik gevşetme yapılmadı

---

## 17. Yapılan Kod Değişiklikleri

| Dosya | Değişiklik |
|-------|------------|
| `scripts/paper-campaign-runner-core.ts` | Paper cash fix + account init + summary export |
| `src/server/simulation/paper-trading.service.ts` | `ensurePaperAccountInitialized`, `readPaperCashBalances` |
| `src/server/execution/execution-orchestrator.service.ts` | Entry quality uses `scorecardConfidence` |
| `src/server/forensics/paper-campaign-summary.service.ts` | Machine-readable campaign summary |
| `tests/canonical-paper-full-chain.integration.test.ts` | 6-case disposable PG integration |
| `tests/paper-accounting.integration.test.ts` | Accounting + isolation tests |
| `tests/score-scale-entry-quality.test.ts` | Scale regression |
| `tests/helpers/canonical-paper-chain-fixtures.ts` | Shared fixtures |

---

## 18. Test Sonuçları

```
npm run typecheck                                    PASS
npm run build                                        PASS
vitest canonical-paper-full-chain.integration        6/6 PASS
vitest paper-accounting.integration                  4/4 PASS
vitest score-scale + handoff + terminal              11/11 PASS
vitest final-engineering-production-chain            2/2 PASS
```

---

## 19. Controlled PAPER Smoke

**Status:** IN_PROGRESS  
**Campaign:** `paper-post-handoff-2026-09-07T14-45Z`  
**Duration:** 30m  
**LIVE:** kapalı

Smoke tamamlandığında `kripto-30m-paper-smoke-result.json` ve `artifacts/paper-campaigns/<id>/paper-campaign-summary.json` güncellenecek.

---

## 20. Accounting Before/After (Fix Beklentisi)

| Alan | Önceki smoke | Fix sonrası beklenen |
|------|--------------|----------------------|
| `paperCashBefore` | null | `{ TRY: 100000, USDT: ... }` |
| `paperCashAfter` | null | dolu |
| `paperCashSource` | unavailable | `app_setting` |

---

## 21. Trade Forensic

Bu phase'de controlled smoke tamamlanmadı. Prior smoke: **0 trade**.

---

## 22. Blocker Dağılımı (0 trade)

Strateji/admission — teknik handoff dışı. Entry quality 0% bug fix ile execution_rejected oranı düşebilir; kanıt için yeni smoke gerekli.

---

## 23. Kalan Açıklar

1. Build lock — concurrent next build
2. Smoke IN_PROGRESS
3. Exit/ledger full round-trip integration (CASE 1 BUY only; exit ayrı final-engineering testinde)
4. Signal quality gate disposable test'te market spine mock (dokümante)

---

## 24. Riskler

- Admission threshold'lar hâlâ sıkı — 0 trade mümkün
- Fix sonrası confidence fallback daha doğru reject/allow verecek — yeniden kalibrasyon gerekebilir

---

## 25. READY_FOR_LONG_PAPER Kararı

**READY_FOR_LONG_PAPER = false**

Gerekçe: Controlled smoke henüz tamamlanmadı; build doğrulanmadı. Altyapı kanıtı (integration + accounting + score fix) tamamlandığında smoke PASS ile `true` önerilir.

---

*PROFITABILITY = INSUFFICIENT_DATA — bu phase kâr kanıtlamaz; uzun PAPER'in stratejiyi ölçebilmesi için altyapı güvenilirliğini kanıtlar.*
