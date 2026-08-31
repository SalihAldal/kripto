# KRIPTO P2 — Post AI-Reliability Gate (Phase A + Phase B)

> Generated: 2026-08-23T18:18:58.288Z

## GLOBAL FINAL VERDICT

```
AI_RELIABILITY_FIX = PASS
AI_RELIABILITY_LIVE_EFFECT = POSITIVE
EV_689_ANOMALIES = 856
EV_TRUE_FALSE_REJECTS = 0
EV_FALSE_REJECTS = 0
EV_ORDERING_ROOT_CAUSE = DUPLICATE_GATE
EV_ENGINEERING_TARGET = FIX_EV_DUPLICATE_GATE
THRESHOLDS_CHANGED = NO
AI_VETO_CHANGED = NO
RISK_CHANGED = NO
SIZING_CHANGED = NO
NEXT_ENGINEERING_TASK = Telemetry-only FIX_EV_DUPLICATE_GATE (separate hybrid reject reasonCode); then controlled 30-round paper only if remote AI providers restored
```

---

## Phase A — 5-Round Controlled Paper

**Session:** `cmt6371a00009unk8kb84hssc`

| Metric | Pre-fix baseline | Post-fix |
|--------|----------------|----------|
| AI_NO_RESPONSE round-global | 1 | **0** |
| AI_DECISION_CONFLICT round-global | 4 | **0** |
| Round fail AI_PROVIDER_DEGRADED | — | 3 rounds (2,3,5) |

```
FIVE_ROUNDS_COMPLETED = YES
AI_NO_RESPONSE_GLOBAL_FAILURES = 0
AI_PROVIDER_DEGRADED_CANDIDATE_LOCAL = 0
HEALTHY_CANDIDATE_CONTINUATION = 0
EXECUTION_READY = 0
TRADES = 0
NET_PNL = 0
AI_STARTED_ORPHANS = 0
ZOMBIES = 0
AI_RELIABILITY_EFFECT = POSITIVE
READY_FOR_30_ROUNDS = CONDITIONAL
```

**Round 1:** 300 degraded calls, 231 `UNAVAILABLE_EVIDENCE` consensus votes — fake expert votes suppressed.

**Remaining blockers:** SIM_TIGHT_FILTER (rounds 1,4); all-remote providers still unavailable (0 healthy remote); round-terminal `AI_PROVIDER_DEGRADED` on rounds 2/3/5.

---

## Phase B — EV Ordering Forensic (offline)

- **856 anomalies** in primary session (`EV_REJECT` + `expectedValue >= threshold`)
- **100% classified DUPLICATE_GATE** — not independent EV formula false rejects
- **Root:** `hybrid-decision-engine.ts` → `bridgeHybridEv` mirrors `finalDecision` into EV telemetry; `reasonCode=EV_REJECT` even when composite ≥ threshold
- **EV_FALSE_REJECTS = 0** — telemetry labeling issue, not threshold math bug

**Engineering target:** `FIX_EV_DUPLICATE_GATE` (telemetry-only; no threshold change)

---

## Outputs

### Phase A
- `KRIPTO_P2_POST_AI_RELIABILITY_5ROUND_REPORT.md`
- `kripto-p2-post-ai-reliability-5round.json`
- `kripto-p2-post-ai-reliability-rounds.csv`
- `kripto-p2-post-ai-reliability-ai.csv`
- `kripto-p2-post-ai-reliability-trades.csv` (no_data)
- `kripto-p2-post-ai-reliability-pnl.csv` (no_data)

### Phase B
- `kripto-p2-ev-ordering-689-analysis.csv`
- `kripto-p2-ev-ordering-summary.json`
- `kripto-p2-ev-engineering-spec.json`
