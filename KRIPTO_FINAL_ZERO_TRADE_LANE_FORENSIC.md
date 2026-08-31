# KRIPTO — FINAL PAPER ZERO-TRADE LANE FORENSIC

Generated: 2026-08-28T14:49:58.620Z
Job: `cmtc4c2ds0009un70ir6hlcqm` | Methodology: READ_ONLY (no paper run, no code change)

---

## Part 1 — 50-Round Reconstruction

All 50 rounds reconstructed from `artifacts/_50round-db-export.json`. Per-round detail: `kripto-50round-lane-replay.csv`.

| Classification | Rounds | % |
|----------------|--------|---|
| AI_VETO (downstream NO_TRADE) | 31 | 62% |
| NO_TRADE_LANE_EMPTY | 18 | 36% |
| RUNTIME | 1 | 2% |

**Two-phase behavior observed:**
- **Phase A (rounds 2–32):** `tradable.length > 0` after `isPaperApprovedLane` filter → symbol selected → AI returns `NON_EXECUTABLE_DECISION: NO_TRADE`
- **Phase B (rounds 33–50):** `tradable.length === 0` → pump/steady/last-resort ladder all empty → terminal `Paper NO_TRADE: pump ve steady-gain adayi yok`

Round-level forensics exported for **1/50** rounds only; DB metadata used for rounds 2–50.

---

## Part 2 — Exact Paper Lane Logic

File: `src/server/scanner/fast-entry.service.ts`

### Admission paths (two distinct code paths)

**Path 1 — tradable > 0 (lines 1800–1802, 2041–2065):**
`primary.filter(isPaperApprovedLane)` → `pickFocusedCandidate` → downstream gates

**Path 2 — tradable === 0 + usePaperProfile (lines 1927–2012):**
1. `selectPumpFastEntry()`
2. `selectPaperPumpLaneCandidates()` — priority **>= 70** (hardcoded, not paper 50)
3. `selectPaperSteadyGainCandidates()` — AI **BUY** required, spread <= 0.14, composite >= 66
4. `passesPaperLastResortQuality()` — spread <= 0.90, score >= 25, !stable

### isPaperApprovedLane (L177–235) — approval OR-gate

| Branch | Key conditions | Paper threshold | Missing → |
|--------|----------------|-----------------|-----------|
| metricPumpLane | topGainerPump + momentum composite | priority >= **50**, change24h >= 1.5% | 0 → fail |
| steadyGainLane | composite/confidence OR AI BUY | spread <= 0.60, risk <= 92 | AI missing → composite fallback |
| paperBasicLane | spread + score | score >= 28, spread <= 0.80 | — |
| lastResort | passesPaperLastResortQuality | spread <= 0.90, score >= 25 | stable symbol → reject |

**Bug:** `isPaper` uses `env.EXECUTION_MODE === 'paper'` only — ignores `usePaperProfile`.

### selectPaperPumpLaneCandidates (L1219–1316) — active selector

| Field | Source | Threshold | Missing |
|-------|--------|-----------|---------|
| topGainerPriorityScore | meta | **>= 70 always** | 0 → fail |
| spreadPercent | context | <= 0.32 | fail |
| fakeSpikeScore | context | <= 3 | fail |
| volume24h | context | >= MIN * 0.5 | 0 → fail |
| metricPump/strongPump | breakout + momentum | composite | missing momentum → fail |
| AI | candidate.ai | required, !rejected | missing → filter out |

### selectPaperSteadyGainCandidates (L1169–1217)

| Field | Threshold | Missing |
|-------|-----------|---------|
| AI finalDecision | BUY | missing → reject |
| spreadPercent | <= 0.14 | fail |
| composite (3 roles) | >= 66 | missing roles → fail |
| finalRiskScore | <= 66 | missing → 100 → fail |
| shortMomentum/shortFlow | >= 0.03 / 0.018 | 0 → fail |

### passesPaperLastResortQuality (L322–334)

| Field | Threshold | Missing |
|-------|-----------|---------|
| spreadPercent | <= 0.90 | fail |
| score.score | >= 25 | fail |
| stable symbols | USDTTRY etc. | reject |

---

## Part 3 — Lane Decision Replay (50 rounds)

Pump/steady/last-resort lane outputs in 50-round run: **0 / 0 / 0** (no candidate passed active selectors).

| Round range | pumpLane | steadyGainLane | lastResort | finalPaperAdmission | failing condition |
|-------------|----------|----------------|------------|---------------------|-------------------|
| 2–32 | NO | NO | NO | PASS via Path 1 (isPaperApprovedLane) | N/A — admitted then AI NO_TRADE |
| 33–50 | NO | NO | NO | FAIL | PUMP_STEADY_LAST_RESORT_ALL_EMPTY |

Candidate-level replay for 2278 historical pool: see `kripto-p2-entry-funnel-2278.csv` (0 newlyApproved in current stack).

---

## Part 4 — Data Contract Audit

| Input | Classification | Silent FALSE risk |
|-------|----------------|-------------------|
| change24h | VALID/MISSING→0 | YES — fails metricPumpLane |
| shortMomentum / hourMomentum | MISSING→0 | YES — pump + steady gates |
| volume24h | MISSING→0 | YES — pump selector volume gate |
| spread | VALID | Primary top50 blocker (PRE_AI_SPREAD_REJECT) |
| pump flags | DEFAULT false | YES unless discovery flags set |
| regime | DEFAULT RANGE_SIDEWAYS | YES — steady-gain regime filter |
| AI decision | MISSING | YES — steady selector hard-requires BUY |
| topGainerPriority | IMPLEMENTATION_MISMATCH | approval 50 vs selector 70 |

No evidence of STALE timestamp suppression in 50-round DB records. DATA_QUALITY_FALSE_REJECTIONS: **0** (from 37-cohort root ranking).

---

## Part 5 — Top 50 Gainer Correlation

Source: `kripto-global-missed-opportunity-forensic.json` + `kripto-top50-lane-correlation.csv`

| Metric | Value |
|--------|-------|
| TOP50 discovered (runtime window) | **49/50** |
| TOP50 blocked | **49/50** |
| Reached AI | 47/50 |
| Reached EV | 43/50 |
| pumpLane reached | ~0 (blocked pre-lane) |
| False lane rejections (37-shadow proxy) | 19 |

Primary blockers: `scanner|REJECTED`, `PRE_AI_SPREAD_REJECT`, `AI_DEGRADED` — **before** lane admission.

---

## Part 6 — 37 Actionable Cohort

| Stage | Killed |
|-------|--------|
| Before TDI (scanner/spread) | **27/37** |
| After TDI | 0/37 |
| After AI | **10/37** |
| After EV | 0/37 |
| executionReady | 0/37 |

Detail: `kripto-37-lane-correlation.csv`

---

## Part 7 — False Negative Analysis

| Category | Count | Notes |
|----------|-------|-------|
| LEGITIMATE_NO_TRADE | 360 (proxy) | No valid pump/steady/last-resort signal at decision time |
| FALSE_LANE_REJECTION | 19 | Observable candidate + valid data + classification error |
| DOWNSTREAM_FALSE_BLOCK | 31 rounds | Symbol admitted but AI NO_TRADE — not a lane false negative |

Not every missed gainer is a false negative. Top gainers mostly fail at scanner/AI spread **before** lane.

---

## Part 8 — Counterfactual Lane Matrix (OFFLINE)

`kripto-lane-counterfactuals.csv` — 2278 candidate pool replay:

| Scenario | Admitted | Exec-ready potential |
|----------|----------|---------------------|
| A) current | 0 | 0 |
| B) pump removed | 383 | 57 (TDI WAIT still blocks) |
| C) steady removed | 0 | 0 |
| D) last-resort enabled | 841 | 0 (downstream TDI WAIT) |
| E) missing data corrected | 383 | 0 |

**Conclusion:** Lane-only changes do not reach execution-ready without downstream gate movement.

---

## Part 9 — Loss Control

`kripto-lane-loss-control.csv`

| Cohort | Verdict |
|--------|---------|
| 42 profitable historical | FAIL — TDI WAIT blocks all even if lane opens |
| 206 losses | FAIL — same suppression |
| 173 paired executed | PARTIAL — trades existed under different gate stack |
| 2278 current candidates | FAIL — lane release ≠ execution-ready |

---

## Part 10 — Downstream Check

For hypothetically admitted candidates (counterfactual B/D), next blocker is **TDI WAIT** in >90% of released pool. Lane strictness is **not** the only bottleneck — downstream TDI/AI/EV would still block.

---

## Part 11 — Zero-Trade Causality Chain

```
50 rounds
  → ~980 scanner candidates
  → 31 symbol selections (Path 1: isPaperApprovedLane tradable>0)
  → 18 lane-empty terminations (Path 2: pump+steady+lastResort all fail)
  → 0 TDI approved
  → 31 AI NO_TRADE
  → 0 consensus approved
  → 0 EV approved
  → 0 execution-ready
  → 0 trades
```

Detail: `kripto-50round-candidate-waterfall.csv`

---

## Part 12 — Policy vs Bug Decision

**PRIMARY_ZERO_TRADE_CAUSE = MIXED**

Dominant actionable engineering issue: **DOWNSTREAM_BLOCKER** (62% downstream vs 36% lane-empty)

Classification:
1. Correctly selective — **partially** (lane-empty rounds behave as designed)
2. Incorrectly classifying — **YES** (approval gate 50 vs selector 70 mismatch)
3. Stale/missing data — **low impact** in 50-round DB (0 DATA_QUALITY false rejections)
4. Duplicating downstream — **NO** (lane is separate from AI NO_TRADE)
5. Too restrictive policy — **partial** (intentional for tradable=0 path)
6. Incorrect ordering — **NO** (pump→steady→lastResort order correct)
7. Combination — **YES**

---

## Part 13 — Engineering vs Policy

### Engineering fix (DO NOT implement now)
1. Align `selectPaperPumpLaneCandidates` priority threshold: 50 in paper (not 70)
2. Thread `usePaperProfile` into `isPaperApprovedLane`

Spec: `kripto-zero-trade-engineering-spec.json`

### Policy experiment (later, single A/B)
When pump+steady empty, admit top-1 last-resort candidate per round; measure execution-ready only. Do not change TDI/AI/EV thresholds.

---

## Part 14 — No Implementation

This task produced analysis artifacts only. **No code change. No paper run. No threshold change.**

---

## Part 15 — Final Verdict

```
50_ROUNDS_ANALYZED = 50
TOTAL_CANDIDATES = 980
PUMP_LANE_CANDIDATES = 0
STEADY_GAIN_CANDIDATES = 0
LAST_RESORT_CANDIDATES = 0
PAPER_ADMITTED = 31
TDI_REACHED = 0
AI_REACHED = 31
EV_REACHED = 0
EXECUTION_READY = 0
TRADES = 0
TOP50_DISCOVERED = 49
TOP50_LANE_BLOCKED = 49
TOP50_FALSE_LANE_REJECTIONS = 19
37_COHORT_LANE_BLOCKED = 27
LEGITIMATE_LANE_REJECTIONS = 360
DATA_QUALITY_FALSE_REJECTIONS = 0
PRIMARY_ZERO_TRADE_CAUSE = MIXED
PRIMARY_ROOT_CAUSE_SHARE = 0.62
DOMINANT_ACTIONABLE_ISSUE = DOWNSTREAM_BLOCKER
ENGINEERING_BUG = YES
POLICY_PROBLEM = YES
PRIMARY_ENGINEERING_FIX = Align selectPaperPumpLaneCandidates priority (70→50 paper) + usePaperProfile in isPaperApprovedLane
PRIMARY_POLICY_EXPERIMENT = Last-resort single-candidate A/B when pump+steady empty
LOSS_CONTROL = FAIL
PRODUCTION_CHANGE_RECOMMENDED = NO
NEXT_STEP = Fix lane selector/approval parity first; then ONE controlled last-resort A/B — do not loosen TDI/AI/EV
```

### Artifacts
- `kripto-final-zero-trade-lane-forensic.json`
- `kripto-50round-lane-replay.csv`
- `kripto-50round-candidate-waterfall.csv`
- `kripto-top50-lane-correlation.csv`
- `kripto-37-lane-correlation.csv`
- `kripto-lane-counterfactuals.csv`
- `kripto-lane-loss-control.csv`
- `kripto-lane-root-cause-ranking.csv`
- `kripto-zero-trade-engineering-spec.json`
