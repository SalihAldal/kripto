# KRIPTO — 46-Round Zero-Trade Forensic Root Cause

**Report ID:** `kripto-46round-zero-trade-forensic`  
**Method:** Read-only artifact aggregation — **no code changes, no new paper run**  
**Machine-readable output:** [`kripto-46round-zero-trade-forensic.json`](kripto-46round-zero-trade-forensic.json)

---

## 1. Run identification

| Field | Value |
|-------|-------|
| **Canonical run** | **YES** |
| **jobId / sessionId** | `cmstltuqn0007un9ksbk3xn9c` |
| **Resumed from** | `cmstkgy6j0022unm8lannq6cg` |
| **analysisId** | — |
| **startedAt** | `2026-08-15T00:25:11.096Z` (round 1) |
| **endedAt** | `2026-08-15T07:35:00.703Z` (round 46) |
| **Duration** | ~7.16 h (25,767,217 ms summed round durations) |
| **roundCount** | **46** (46 forensic artifact folders) |
| **tradeCount** | **0** |
| **orderCount** | **0** |
| **fillCount** | **0** |
| **failedRounds** | **46 / 46** |

**Other local runs (not canonical):**

| jobId | Round artifacts | Notes |
|-------|-----------------|-------|
| `cmstkgy6j0022unm8lannq6cg` | 2 | Prior job; resumed into canonical run |
| `cmstjiruf0007unr8e78nizga` | 3 | 5-round smoke; also 0 trades |

**Artifact root:** `artifacts/forensics/cmstltuqn0007un9ksbk3xn9c/rounds/{1..46}/`

---

## 2. 46-round aggregate funnel

Canonical funnel (TOTAL across 46 rounds):

```
SCANNER discovered     11,585
        ↓
TDI APPROVED                0   ← FIRST ZERO
TDI WAIT                6,094   (NEUTRAL 5,736 · BELOW_THRESHOLD 358)
TDI REJECTED           11,532
        ↓
SIZING passed               0   (risk-sizing-trace empty all rounds)
        ↓
EXECUTION_READY             0
        ↓
AI invoked                191   (ai-progress candidates)
AI gate blocks            596   (execution-stage VETO)
        ↓
CONSENSUS approved          0
        ↓
RISK passed                 0   (NOT_REACHED in traces)
        ↓
ORDERS                      0
        ↓
FILLS                       0
        ↓
TRADES                      0
```

**Dominant rejection reasons (cumulative funnel counters):**

| Reason | Count |
|--------|------:|
| CONSENSUS_REJECT | 12,216 |
| AI_FAILED | 11,398 |
| TDI_REJECTED | 8,678 |
| PUMP_CONFIRM_NO_TRADE | 6,359 |
| SCANNER_REJECT | 4,897 |
| EV_REJECT | 4,433 |
| AI_GATE_BLOCK: NO_TRADE | 298 |
| NO_TRADE (execution) | 596 |

**Terminal round fail reasons (one per round):**

| Reason | Rounds |
|--------|-------:|
| `AI_GATE_BLOCK: NO_TRADE` | 20 |
| `AI_NO_RESPONSE` | 12 |
| `SIM_TIGHT_FILTER_15m` | 11 |
| Heartbeat timeout | 1 |
| Selection timeout (1200s) | 1 |
| `PUMP_SCAN_FAILED` | 1 |

---

## 3. Round-by-round table

| R | Symbol | Cand | TDI A/W/R | AI | Gate | Ord | Fail reason (short) |
|--:|--------|-----:|-----------|---:|-----:|----:|---------------------|
| 1 | — | 0 | 0/0/0 | 0 | 0 | 0 | Heartbeat timeout |
| 2 | FLOKITRY | 17 | 0/13/25 | 4 | 0 | 0 | SIM_TIGHT_FILTER |
| 3 | API3TRY | 19 | 0/25/47 | 2 | 0 | 0 | AI_NO_RESPONSE |
| 4 | ENSOTRY | 6 | 0/31/0 | 2 | 2 | 0 | **AI_GATE_BLOCK** |
| 5 | CFXTRY | 19 | 0/—/— | 8 | 2 | 0 | SIM_TIGHT_FILTER |
| 6 | CFGTRY | 7 | 0/—/— | 2 | 4 | 0 | **AI_GATE_BLOCK** |
| 7 | BONKTRY | 6 | 0/—/— | 2 | 4 | 0 | AI_NO_RESPONSE |
| 8 | AITRY | 6 | 0/—/— | 2 | 6 | 0 | **AI_GATE_BLOCK** |
| 9 | ONETRY | 6 | 0/—/— | 2 | 6 | 0 | AI_NO_RESPONSE |
| 10 | SAGATRY | 14 | 0/—/— | 10 | 8 | 0 | **AI_GATE_BLOCK** |
| 11 | NEIROTRY | 13 | 0/—/— | 2 | 10 | 0 | **AI_GATE_BLOCK** |
| 12 | LINKTRY | 11 | 0/—/— | 7 | 12 | 0 | **AI_GATE_BLOCK** |
| 13 | RADTRY | 6 | 0/—/— | 2 | 14 | 0 | **AI_GATE_BLOCK** |
| 14 | TSTTRY | 2 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 15 | SHIBTRY | 22 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 16 | USTCTRY | 24 | 0/—/— | 18 | 16 | 0 | **AI_GATE_BLOCK** |
| 17 | CHIPTRY | 2 | 0/—/— | 2 | 16 | 0 | AI_NO_RESPONSE |
| 18 | BNBTRY | 15 | 0/—/— | 8 | 16 | 0 | **AI_GATE_BLOCK** |
| 19 | ACTTRY | 14 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 20 | CHIPTRY | 32 | 0/—/— | 3 | 16 | 0 | AI_NO_RESPONSE |
| 21 | AITRY | 12 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 22 | XLMTRY | 9 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 23 | XAUTTRY | 14 | 0/—/— | 4 | 16 | 0 | AI_NO_RESPONSE |
| 24 | SPELLTRY | 8 | 0/—/— | 4 | 16 | 0 | AI_NO_RESPONSE |
| 25 | SOLTRY | 9 | 0/—/— | 5 | 16 | 0 | SIM_TIGHT_FILTER |
| 26 | RADTRY | 7 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 27 | PORTALTRY | 6 | 0/—/— | 2 | 16 | 0 | AI_NO_RESPONSE |
| 28 | SANDTRY | 8 | 0/—/— | 4 | 16 | 0 | **AI_GATE_BLOCK** |
| 29 | UNITRY | 6 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 30 | NILTRY | 7 | 0/—/— | 3 | 16 | 0 | **AI_GATE_BLOCK** |
| 31 | MAGICTRY | 6 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 32 | MANTRATRY | 6 | 0/—/— | 2 | 16 | 0 | AI_NO_RESPONSE |
| 33 | LUMIATRY | 8 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 34 | MAGICTRY | 10 | 0/—/— | 4 | 16 | 0 | SIM_TIGHT_FILTER |
| 35 | MEMETRY | 6 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 36 | IOTRY | 6 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 37 | TURBOTRY | 6 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 38 | PENGUTRY | 8 | 0/—/— | 2 | 16 | 0 | SIM_TIGHT_FILTER |
| 39 | SOMITRY | 2 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 40 | STRKTRY | 12 | 0/—/— | 8 | 16 | 0 | AI_NO_RESPONSE |
| 41 | — | 31 | 0/—/— | 22 | 16 | 0 | Selection timeout |
| 42 | ENATRY | 6 | 0/—/— | 2 | 16 | 0 | **AI_GATE_BLOCK** |
| 43 | METRY | 26 | 0/—/— | 8 | 16 | 0 | SIM_TIGHT_FILTER |
| 44 | SKLTRY | 14 | 0/—/— | 5 | 16 | 0 | AI_NO_RESPONSE |
| 45 | PENGUTRY | 12 | 0/—/— | 4 | 16 | 0 | AI_NO_RESPONSE |
| 46 | SAGATRY | 14 | 0/173/0 | 10 | 16 | 0 | PUMP_SCAN_FAILED |

**Stable invariant across all 46 rounds:** `tdiApproved = 0`, `executionReady = 0`, `orders = 0`.

---

## 4. First blocking stage

**Classification: `TDI_BOTTLENECK`**

| Step | Stage | Count |
|------|-------|------:|
| Prior | SCANNER discovered | 11,585 |
| **Blocked** | **TDI APPROVED** | **0** |

Mathematical rule: first stage after a positive upstream count that drops to **zero** for the entire run.

**Quantitative proof:**

- **17,626** TDI records across 46 rounds (`6094 WAIT + 11532 REJECTED + 0 APPROVED`)
- **0** sizing records in any `risk-sizing-trace.json`
- **0** execution-ready verdicts (`stage=execution, verdict=APPROVED`)

**Threshold paradox (round 46 `tdi-sensitivity.json`):**

| Metric | Value |
|--------|------:|
| Configured TDI threshold | 55 |
| Simulated approval rate at threshold 55 | **28.4%** |
| **Actual approval rate** | **0%** |

Scores alone would approve ~28% of candidates; the **master decision engine** converts all outcomes to WAIT/REJECTED/NO_TRADE. This is not merely "threshold too high."

---

## 5. AI analysis

| Metric | Total |
|--------|------:|
| AI candidates invoked (ai-progress) | 191 |
| AI completed | 175 |
| AI failed | 11 |
| Remote AI calls (ai-trace) | 11,124 |
| Degraded calls | 1,338 |
| Execution-stage AI gate blocks | 596 |
| Terminal rounds ending AI_GATE_BLOCK | 20 |

**Decision distribution (decision-trace reason codes, aggregate):**

- REJECT-class: 13,575+
- NO_TRADE: 894+
- HOLD: 298
- APPROVE: **0**

**This is not an AI outage.** AI is invoked and completes in most cases. Failures are **decision-level NO_TRADE**, not provider unavailability.

**Round 4 proof (`decision-trace.json`, ENSOTRY):**

```json
"aiGatePolicy": "VETO",
"aiGateVerdict": "AI_GATE_BLOCK",
"executionVerdict": "AI_GATE_BLOCK",
"orderVerdict": "BLOCKED",
"sizingVerdict": "NOT_REACHED",
"riskVerdict": "NOT_REACHED"
```

---

## 6. TDI analysis

**WAIT taxonomy (6,094 waits):**

| reasonCode | Count | % |
|------------|------:|--:|
| NEUTRAL | 5,736 | 94.1% |
| BELOW_THRESHOLD | 358 | 5.9% |
| NO_SLOT | 0 | 0% |
| COOLDOWN | 0 | 0% |
| RISK | 0 | 0% |

**Dominant detail strings:**

- "Momentum guven vermiyor"
- "NO_TRADE resolved by master decision engine"
- "Blocked/reduced by **LEARNING** and **MOMENTUM**"

**Round 46 slot report:** all slot selections show `tdiVerdict: REJECTED` (`slot-opportunity-report.json`).

---

## 7. Sizing analysis

**Not reached.** All 46 `risk-sizing-trace.json` files contain `"riskSizing": []`.

| Boundary bucket | Count |
|-----------------|------:|
| below 40 | 0 |
| 40–44 | 0 |
| 45 | 0 |
| 46–49 | 0 |
| 50+ | 0 |

**Conclusion:** No sizing boundary trap. Pipeline dies before sizing on every round.

---

## 8. Risk analysis

**Not reached.** Zero risk pass/reject records. Decision traces explicitly show `riskVerdict: NOT_REACHED` on round-winner execution attempts.

---

## 9. Execution analysis

**Orders created:** 0 across all `execution-trace.json` files.

Two paths observed:

1. **Slot pipeline:** blocked at TDI (never execution-ready).
2. **Round-winner pipeline:** pump/scanner selects symbol → AI analysis → `AI_GATE_BLOCK: NO_TRADE` under **VETO** → order blocked.

Path 2 accounts for **20/46** terminal failures. Example round 4: ENSOTRY selected, TDI REJECTED on same symbol, AI returns NO_TRADE, VETO blocks at execution. Sizing and risk never run.

**This is `AI_VETO_BOTTLENECK` — not a gate malfunction.** VETO is working as configured.

---

## 10. Scanner analysis

Scanner is **not** the primary zero-trade cause.

| Metric | Evidence |
|--------|----------|
| Universe per round | ~500 symbols (`scanner-summary.json`) |
| Qualified per cycle | ~95 eligible (round 46 example) |
| Summary candidateCount | 499 total across 46 rounds (excl. R1) |
| Qualification rejections | Present but downstream stages still receive candidates |

Scanner produces candidates normally; they are eliminated at TDI/AI/consensus stages.

**Data quality rejections (aggregate):**

- `CHANGE24H_FALLBACK`: 440
- `PRICE_STALE`: 98

These contribute but do not alone explain 0/46 trades.

---

## 11. Config snapshot

**Source:** `rounds/46/resolved-config.json` + runtime traces + `lib/config.ts` defaults

| Setting | Resolved value |
|---------|----------------|
| executionMode | paper |
| exchange | binance |
| **EXECUTION_AI_GATE_POLICY** | **VETO** (trace-proven) |
| maxPositions | 3 |
| TDI threshold | 55 |
| EV minRiskRewardRatio | 1.25 |
| EV minTradeQualityScore | 45 |
| AI minConfidence | 60 |
| aiMode | learning |
| remoteRequired | false |
| scanner universe | ALL_SPOT (max 1200) |
| selection budget | 1200s |
| taker fee | 0.15% |

**Config mismatch hypothesis:** REJECTED — threshold sensitivity shows 28.4% would pass at 55, but actual approval is 0%. Problem is decision engine behavior, not a single threshold misread in resolved-config.

---

## 12. Local historical comparison

**NO_LOCAL_HISTORICAL_COMPARISON_AVAILABLE**

Repo search of all `artifacts/**/round-summary.json`: **zero files with `tradeCount > 0`**. No local paper run with executed trades exists for stage-by-stage comparison.

Prior smoke run `cmstjiruf0007unr8e78nizga` (3 rounds, same VETO policy) also produced **0 trades** with identical TDI/AI gate pattern.

---

## 13. Code/config drift

- Git history on key files shows only `94c564a Sync local kripto platform codebase` — insufficient granular history for drift proof.
- No resolved-config snapshot from an executing run exists locally.
- **Inference only:** current zero-trade pattern matches the Aug 14 smoke run; likely not a new regression introduced mid-run, but a **stable pipeline configuration** that blocks all entries.

---

## 14. Primary root cause

### Why did Native Kripto produce ZERO trades across ~46 rounds?

**ONE PRIMARY ROOT CAUSE:**

> **`TDI_BOTTLENECK` — the Master Decision Engine emits zero `APPROVED` TDI verdicts across all 17,626 decisions in 46 rounds, preventing any execution-ready candidate on the slot pipeline. Round-winner symbols that bypass slot approval reach the execution gate but are terminated by `AI_VETO_BOTTLENECK` (AI finalDecision=NO_TRADE under VETO policy).**

| Evidence | Value |
|----------|-------|
| TDI APPROVED | **0 / 17,626** |
| Execution-ready | **0 / 46 rounds** |
| Orders | **0** |
| Simulated TDI approval at threshold 55 | 28.4% |
| Actual TDI approval | **0%** |
| AI gate blocks at execution | **596** |
| Terminal AI_GATE_BLOCK rounds | **20 / 46** |

**PROFITABILITY_CANNOT_BE_EVALUATED_YET** — zero trades means no execution sample. This is category **A) SYSTEM DOES NOT FIND / ALLOW TRADES**, not **B) SYSTEM ALLOWS TRADES BUT THEY LOSE**.

---

## 15. Contributing causes (max 5)

| Priority | Class | Stage | Count / % | Confidence |
|----------|-------|-------|-----------|------------|
| P0 | **AI_VETO_BOTTLENECK** | EXECUTION | 596 gate blocks; 20 terminal rounds | HIGH |
| P1 | **AI_DECISION_BOTTLENECK** | AI/CONSENSUS | 12,216 CONSENSUS_REJECT + 6,359 PUMP_CONFIRM_NO_TRADE | HIGH |
| P1 | Master decision LEARNING/MOMENTUM penalty | TDI | 94% NEUTRAL waits | HIGH |
| P2 | **SIM_TIGHT_FILTER** | Pre-execution | 11 terminal rounds | MEDIUM |
| P2 | **AI_NO_RESPONSE** | AI | 12 terminal rounds | MEDIUM |

**Blocker pattern:** One **stable** upstream invariant (`tdiApproved=0` every round) plus **alternating** terminal reasons (AI gate vs SIM filter vs AI stall).

---

## 16. 100-round recommendation

### **NO**

The system is blocked **before order creation** in **46/46** rounds. A 100-round run would reproduce the same zero-trade funnel and consume ~15+ hours of compute without generating an execution sample.

**Conditions under which 100 rounds would become useful:**

1. Controlled 2-round validation shows `tdiApproved > 0` OR `ordersCreated > 0`
2. At least one round completes with `executionReady > 0` and passes risk/sizing
3. AI gate blocks drop below 100% of round-winner paths **after** fixing upstream TDI/master-decision emission

---

## 17. Exact next steps

1. **Forensic deep-dive:** Why `tdi-sensitivity.json` simulates 28.4% approval at threshold 55 but runtime emits 0% APPROVED — trace master decision engine LEARNING/MOMENTUM penalties (`tdi-decisions.json` reasonDetail pattern).
2. **Round-winner path:** For the 20 `AI_GATE_BLOCK` terminal rounds, extract per-symbol AI consensus inputs (tech/sentiment/risk scores) and identify why finalDecision is always NO_TRADE before VETO.
3. **Do not** change thresholds, AI prompts, risk limits, or symbol allowlists until step 1 proves the blocking mechanism.
4. **Do not** start 100 rounds.
5. Run a **2-round controlled validation** after a targeted fix; success criterion = `ordersCreated >= 1` OR documented intentional VETO with APPROVE upstream.
6. Optional baseline: compare against `cmstjiruf0007unr8e78nizga` smoke artifacts (same VETO, same zero-trade funnel).

---

*End of forensic report. Facts sourced exclusively from `artifacts/forensics/cmstltuqn0007un9ksbk3xn9c/` and related local artifacts.*
