# KRIPTO — COW vs OG Live Selection Forensic

**Mode:** Read-only forensic  
**Session:** `cmsud4nf7001eungwnhftv9k6`  
**Forensic snapshot:** 2026-08-15 ~16:07 TR (12:57 UTC)  
**Paper run:** Not stopped or modified  

---

## Executive answer

**Why did native Kripto not select COW while 0GTRY appears active?**

1. **COWTRY never entered Round 2’s selection pipeline.** Zero `TradeEventLog` rows, zero system-log mentions, zero forensic artifact rows for COW in this round.
2. **The active symbol is `0GTRY` (Zero-G), not `OGTRY`.** `OGTRY` also has zero Round-2 presence.
3. **Round 2 selection was still in progress** at forensic time (`selectedReason: null`, no `0GTRY scanner secimi` log). `0GTRY` is the **current AI consensus candidate** in an in-flight scanner batch—not a finalized winner over COW.
4. **COW was excluded by the rotating scanner cycle window** (batch started at `PROVETRY`, cursor ≈ 224, 79 symbols ending at `0GTRY`). COW sits at watchlist index **0** (prepended top gainer) but that index was **outside** the batch.
5. **Pump lane did not rescue COW:** cache had **MEGATRY** only → rejected `PUMP_CONFIRM_NO_TRADE (early)`; live pump scan returned **0** candidates.

**Root cause classification:** `SCANNER_NOT_DISCOVERED`  
**Confidence:** 92%  

---

## 1. Current round

| Field | Value |
|-------|-------|
| Job | `cmsud4nf7001eungwnhftv9k6` |
| Round | **2** (active) |
| Run ID | `cmsudp8gd0119ungwiwcnl4m3` |
| DB state | `tariyor` |
| Runtime step | `AI_ANALYSIS` / `scanner-full` / phase `consensus` |
| Selection finalized? | **No** (`selectedReason: null`) |
| Completed rounds | 0 |
| Failed rounds | 1 (Round 1 `MAVTRY` timeout) |

Round 1 partial export exists under `artifacts/forensics/cmsud4nf7001eungwnhftv9k6/rounds/1/` (failed). **No Round 2 forensic export directory exists yet.**

---

## 2. Symbol clarification (OG vs 0G)

| Label | Native symbol | Round-2 pipeline |
|-------|---------------|------------------|
| User “OG” (observed UI) | **`0GTRY`** (base `0G`) | In scanner batch; AI invoked |
| **`OGTRY`** (distinct pair) | `OGTRY` | **Absent** — 0 events |

All comparisons below use **`0GTRY`** as the native counterpart to COW.

---

## 3. COW visibility in Round 2

| Check | Result |
|-------|--------|
| In exchange TRY universe | Yes |
| In watchlist | Yes (index **0**, top-gainer prepend) |
| In Round-2 discovery batch (79 symbols) | **No** |
| Market context built | **No** |
| Candidate created | **No** |
| TradeEventLog entries (session) | **0** |
| SystemLog mentions | **0** |
| Forensic artifacts | **None** (round not exported) |

**Classification:** `NOT_DISCOVERED`  
**First blocking stage:** `SCANNER_CYCLE_MISS` — not in cursor batch before ranking/TDI/AI.

### Observed scanner batch (Round 2)

- **Start:** `PROVETRY` @ 2026-08-15T12:56:50.684Z  
- **End:** `0GTRY` @ 2026-08-15T12:56:56.984Z (79/79)  
- **Inferred cursor:** 224 on watchlist size 315  
- **COWTRY watchlist index:** 0 → **not in** `[224 .. 224+78]`

Top-gainer API at forensic time (live read, not decision-time cache):

- **COWTRY:** #1, `change24h=+67.86%`, `priorityScore=60.62`, `volume24h≈550M`

---

## 4. COW pipeline trace

```
scanner universe (watchlist) ✓
  → cycle batch (cursor window) ✗  ← FIRST BLOCK
  → market context ✗
  → candidate ✗
  → pump cache (MEGATRY only) ✗
  → pump live (0 candidates) ✗
  → ranking ✗
  → TDI ✗
  → AI ✗
  → execution ✗
```

### Pump lane (Round 2)

| Time (UTC) | Event |
|------------|-------|
| 12:55:15.312Z | Pump scan (cache) — 1 candidate |
| 12:55:15.437Z | `MEGATRY` pump confirmation (1/1) |
| 12:55:15.469Z | **`MEGATRY: Pump confirmation NO_TRADE (early)`** |
| 12:56:14.861Z | Pump scan (live) — **0 candidates** |
| 12:56:16.262Z | Full scanner engaged |

**reasonCode:** `PUMP_CONFIRM_NO_TRADE` (MEGATRY, not COW)  
COW never appears in pump selection logs.

---

## 5. 0GTRY pipeline trace (in progress)

| Stage | Status | Timestamp / detail |
|-------|--------|-------------------|
| In discovery batch | Yes | 79/79 @ 12:56:56.984Z |
| Ranking | Complete | 12:56:57.883Z |
| AI started | Yes | 12:57:02.004Z |
| AI result | `NO_TRADE` | 12:57:13.177Z |
| Final selection | **Not finalized** | No `scanner secimi` log; `selectedReason` null |

### 0GTRY at AI start (decision-time native data)

| Field | Value |
|-------|-------|
| price | 8.03 |
| volume24h | 24,496,466 |
| spread | 0.1244% |
| volatility | 0.2907 |
| klines | 80 |
| AI decision | `NO_TRADE` |
| AI confidence | 21.53 |
| AI regime | `HIGH_VOLATILITY_CHAOS` |
| composite | 55.24 |

---

## 6. Side-by-side @ ranking timestamp (~12:56:57.883Z)

| Field | COWTRY | 0GTRY |
|-------|--------|-------|
| Native decision-time data | **None** | Partial (AI @ 12:57:02) |
| In scanner batch | No | Yes (79/79) |
| price | — | 8.03 |
| 24h change (native) | — | (in batch context; AI uses live ticker) |
| Top-gainer API (forensic) | +67.86% | in top-gainers list |
| volume24h | ~550M (API) | 24.5M (native AI start) |
| momentum / flow | — | — |
| strategy | — | scanner-full (selection) |
| TDI | — | not reached |
| AI readiness | not invoked | invoked → NO_TRADE |
| ranking score | **not ranked** | in AI queue (#2 after TOWNSTRY) |
| final selection score | N/A | selection incomplete |

**No OG > COW ranking comparison exists** — COW never reached ranking.

---

## 7. Ranking chain (why 0G appears “selected”)

```
runCooperativeRoundSelection (round-selection.service.ts)
  → getPumpFastEntry: MEGATRY cache → rejected
  → getPumpFastEntry live: empty
  → getBestFastEntry (fast-entry.service.ts)
      → runScannerPipeline (scanner.service.ts)
          → cycleSymbols from cursor (NOT including COWTRY)
          → rankCandidates / rankForFastEntry
          → AI consensus queue (0GTRY current candidate)
```

| Decision | Function | Input | Outcome |
|----------|----------|-------|---------|
| Cycle membership | `scanner.service.ts` `cycleSymbols` | cursor≈224, limit=79 | COW excluded |
| Pump priority | `selectPumpFastEntry` | cache=[MEGATRY] | MEGATRY rejected; COW not in cache |
| Visible leader | `RoundRuntimeController.persist` | `currentSymbol=0GTRY` | UI shows 0G during AI—not final pick |

---

## 8. Pump detection

| View | COW pump |
|------|----------|
| **Market now (API)** | +67.86% 24h, #1 top gainer |
| **Scanner batch @ selection** | Not scanned |
| **Pump cache @ selection** | Not present (MEGATRY only) |
| **Classification** | `PUMP_VISIBLE_TO_TOP_GAINER_API_BUT_NOT_IN_SELECTION_UNIVERSE` |

Timestamps:

- Scanner context start: `12:56:45.810Z`  
- Ranking done: `12:56:57.883Z`  
- 0G AI start: `12:57:02.004Z`  

We do **not** use post-decision price action. COW’s pump was **knowable to top-gainer discovery** but **not wired into the active selection batch**.

---

## 9. Data freshness

| Symbol | Native Round-2 data | Staleness |
|--------|---------------------|-----------|
| COWTRY | None | N/A — never fetched |
| 0GTRY | AI start @ 12:57:02, 80 klines | No stale flag in event; data sufficient for AI |

---

## 10. Filters / rejections (COW)

**No rejection records** — COW never reached filter stages.

If COW had been pump-evaluated in background, likely failure modes (from `evaluateTopGainerContinuation` in code) include `buyBias` (shortMomentum>0 && flow>0), `stillMoving`, spread/fakeSpike/pumpRisk gates—but **no Round-2 native log confirms COW pump evaluation**.

---

## 11. Score gap

**Not computable.** COW rank/score undefined. 0GTRY AI confidence 21.53 → `NO_TRADE` at forensic time.

---

## 12. Artifacts

### Round 2 (live, not exported)

All missing:

- `scanner-summary.json`
- `scanner-qualification.json`
- `candidate-lifecycle.json`
- `tdi-decisions.json`
- `slot-opportunity-report.json`
- `pump-scan-lifecycle.json`
- `decision-trace.json`
- `ai-trace.json`
- `resolved-config.json`

### Evidence used instead

- PostgreSQL: `AutoRoundJob`, `AutoRoundRun`, `TradeEventLog`, `SystemLog`
- Dev server logs (terminal)
- `discoverTopGainerSymbols` live snapshot
- `data/exchange-info-tr.json`, `data/scanner-cursor.json`

Structured JSON: [`kripto-cow-vs-og-selection-forensic.json`](kripto-cow-vs-og-selection-forensic.json)

---

## 13. Live observation vs forensic evidence

| What we see now | What the system knew at decision time |
|-----------------|--------------------------------------|
| COW pumping hard (+67% 24h) | COW **not in** Round-2 scanner batch or logs |
| “OG selected” in UI | **`0GTRY` current AI candidate** during **incomplete** selection |
| COW “should win” intuitively | No eligibility proof — COW never a candidate |

---

## 14. Root cause

| | |
|--|--|
| **Classification** | `SCANNER_NOT_DISCOVERED` |
| **Confidence** | **92%** |
| **Primary mechanism** | Rotating scanner cursor batch excluded COWTRY (watchlist idx 0) |
| **Secondary** | Pump cache served MEGATRY only; live pump empty; COW not promoted into selection |
| **Expected vs bug** | **Expected given cursor rotation design**; design gap: #1 top gainer not guaranteed scan when excluded from cursor window and absent from pump cache |

---

## 15. BrainOS parity

**Not warranted for this question.** Native evidence fully explains COW omission without BrainOS comparison.

---

## 16. Direct answer

> **Why did native Kripto choose 0GTRY instead of COW?**

It **has not finalized** a choice yet. **`0GTRY` is the leading in-batch scanner/AI candidate** because COW **was never discovered** in Round 2’s scanner cycle or pump-selection path. COW’s market pump was visible to the top-gainer API but **invisible to the selection universe** that ran at `12:55–12:57 UTC`.

---

*No code, thresholds, strategies, prompts, risk/sizing, or the running paper job were modified.*
