# KRIPTO — 1 Hour PAPER Validation Report

> **Campaign:** `paper-1h-2026-09-07T15-47-43-241Z`  
> **Job:** `cmtrezwvc000bunbk5fgm1kvl`  
> **Generated:** 2026-09-07T16:52:00Z  
> **Starting HEAD:** `ec1bc2b51f7f8bb0b7758dc556befbd1dc715513`

---

## 1. Executive Summary

| Alan | Sonuç |
|------|-------|
| **Verdict** | **PASS** |
| **PIPELINE_VERDICT** | **HEALTHY** |
| **ACCOUNTING_VERDICT** | **PASS** |
| **PROFITABILITY** | **INSUFFICIENT_DATA** |
| **READY_FOR_LONG_PAPER** | **true** |
| Runtime | 62 dk (planlanan 60 dk) |
| Rounds | 8 · Selected 5 · Execution reached 5 |
| Orders / Fills / Closed trades | 0 / 0 / 0 |
| Net realized PnL | 0 TRY · Fees 0 |

**Özet:** 1 saatlik PAPER kampanya tamamlandı. Pipeline seçim → handoff → execution zincirine ulaştı; 5/5 seçilen aday entry-quality gate'te reddedildi. Trade açılmadı ancak bu **PIPELINE_BROKEN** değil — admission gate'ler bilinçli olarak blokladı.

---

## 2. Starting HEAD

`ec1bc2b51f7f8bb0b7758dc556befbd1dc715513` (origin/main referans: `ec1bc2b`)

---

## 3. Git / Worktree State

- Uncommitted: `data/exchange-info-tr.json`, yeni campaign scriptleri ve rapor dosyaları
- Campaign runtime sırasında strateji threshold değiştirilmedi

---

## 4. Preflight

| Kontrol | Sonuç |
|---------|-------|
| overallVerdict | **READY** |
| database | PASS |
| binance | PASS (BTCTRY ticker) |
| ai | PASS (3 provider) |
| emergencyStop | PASS |
| activeJobs | PASS |
| zombieRounds | PASS |
| workerLocks | PASS |
| duplicatePaperJobs | PASS |
| clockSync | PASS (skew 1849ms) |

---

## 5. Runtime Configuration

```text
EXECUTION_MODE=paper
LIVE_TRADING_ENABLED=false
LIVE_AUTHORIZATION=DISABLED
PAPER_INITIAL_BALANCE_TRY=100000
DURATION_MS=3600000
BUDGET_PER_TRADE=1000
MAX_WAIT_SEC=600
```

---

## 6. Safety Verification

- Binance provider: `dryRun=true`, `environment=live` (read-only market data)
- Gerçek order submit kapalı
- Paper adapter aktif
- Kill-switch / accidental live lock doğrulandı (preflight)

---

## 7. Campaign ID / Job ID

- **campaignId:** `paper-1h-2026-09-07T15-47-43-241Z`
- **jobId:** `cmtrezwvc000bunbk5fgm1kvl`
- **cmpId:** `cmp:cmtrezwvc000bunbk5fgm1kvl`

---

## 8. Timing

| Alan | Değer |
|------|-------|
| jobStartedAt | 2026-09-07T15:47:54.323Z |
| endedAt | 2026-09-07T16:49:49.143Z |
| actualJobDurationMs | 3,714,820 (~61.9 dk) |
| completedFullDuration | **true** |
| reachedTerminal | **true** |
| stopReason | `deadline` |
| finalJobStatus | `STOPPED` |

---

## 9. Funnel

```text
round_started        = 8
discovered           = 8
round_selected       = 5
handoff_valid        = 5
execution_reached    = 5
ai_no_trade          = 5
ai_buy               = 0
entry_quality_reject = 5
risk_reject          = 0
sizing_reject        = 0
order_requested      = 0
paper_order_created  = 0
paper_fill           = 0
position_opened      = 0
position_closed      = 0
no_eligible_candidate = 3  (round 6-8)
```

---

## 10. Round Summary

| Round | Symbol | AI Decision | Confidence (observed) | Terminal | Duration |
|-------|--------|-------------|----------------------|----------|----------|
| 1 | EPICUSDT | NO_TRADE | 73% (< 82% threshold) | Entry quality: elevated AI risk (100) | 655s |
| 2 | ARBTRY | NO_TRADE | 77% (< 82%) | Entry quality: elevated AI risk (100) | 148s |
| 3 | ONDOUSDT | NO_TRADE | 73% (< 82%) | Entry quality: elevated AI risk (100) | 421s |
| 4 | CFGTRY | NO_TRADE | 74% (< 82%) | Entry quality: elevated AI risk (100) | 631s |
| 5 | OPENUSDT | NO_TRADE | 74% (< 82%) | Entry quality: elevated AI risk (100) | 138s |
| 6 | — | — | — | NO_ELIGIBLE_CANDIDATE | 694s |
| 7 | — | — | — | NO_ELIGIBLE_CANDIDATE | 699s |
| 8 | — | — | — | NO_ELIGIBLE_CANDIDATE | 294s |

---

## 11. Selected Candidate Forensic

Tüm 5 seçilen aday execution orchestrator'a ulaştı (`failReason` prefix: `execution:`). `executionId` null — order aşamasına geçilmedi.

---

## 12. AI Decisions

- **ai_buy:** 0
- **ai_no_trade:** 5 (100% of selected)
- AI consensus çalıştı; tüm seçilenlerde karar `NO_TRADE`

---

## 13. Entry-Quality Analysis

**DOMINANT_GATE:** Entry quality — elevated AI risk without elite confidence

| Gate | Rejected | % Selected | Threshold | Observed (median) |
|------|----------|------------|-----------|-------------------|
| ENTRY_CONFIDENCE_TOO_LOW + AI_RISK_TOO_HIGH | 5 | 100% | elite confidence ≥ 82%, AI risk ≤ threshold | confidence 73–77%, AI risk 100 |

Mesaj örneği: `Entry quality: elevated AI risk (100) without elite confidence (73% < 82%)`

---

## 14. Risk Analysis

- risk_reject: 0
- Risk gate'e ulaşan aday yok (entry quality önce blokladı)

---

## 15. Sizing Analysis

- sizing_reject: 0
- Order aşamasına ulaşılmadı

---

## 16–20. Orders / Fills / Positions / Exits / Trade Forensic

- **0 trade** — bu campaign window'da order, fill, position, exit yok

---

## 21. PnL

- realizedPnl: 0
- unrealizedPnl: 0
- netEquityDelta: 0

---

## 22. Fees

- fees: 0 (execution yok)

---

## 23. Accounting Reconciliation

| Alan | Değer |
|------|-------|
| paperCashBefore TRY | 99997.997 |
| paperCashAfter TRY | 99997.997 |
| expectedCashAfter | 99997.997 |
| actualCashAfter | 99997.997 |
| **reconciled** | **true** (±0.05 tolerance) |

---

## 24. Campaign Isolation

- openPositionsBefore: 0
- openPositionsAfter: 0
- Campaign-scoped paperTrade count: 0
- Eski campaign trade'leri dahil edilmedi
- Cash delta: 0 (campaign PnL = 0)

---

## 25. Rejection Histogram

```text
selected = 5

entry_quality_reject = 5  (100%)
ai_no_trade          = 5  (100%)
no_eligible_candidate = 3  (rounds 6-8, unselected)
orders               = 0
```

---

## 26. Dominant Gates

1. **Entry quality** — elevated AI risk (100) + confidence < 82% elite floor → 5/5 selected
2. **NO_ELIGIBLE_CANDIDATE** — 3 unselected rounds (selection deadline)

---

## 27. Runtime Health

| Metrik | Count |
|--------|-------|
| HTTP 429 | 0 |
| HTTP 418 | 0 |
| WS reconnect | 0 |
| AI timeout | 0 |
| DB error | 0 |
| Worker exception | 0 |

Watchdog `SCHEDULER_CRASH` recovery audit kayıtları var; tümü `NO_ACTION` — job kesintisiz devam etti.

---

## 28. Stop / Final State

- STOP checkpoint: `2026-09-07T16:48:03.128Z` (deadline)
- FINAL checkpoint: `reachedTerminal=true`, `finalJobStatus=STOPPED`
- Job RUNNING halinde bırakılmadı

---

## 29. Profitability Verdict

**INSUFFICIENT_DATA** (0 closed trades)

---

## 30. Remaining Risks

- Entry-quality elite confidence floor (82%) + AI risk=100 kombinasyonu trade üretimini tamamen bloke ediyor
- Round 6–8 selection timeout (`NO_ELIGIBLE_CANDIDATE`) — piyasa koşulları veya scanner eşiği
- `UNCLASSIFIED_TERMINAL_REASON` prefix hâlâ terminal reason string'inde (sınıflandırma metadata iyileştirmesi gerekli, pipeline davranışı etkilenmedi)

---

## 31. Recommended Next Step

1. **Extended paper (4–8h)** — baseline threshold'lar değiştirilmeden uzun koşu; farklı piyasa rejimlerinde aday dağılımını ölç
2. **Threshold forensic review** — entry-quality elite floor (82%) ve AI risk ceiling için observed distribution analizi (bu campaign'te değiştirme yapılmadı)
3. **Terminal reason taxonomy** — `UNCLASSIFIED_TERMINAL_REASON` → `ENTRY_QUALITY_REJECT` mapping düzeltmesi (observability only)

---

## Artifact Directory

`artifacts/paper-campaigns/paper-1h-2026-09-07T15-47-43-241Z/`

- preflight.json
- frozen-config.json
- checkpoints.jsonl
- final-snapshot.json
- paper-campaign-summary.json
- selected-candidates.json
- rejection-histogram.json
- accounting-reconciliation.json
