# PHASE-01-CORE-RESET-REPORT

STATUS: **PARTIAL**

Canonical production hot-path is wired, classified, and covered by the Phase 1 tests. Full-repo `tsc` still contains pre-existing errors outside this phase (scripts/, brainos-lab/, some API routes). Production `next build` could not be completed in this session because a leftover Next worker held the build lock (`Another next build process is already running`) after an earlier `NODE_OPTIONS` worker failure.

Live funds were not used.

---

## CANONICAL PIPELINE

```
MarketDataGateway
  → scanner.service (runScannerPipeline) + candidate-ranking
  → signal-scoring.engine (signed LONG score)
  → fast-entry.service (entry quality only; one pump opportunity pass)
  → executeAnalyzeAndTrade (execution-orchestrator)
       → evaluateSignalQualityGate          // A) SIGNAL QUALITY
       → AI / TDI                           // ADVISORY / SHADOW (no hard veto)
       → evaluateCanonicalRiskDecision      // B) HARD RISK  ALLOW|REJECT + reasonCodes[]
       → runPreTradeSafetyValidation        // C) EXECUTION VALIDITY
       → executeApprovedSpotOrder           // execution-engine-v2
       → startPositionMonitor
       → candidate-pipeline-trace           // outcome / telemetry
```

Canonical entry point: `src/server/execution/execution-orchestrator.service.ts::executeAnalyzeAndTrade`

---

## BEFORE

Production freeze already limited workers to CRITICAL, but CRITICAL contained **7** overlapping owners:

- scanner
- pump-early-catcher
- discovery
- execution-management
- execution-engine-v2
- execution-safety
- live-trading

`HOT_PATH_MAX_CRITICAL_WORKERS` (default 5) only **warned**.

Decision/execution stack:

- Scanner + Fast Entry fallback maze produced candidates
- Hybrid + Master DE + TDI labeled the decision
- `evaluateAiExecutionReadiness` defaulted to **VETO** (env ignored at runtime; always VETO)
- Auto-round skipped any non-BUY AI decision **before** execution
- `evaluatePreTradeRisk` mixed signal quality with hard risk; paperRelaxed could bypass
- `fakeSpikePenalty` was **added** to score
- Directional features used `Math.abs` (sell pressure boosted LONG score)
- Market-data HIGH/CRITICAL priority **bypassed** the REST weight budget
- Binance provider invented synthetic ticker/kline/orderbook/trade payloads when real data was missing

---

## AFTER

| Authority | Owner | Count |
|---|---|---|
| scanner | `scanner` worker | **1** |
| signal pipeline | `signal-scoring.engine` + ranking + fast-entry quality | **1** |
| risk | `evaluateCanonicalRiskDecision` | **1** |
| execution | `execution-orchestrator` → `executeApprovedSpotOrder` | **1** |
| AI hard veto (production policy) | none (`EXECUTION_AI_GATE_POLICY=ADVISORY`) | **0** |
| TDI hard veto | none (shadow telemetry; cannot reject execution) | **0** |
| CRITICAL workers | scanner, execution-engine-v2 | **2** |

---

## REMOVED FROM HOT PATH

Classified, not physically deleted:

| Service | Runtime class |
|---|---|
| pump-early-catcher worker | SHADOW_ONLY / SUPPORTING |
| discovery + trading-core-s2 | SHADOW_ONLY / SUPPORTING |
| decision-engine (v1 workers) | LEGACY |
| decision-engine-v2 | SHADOW_ONLY |
| execution-management worker | LEGACY / SUPPORTING |
| execution-safety worker | LEGACY / SUPPORTING |
| live-trading worker | LEGACY / SUPPORTING |
| intelligence-fusion, learning-*, quant-research | RESEARCH_ONLY |

Production bootstrap (`bootHotPathWorkers` + freeze) starts only CRITICAL workers. Duplicate CRITICAL claims are refused (`DUPLICATE_CRITICAL_WORKER`). Budget overflow **refuses start**, it does not warn-and-continue.

Scanner worker no longer starts the pump catcher timer. Auto-round no longer starts it either. Pump discovery remains an on-demand opportunity pass inside Fast Entry (`selectPumpFastEntry`), not a second scanner process.

---

## SCORING FIXES

File: `src/server/scanner/signal-scoring.engine.ts`

- `fakeSpikePenalty * 0.12` is **subtracted**
- Directional features are signed in `[-100, +100]`:
  - `orderBookImbalance`
  - `buyPressure - 0.5`
  - `shortFlowImbalance`
  - `shortCandleSignal`
- Positive buy pressure raises LONG score; sell pressure (`buyPressure=0.2`) does not
- Negative order-book imbalance reduces LONG score
- Metrics expose `positiveEvidence` / `negativeEvidence`

---

## AI CHANGES

| | Before | After |
|---|---|---|
| Default policy | VETO (hardcoded) | `EXECUTION_AI_GATE_POLICY=ADVISORY` |
| Missing / timeout | `AI_GATE_BLOCK` | `AI_ADVISORY_ONLY` (`AI_TIMEOUT`) |
| NO_OPINION | block | advisory, side=BUY from deterministic candidate |
| NO_TRADE | block | advisory, does not kill a valid deterministic candidate |
| Explicit `policy: "VETO"` | block | still available for forensic/legacy tests |

Auto-round no longer skips the candidate on `isBlockingAiDecision`. AI is recorded as advisory context.

---

## TDI CHANGES

| | Before | After |
|---|---|---|
| Role | Hybrid blocking conditions + forensic bridge acted as a production veto (via AI gate) | `TDI_RUNTIME_ROLE=SHADOW` (default) |
| Execution | AI_GATE_BLOCK on hybrid NO_TRADE | TDI recorded on the pipeline trace; cannot hard-veto |
| Hybrid engine | still computes TDI telemetry | unchanged as a research/advisory signal |

---

## RISK CHANGES

Single authority: `src/server/risk/canonical-risk-decision.service.ts`

Output:

```
{ verdict: ALLOW | REJECT, reasonCodes[], reasons[], metrics, timestamp }
```

Hard rejects include:

- `RISK_STALE_DATA`
- `RISK_DATA_UNAVAILABLE`
- `RISK_SYNTHETIC_DATA`
- `RISK_INVALID_PRICE`
- `RISK_SPREAD_TOO_HIGH`
- `RISK_LOW_LIQUIDITY`
- `RISK_DAILY_LOSS_LIMIT`
- `RISK_MAX_EXPOSURE`
- plus mapped codes from the existing pre-trade rules

Paper relaxed **cannot** bypass this authority. `"NO_TRADE"` is no longer a risk result.

Signal quality remains `evaluateSignalQualityGate`. Execution validity remains `runPreTradeSafetyValidation`.

---

## WORKER OWNERSHIP

| Worker | Tier | Owns |
|---|---|---|
| scanner | CRITICAL / CANONICAL | market scanning + candidate ranking |
| execution-engine-v2 | CRITICAL / CANONICAL | order execution + recovery/reconcile |
| everything else | SUPPORTING / OBSERVE_ONLY | frozen under default freeze |

In-process `claimCriticalWorker` prevents a second CRITICAL instance of the same id.

---

## SYNTHETIC DATA

Live/paper hot-path:

- Binance provider returns **cached real data** or throws `MarketDataUnavailableError` (`DATA_UNAVAILABLE`)
- Invented candles/tickers/order books are gated behind `MARKET_DATA_ALLOW_SYNTHETIC` (default **false**)
- Canonical risk rejects `syntheticData: true` with `RISK_SYNTHETIC_DATA`

Synthetic microstructure in `paper-round-context.ts` remains **backtest-only**.

---

## RATE LIMIT SAFETY

`MarketDataOrchestrator.canSpendWeight`:

- HIGH / CRITICAL **no longer bypass** the per-minute weight budget
- Budget exceeded + no cache → `RATE_BUDGET_EXCEEDED`
- 429 uses Retry-After when present, otherwise exponential backoff **plus jitter**
- In-flight coalescing is unchanged

---

## OBSERVABILITY

`src/server/hot-path/candidate-pipeline-trace.service.ts`

Per candidate:

- `candidateId`, `symbol`, `detectedAt`
- signal: score, lane, reasons
- AI: decision, confidence, status
- TDI: decision, confidence, role=SHADOW
- risk: ALLOW/REJECT + reasonCodes
- execution: attempted, orderId, result

Lookup: `getCandidatePipelineTrace` / `findCandidatePipelineTracesBySymbol`

Duplicate execution attempts are blocked by `claimCanonicalExecutionAttempt`.

---

## TESTS

Command:

```
npx vitest run tests/phase01-core-reset.test.ts
```

**PASS** — 18/18

Coverage of the required cases:

1. fakeSpikePenalty reduces score
2. Positive buy pressure increases LONG score
3. Strong sell pressure does not increase LONG score the same way
4. Negative order-book imbalance is directional
5. AI NO_OPINION does not hard-veto
6. AI timeout does not hard-veto
7. Hard risk reject produces machine-readable codes
8. TDI/AI NO_TRADE is advisory, not `AI_GATE_BLOCK`
9. Synthetic data cannot ALLOW
10. Duplicate critical worker claim refused
11. Same candidate cannot enter two execution paths
12. One canonical execution attempt per candidate
13. High priority does not bypass rate budget
14. Rejects have machine-readable reason codes
15. Canonical orchestrator does not import forbidden legacy modules

Related suites also run:

| Suite | Result |
|---|---|
| tests/phase01-core-reset.test.ts | PASS |
| tests/scanner.test.ts | PASS |
| tests/market-data-orchestrator.test.ts | PASS |
| tests/p0-execution-correctness.test.ts (P0-1 AI gate) | PASS (updated for ADVISORY) |
| tests/p2-scanner-ai-conflict.test.ts | PASS |
| tests/ai-provider-reliability.test.ts | PASS |
| tests/p3-positive-edge-policy.test.ts | PASS |
| tests/auto-round-engine.integration.test.ts | PASS |
| tests/execution-orchestrator.integration.test.ts | PASS |
| tests/fast-entry.route.integration.test.ts | PASS |

Unrelated pre-existing: `P0-2 maps position monitor exits` expects `TIMEOUT`, runtime returns `SYSTEM_TIMEOUT`. Not part of this phase.

---

## BUILD

| Gate | Result |
|---|---|
| eslint on changed files | PASS (warnings only: leftover unused Fast Entry helpers kept as LEGACY, not deleted) |
| `tsc --noEmit` (full repo) | FAIL — pre-existing errors in `scripts/*`, `brainos-lab/*`, some API routes. Phase 1 files that we introduced were fixed. |
| `npm run build` | FAIL in this session — Next worker lock / `NODE_OPTIONS --r=` interaction. Not a trading-pipeline compile error. Re-run `npm run build` after no other Next process is holding the lock. |

---

## RUNTIME EVIDENCE

Static call-site proof (this tree):

- `execution-orchestrator.service.ts` imports `evaluateCanonicalRiskDecision`, `claimCanonicalExecutionAttempt`, `upsertCandidatePipelineTrace`, `executeApprovedSpotOrder`
- It does **not** import `decision-engine-v2`, `trading-core-s2`, `intelligence-fusion`, `learning-engine`
- `LEGACY_WORKER_REGISTRY` CRITICAL ids = `scanner`, `execution-engine-v2`
- `resolveAiExecutionGatePolicy` returns `ADVISORY` unless env is explicitly `VETO`
- `canSpendMarketDataWeight("ticker", "high")` is false when the budget is full (unit test)
- Scanner/decision market reads go through `marketDataGateway`, not `getExchangeProvider()`

---

## KNOWN REMAINING RISKS

1. Fast Entry still contains unused LEGACY helpers (`buildEmergencyCandidates`, paper last-resort, etc.). They are unreachable from `getBestFastEntry` but not deleted.
2. Pump confirmation still has a **safety override** when pump-safety fails. Not a candidate-generation maze, but it is still an override.
3. Hybrid technical/momentum gates still emit NO_TRADE. That is now advisory at execution; it can still affect ranking if a caller filters on AI BUY.
4. `ai-request-formatter` extra timeframes go through the gateway, but watchlist universe listing still uses `services/binance.service` (exchange-info, not the candle hot-path).
5. Full-repo typecheck and production build were not green in this session for reasons above.
6. Position monitors are started per trade from the orchestrator, not a dedicated CRITICAL worker. That matches single execution owner; a process crash still relies on execution-engine-v2 RECOVERY jobs.

---

## PHASE 2 READINESS

**READY** for WebSocket market spine, with blockers below.

The scanner/decision boundary is `MarketDataGateway`. Phase 2 can replace the orchestrator backing store (REST) with WS + RAM + Redis without rewriting scanner scoring.

---

## PHASE 2 BLOCKERS

1. Confirm `npm run build` after the Next lock is cleared.
2. WebSocket all-market spine is intentionally not in this phase.
3. Watchlist `listTradableSymbols` is still on the Binance service facade — move onto the gateway when the WS universe snapshot exists.
4. Distributed rate-limit / shared REST budget across processes is still local to one process.

---

## DONE CRITERIA

- [x] Tek canonical trading hot-path var
- [x] Legacy/paralel karar yolları production'dan ayrıldı (sınıflandırıldı + bootstrap freeze)
- [x] Duplicate critical worker ownership temizlendi
- [x] fakeSpikePenalty bug'ı düzeltildi
- [x] Directional scoring signed hale geldi
- [x] Fast Entry fallback labirenti sadeleştirildi
- [x] AI hard veto kaldırıldı (production ADVISORY)
- [x] TDI advisory/shadow hale getirildi
- [x] Deterministic risk authority tekleştirildi
- [x] Live synthetic trading data kaldırıldı
- [x] MarketData abstraction Phase 2 için hazır
- [x] High-priority rate-limit bypass kaldırıldı
- [x] Candidate pipeline trace oluşuyor
- [x] Candidate reject reason'ları machine-readable
- [x] Relevant Phase 1 tests PASS
- [ ] Full-repo typecheck PASS (pre-existing extras)
- [ ] Production build PASS (session lock)
- [x] Live gerçek fon kullanılmadı
- [x] Static call graph canonical pipeline'ı doğruluyor
