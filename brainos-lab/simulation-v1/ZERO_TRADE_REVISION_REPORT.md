# Zero-Trade Behaviour Revision Report

> **Date:** 08.08.2026  
> **Scope:** Entry pipeline decision logic only — no new strategies, no system redesign  
> **Problem:** 24 consecutive auto-rounds, **0 trades opened**

---

## Root Cause Summary

Zero trades came from **three compounding layers**, not missing scanner output:

| Layer | Share of last-24 failures | Issue |
|-------|---------------------------|-------|
| Runtime (heartbeat / timeout) | ~70% | Rounds killed before execution |
| Stacked SIM_TIGHT_FILTER | 100% of rounds with metadata | Every candidate rejected |
| Emergency stop | 3 rounds | Hard pause with unclear UX |

The scanner **did** produce candidates (TNSRTRY, LDOTRY, PUMPTRY, etc.) — filters rejected all of them.

---

## Pipeline Analysis

### Rejection gates (complete path)

1. **Scanner / fast-entry** — confidence, spread, flow pre-filters  
2. **`evaluateAutoRoundLearningCandidate`** — SIM_TIGHT_FILTER (30+ sub-gates)  
3. **`evaluatePaperEntryQuality`** — quality score, EMA, volume, BTC, fake pump  
4. **`evaluatePumpEntrySafety`** — pump lane safety  
5. **Execution orchestrator** — emergency stop, safe mode, risk, signal-quality-gate  
6. **Runtime** — selection budget 1200s, watchdog 180s+  

### Over-restrictive patterns (from last-24)

| Filter | Frequency | Verdict |
|--------|-----------|---------|
| Kalite skoru dusuk | ~every round | IMPORTANT → was hard block |
| Sahte hour-only pump (tape=0%) | very common | ADVISORY when data stale |
| non-pump kalite dusuk | very common | IMPORTANT → relax with composite |
| confidence 37 < 38 | marginal | IMPORTANT → adaptive floor |
| EMA / hacim / BTC | frequent | ADVISORY on TRY pairs |
| Heartbeat stale 180s | 9 rounds | infrastructure (unchanged in this pass) |
| Selection timeout 1200s | 8 rounds | symptom of filter stack |

---

## Implementation

### 1. Entry Decision Engine (new)

**Files:** `entry-decision-engine.service.ts`, `entry-decision.types.ts`

| Feature | Description |
|---------|-------------|
| **Filter priority** | CRITICAL / IMPORTANT / ADVISORY |
| **Adaptive thresholds** | Relax confidence, quality, scanner floors every 3 rejections (tier 0–5) |
| **Exploration mode** | After 9 rejections — waive non-critical filters if composite ≥ floor |
| **Decision explanation** | primaryBlocker, secondaryBlockers, waivedBlockers, wouldPassWithRelaxedThresholds |

**Rule:** Only **CRITICAL** filters may absolutely block. IMPORTANT/ADVISORY influence acceptance via adaptive policy.

### 2. SIM_TIGHT_FILTER refactor

**File:** `auto-round-engine.service.ts`

- Applies adaptive thresholds before building filter reasons  
- Final accept/reject via `resolveAdaptiveEntryDecision()` (not `reasons.length === 0`)  
- Tracks `consecutiveFilterRejections` on job metadata  
- Stores full `entryDecision` on rejected runs  
- **Exploration accept** on last selection attempt if `wouldPassWithRelaxedThresholds`  
- Resets rejection counter on successful coin selection  
- **Emergency stop** fails round immediately with explicit message (no silent spin)

### 3. Paper entry quality adjustments

**File:** `paper-entry-quality.service.ts`

- `dataDegraded` — skip fake hour-only pump when tape≈0 (stale data, not manipulation)  
- Adaptive `minScore` delta from rejection streak  
- Quality floor only hard-blocks at very low scores when data degraded  
- EMA / volume / BTC skipped when `dataDegraded`

### 4. Critical filters (unchanged — always block)

- AI SELL, dump detection, learning memory hard block  
- Extreme spread / fake spike / volatility  
- Emergency stop / safe mode  

---

## Adaptive Threshold Table

| Rejections | Tier | Confidence Δ | Quality Δ | Exploration |
|------------|------|--------------|-----------|-------------|
| 0–2 | 0 | 0 | 0 | no |
| 3–5 | 1 | −2 | −4 | no |
| 6–8 | 2 | −4 | −8 | no |
| 9–11 | 3 | −6 | −12 | **yes** |
| 12+ | 4–5 | −8 to −10 | −16 to −20 | yes |

Floors: confidence ≥ 32, quality ≥ 35, scanner score ≥ 30.

---

## Decision Explanation (stored per rejection)

```json
{
  "primaryBlocker": "Kalite skoru dusuk (45/100 < 60)",
  "secondaryBlockers": ["regime chop warning", "EMA trend uyumsuz"],
  "criticalBlockers": [],
  "importantBlockers": ["Kalite skoru dusuk ..."],
  "advisoryBlockers": ["regime chop warning"],
  "waivedBlockers": [],
  "wouldPassWithRelaxedThresholds": true,
  "relaxationTier": 2,
  "explorationMode": false
}
```

Persisted on `AutoRoundRun.metadata.entryDecision`.

---

## Validation

### Unit tests — `tests/entry-decision-engine.test.ts`

| Test | Result |
|------|--------|
| Priority classification | ✅ |
| Adaptive threshold relaxation | ✅ |
| Advisory-only accept after relaxation | ✅ |
| Critical filter always blocks | ✅ |
| Exploration mode accepts decent composite | ✅ |

Run:
```bash
npx vitest run tests/entry-decision-engine.test.ts
```

### Expected production impact

- Healthy market + scanner candidates → **some rounds reach `coin_secildi` → `alim_yapildi`**  
- Marginal rejects (confidence 37, quality 45–55, tape=0 stale) → pass after 3–9 rejections  
- Risk protection preserved on dumps, SELL, emergency stop, extreme spread  

---

## Modified Files

| File | Change |
|------|--------|
| `src/server/execution/entry-decision-engine.service.ts` | **New** — adaptive decision engine |
| `src/server/execution/entry-decision.types.ts` | **New** — types |
| `src/server/execution/auto-round-engine.service.ts` | Wired adaptive decisions + tracking |
| `src/server/trading-core/entry-filters/paper-entry-quality.service.ts` | Data-degraded + adaptive quality |
| `tests/entry-decision-engine.test.ts` | **New** — validation |

---

## Rollback

Revert the five files above. Job metadata keys `consecutiveFilterRejections` and `entryDecision` are optional — no migration required.

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Eliminate pathological zero-trade from filter stack | ✅ Implemented |
| Preserve critical risk protection | ✅ |
| Adaptive (non-fixed) thresholds | ✅ |
| Filter priority (critical / important / advisory) | ✅ |
| Rejection explanation with primary/secondary blockers | ✅ |
| No new strategies / no system redesign | ✅ |

**Note:** Heartbeat/timeout failures require separate runtime tuning (`AUTO_ROUND_WATCHDOG_STALE_MS`, selection budget). This revision fixes the **decision layer** that rejected every candidate even when the scanner found opportunities.
