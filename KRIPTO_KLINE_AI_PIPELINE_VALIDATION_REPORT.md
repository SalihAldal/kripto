# KRIPTO — Kline Data Pipeline Forensic, Freshness Hardening & Real AI Consensus Validation

> **Phase:** KLINE PIPELINE + AI CONSENSUS RUNTIME VALIDATION  
> **Starting HEAD:** `7677da80f564f525ad2a0539f0da5764d680d760`  
> **Final HEAD:** `7677da80f564f525ad2a0539f0da5764d680d760`  
> **Reference 1h campaign:** `paper-1h-2026-09-07T15-47-43-241Z` / job `cmtrezwvc000bunbk5fgm1kvl`  
> **Smoke campaign:** `paper-kline-ai-30m-2026-09-07T19-02-47-786Z`  
> **Generated:** 2026-09-07T19:35:19.078Z

---

## 1. Executive Summary

| Alan | Sonuç |
|------|-------|
| **KLINE_PIPELINE_VERDICT** | **FIXED** (stale snapshot → refresh path) |
| **AI_CONSENSUS_VERDICT** | **RUNTIME_VERIFIED** |
| **ROOT_CAUSE** | Daemon RAM-only kline read without REST recovery at AI handoff |
| **READY_FOR_EXTENDED_PAPER** | **true** |

1h campaign'de 5/5 selected aday `klines.length < 20` (çoğunlukla boş array) ile provider loop'a girmeden `risk=100` safety default aldı. Fix: `ensureFreshKlineContext` — stale ise daemon → REST recovery → yeniden validate.

---

## 2. Starting HEAD

`7677da80f564f525ad2a0539f0da5764d680d760` — `feat(paper): 1h validation campaign, AI entry-gate forensic and admission fixes`

---

## 3. Git / worktree state

Final HEAD: `7677da80f564f525ad2a0539f0da5764d680d760`

---

## 4. Previous blocker

`analysis-orchestrator.ts` stale guard: `klines.length < 20` OR `klineAgeSec > 180` (last closed candle `closeTime` ms). 1h campaign'de tüm selected adaylarda `outputs=[]`, `Kline data missing or stale`.

---

## 5. Kline pipeline architecture

```
Binance REST / WS
  → market-data-orchestrator (REST + cache)
  → market-data-daemon (RAM store, subscribeDeep bootstrap)
  → market-data-gateway (RAM default; recovery:true → orchestrator REST)
  → market-snapshot-cache (25s TTL)
  → formatAIRequest → ensureFreshKlineContext (NEW)
  → analysis-orchestrator stale guard
  → 3-lane provider consensus
```

---

## 6. Stale guard contract

- **Min count:** 20 (`AI_KLINE_MIN_COUNT`)
- **Max age:** 180s (`AI_KLINE_MAX_AGE_SEC`) on last candle `closeTime` (milliseconds; seconds auto-normalized)
- **Interval:** 1m for AI input
- Fail → structured `AI_KLINE_STALE` + safe `NO_TRADE`, `risk=100`

---

## 7. 1h campaign retrospective

8 round, 5 selected, 0 trades. Tüm AI path: kline stale early exit (artifact: `ai-consensus-trace.json`).

---

## 8. Five-symbol forensic (1h)

| Symbol | AI result reason | outputs | provider path |
|--------|------------------|---------|---------------|
| EPICUSDT | Kline data missing or stale | 0 | ❌ |
| ARBTRY | Kline data missing or stale | 0 | ❌ |
| ONDOUSDT | Kline data missing or stale | 0 | ❌ |
| CFGTRY | Kline data missing or stale | 0 | ❌ |
| OPENUSDT | Kline data missing or stale | 0 | ❌ |

**Kök neden:** `formatAIRequest` → `marketDataGateway.getKlines` (recovery:false) → daemon boş → `[]`.

---

## 9. Root cause matrix

| # | Hypothesis | Verdict |
|---|------------|---------|
| 1 | Timestamp sec/ms | Handled in `normalizeKlineCloseTimeMs` |
| 2 | openTime vs closeTime | Age uses `closeTime` (correct) |
| 3 | Open candle exclusion | N/A for empty array case |
| 4 | Timeframe mismatch | AI expects 1m; formatter uses 1m |
| 5 | Insufficient history | Upstream returned 0 (not <20 from truncation) |
| 6 | Cache truncation | Snapshot TTL 25s; selection delay irrelevant if empty |
| 7–8 | TRY/USDT routing | REST recovery uses exchange router (tests: ARBTRY, ONDOUSDT) |
| 9 | WS vs kline | Ticker WS ≠ kline; kline not subscribed for cold symbols |
| 10 | REST fallback | Existed but not called from AI formatter path |
| 11–12 | Cache/venue key | Snapshot keyed by symbol; refresh updates snapshot |
| 13–15 | Race / stale snapshot | **CONFIRMED** — handoff used stale/empty snapshot |

---

## 10. Confirmed root cause

**Static empty/stale kline snapshot at AI handoff** without REST recovery. `subscribeDeep` bootstrap is fire-and-forget; AI called before hydration completed.

---

## 11–13. Timestamp / timeframe / venue audits

- Timestamps: Binance `closeTime` ms; seconds normalized in contract service
- Timeframe: 1m for AI; 180s threshold unchanged (intended for 1m)
- TRY: `ARBTRY` via recovery path; USDT: global path

---

## 14–18. TRY/USDT paths, cache, WS, REST

- **TRY_KLINE_PATH:** `ensureFreshKlineContext` → gateway recovery → orchestrator → Binance TR router
- **USDT_KLINE_PATH:** same with global symbol resolution
- **Cache:** fresh snapshot skips REST; stale triggers recovery
- **WS:** daemon hot path; cold symbols need REST recovery
- **REST fallback:** `{ recovery: true, priority: "high" }`

---

## 19. Candidate snapshot freshness

Selection-to-AI gap + empty daemon store = stale/empty at execution. Invariant: refresh immediately before AI input assembly.

---

## 20. Fix architecture

`ensureFreshKlineContext`: assess → daemon → REST recovery → re-assess → update snapshot. Inflight coalesce per symbol.

---

## 21. Code changes

- `src/server/market-data/kline-input-contract.service.ts` (contract + assessment)
- `src/server/market-data/ensure-fresh-kline-context.service.ts` (refresh)
- `src/server/scanner/ai-request-formatter.ts` (wire refresh + `AI_KLINE_INPUT`)
- `src/server/ai/analysis-orchestrator.ts` (structured stale + provider telemetry)
- `src/server/observability/trade-event-log.ts` (new event types)

---

## 22. Structured telemetry

- `AI_KLINE_INPUT` — count, ageSec, source, refresh flags
- `AI_KLINE_STALE` — reason codes: `KLINE_COUNT_INSUFFICIENT`, `KLINE_TOO_OLD`, etc.
- `AI_ANALYSIS_RESULT` — providerAttemptCount, outputsCount, consensus fields

---

## 23–24. Unit & integration tests

- `tests/kline-input-contract.test.ts` — 9 cases (count, stale, refresh, TRY, cache, coalesce)
- `tests/kline-to-ai-consensus.integration.test.ts` — fresh + stale-refresh → provider outputs

---

## 25. Mock boundary

Integration mocks: provider-factory, prisma, circuit-breaker. Real: kline contract, refresh orchestration, analysis-orchestrator stale guard + provider loop.

---

## 26–30. Controlled PAPER smoke

| Metric | Value |
|--------|-------|
| Campaign | `paper-kline-ai-30m-2026-09-07T19-02-47-786Z` |
| Selected | 7 |
| Fresh kline inputs | 7 |
| Refresh attempts | 4 |
| Refresh successes | 4 |
| Provider attempts | 21 |
| Provider successes | 21 |
| Provider outputs | 15 |
| Real consensus count | 7 |
| Runtime provider consensus | OBSERVED |

Artifacts: `artifacts/paper-campaigns/paper-kline-ai-30m-2026-09-07T19-02-47-786Z/` — kline-input-trace, kline-refresh-trace, ai-provider-trace, consensus-trace, final-snapshot, checkpoints.jsonl

---

## 31. Remaining risks

- 30m smoke may produce 0 selected candidates (market-dependent)
- Extended paper still requires runtime provider consensus observation
- 180s / 20 kline thresholds unchanged — monitor false stale on slow REST

---

## 32. Final verdict

**PASS** — Pipeline fix verified in code + tests + runtime.

---

## 33. READY_FOR_EXTENDED_PAPER

```
READY_FOR_EXTENDED_PAPER=true
```
