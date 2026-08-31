# KRIPTO P2 — 37 Actionable Top-Gainer Cohort Deep Decision Replay

> Generated: 2026-08-23T12:43:36.229Z
> Research only — no implementation, no paper runs

## PART 1 — 37 Cohort

**49 discovered** − **12 move-before-discovery** = **37 actionable**

Excluded (move before discovery): GASTRY, SLPTRY, CHIPTRY, POLTRY, GIGGLETRY, GPSTRY, ONTTRY, BOMETRY, MMTTRY, ZKCTRY, HEITRY, COTITRY

| Symbol | firstSeenAt | maxGain% | firstBlockerGate | finalBlockerGate | evidenceClass |
|--------|-------------|----------|------------------|------------------|---------------|
| ICPTRY | 2026-08-22T23:47:33Z | 13.64 | scanner | consensus | MULTI-GATE_INTERACTION |
| EULTRY | 2026-08-22T23:44:31Z | 8.97 | scanner | consensus | MULTI-GATE_INTERACTION |
| STRAXTRY | 2026-08-22T23:21:16Z | 8.20 | scanner | consensus | MULTI-GATE_INTERACTION |
| FFTRY | 2026-08-22T23:17:07Z | 7.42 | ai | consensus | AI_DEGRADATION |
| PORTALTRY | 2026-08-22T23:17:31Z | 7.15 | scanner | scanner | MULTI-GATE_INTERACTION |
| EGLDTRY | 2026-08-22T23:22:58Z | 6.34 | ai | scanner | MULTI-GATE_INTERACTION |
| RAYTRY | 2026-08-22T23:18:32Z | 5.83 | scanner_spread | consensus | MULTI-GATE_INTERACTION |
| AMPTRY | 2026-08-22T23:23:12Z | 5.47 | scanner | consensus | MULTI-GATE_INTERACTION |
| THETRY | 2026-08-22T23:21:01Z | 4.57 | scanner | ev | MULTI-GATE_INTERACTION |
| ZROTRY | 2026-08-22T23:18:42Z | 4.44 | scanner | scanner | MULTI-GATE_INTERACTION |
| HYPERTRY | 2026-08-22T23:46:24Z | 4.36 | scanner | scanner | MULTI-GATE_INTERACTION |
| SOLTRY | 2026-08-22T23:21:45Z | 4.30 | ai | ai | MULTI-GATE_INTERACTION |
| ENSTRY | 2026-08-23T00:32:16Z | 4.28 | scanner | consensus | MULTI-GATE_INTERACTION |
| RETRY | 2026-08-22T23:20:57Z | 4.12 | scanner | consensus | MULTI-GATE_INTERACTION |
| DASHTRY | 2026-08-22T23:21:03Z | 4.02 | scanner | scanner | MULTI-GATE_INTERACTION |

## PART 3 — First vs Final Blocker

**FIRST_BLOCKER distribution (pipeline-normalized):**
```json
{
  "scanner": 27,
  "ai": 10
}
```

**FINAL_BLOCKER distribution:**
```json
{
  "consensus": 15,
  "scanner": 15,
  "ev": 3,
  "ai": 4
}
```

Key distinction: `scanner_spread` (PRE_AI_SPREAD_REJECT) is attributed to **scanner** gate, not AI. Batch `decision|TDI_REJECTED` artifacts are excluded from TDI counts.

## PART 14 — Counterfactual Release (single gate removal)

Removing **scanner family only** → **5** candidates would have no remaining blockers (research-only, not BUY).

## PART 17 — Root Cause Ranking

| Cause | Affected | Share of 37 | FN | Legit |
|-------|----------|-------------|----|-------|
| SCANNER_GENERIC_REJECT | 21 | 0.57 | 8 | 13 |
| AI_DEGRADED_PATH | 9 | 0.24 | 9 | 0 |
| PRE_AI_SPREAD_REJECT | 7 | 0.19 | 2 | 4 |

## PART 18–19 — Engineering Spec (do not implement)

```json
{
  "selectedFix": "FIX_SCANNER",
  "category": "SCANNER_FIX",
  "file": "src/server/scanner/scanner.service.ts",
  "function": "PRE_AI spread gate + scanner reject reason surfacing",
  "condition": "spreadPercent > maxPreAiSpreadPercent && !momentumBreakout.ok; scanner REJECTED without reasonDetail",
  "currentBehavior": "Spread gate cancels AI-bound candidates (PRE_AI_SPREAD_REJECT); 23/37 first-blocker events are scanner|REJECTED with empty underlying condition in artifacts",
  "expectedBehavior": "Surface exact reject condition at scanner stage; shadow-evaluate spread+momentumBreakout before hard veto on qualified symbols",
  "minimalChange": "Add reject-reason telemetry at scanner qualification + shadow spread+momentum gate; single-variable paper validation before threshold change",
  "implementInThisTask": false,
  "researchExecutionReadyAfterFix": 5
}
```

## PART 21 — Top 10 Cases

| Rank | Symbol | Gain % | First | Final | Root cause | Why rejected | Scanner fix release? |
|------|--------|--------|-------|-------|------------|--------------|----------------------|
| 1 | ICPTRY | 13.64 | scanner | consensus | SCANNER_GENERIC_REJECT | GENERIC_REJECTED | false |
| 2 | EULTRY | 8.97 | scanner | consensus | SCANNER_GENERIC_REJECT | GENERIC_REJECTED | false |
| 3 | STRAXTRY | 8.20 | scanner | consensus | SCANNER_GENERIC_REJECT | SCANNER_REJECT | false |
| 4 | FFTRY | 7.42 | ai | consensus | AI_DEGRADED_PATH | AI_DEGRADED | false |
| 5 | PORTALTRY | 7.15 | scanner | scanner | SCANNER_GENERIC_REJECT | SCANNER_REJECT | false |
| 6 | EGLDTRY | 6.34 | ai | scanner | PRE_AI_SPREAD_REJECT | SPREAD_TOO_WIDE | false |
| 7 | RAYTRY | 5.83 | scanner_spread | consensus | PRE_AI_SPREAD_REJECT | SPREAD_TOO_WIDE | false |
| 8 | AMPTRY | 5.47 | scanner | consensus | SCANNER_GENERIC_REJECT | SCANNER_REJECT | false |
| 9 | THETRY | 4.57 | scanner | ev | SCANNER_GENERIC_REJECT | SCANNER_REJECT | false |
| 10 | ZROTRY | 4.44 | scanner | scanner | SCANNER_GENERIC_REJECT | SCANNER_REJECT | false |

## PART 22 — Systematic Patterns (correlation, not causation)

1. **multiGateInteraction**: 30/37
2. **genericScannerReject**: 15/37
3. **consensusFinal**: 15/37
4. **highVolatilityRegime**: 10/37
5. **aiDegraded**: 9/37
6. **highSpread**: 5/37
7. **lowMomentum**: 0/37

## PART 23 — 10-Round Campaign Cross-Reference

```json
{
  "rounds": 10,
  "trades": 0,
  "cohortSeen": 37,
  "cohortBlocked": 37,
  "cohortAiReached": 35,
  "cohortEvReached": 28,
  "executionReady": 0
}
```

## PART 24 — Final Engineering Decision

**PRIMARY_FIX = FIX_SCANNER** — supported by SCANNER_GENERIC_REJECT (56.8% of cohort first-root attribution).

TDI blocked: **0** (batch decision-trace TDI_REJECTED excluded). EV blocked at final: **3**. Execution-ready in campaign: **0**.

## FINAL VERDICT

```
ACTIONABLE_COHORT = 37
FIRST_BLOCKER_DISTRIBUTION = {"scanner":27,"ai":10}
FINAL_BLOCKER_DISTRIBUTION = {"consensus":15,"scanner":15,"ev":3,"ai":4}
FALSE_NEGATIVE_COUNT = 19
LEGITIMATE_REJECTION_COUNT = 17
DATA_QUALITY_FALSE_NEGATIVE_COUNT = 0
AI_FALSE_NEGATIVE_COUNT = 9
EXECUTION_LATENCY_COUNT = 0
MULTI_GATE_INTERACTION_COUNT = 30
PRIMARY_ROOT_CAUSE = SCANNER_GENERIC_REJECT
PRIMARY_ROOT_CAUSE_SHARE = 0.568
SECONDARY_ROOT_CAUSE = AI_DEGRADED_PATH
RESEARCH_EXECUTION_READY_AFTER_PRIMARY_FIX = 5
PRIMARY_FIX = FIX_SCANNER
LOOKAHEAD_VIOLATIONS = 0
LOSS_CONTROL = PARTIAL
EVIDENCE_CONFIDENCE = MEDIUM
PRODUCTION_CHANGE_RECOMMENDED = NO
NEXT_ENGINEERING_TASK = Add reject-reason telemetry at scanner qualification + shadow spread+momentum gate; single-variable paper validation before threshold change
```
