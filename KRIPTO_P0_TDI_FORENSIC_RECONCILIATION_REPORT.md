# KRIPTO P0 — TDI Forensic / Sensitivity Reconciliation Fix

**Report ID:** `kripto-p0-tdi-forensic-reconciliation`  
**Scope:** Forensic observability only — **no trading behavior changes**  
**Machine-readable:** [`kripto-p0-tdi-forensic-reconciliation.json`](kripto-p0-tdi-forensic-reconciliation.json)

---

## 1. Before/after metric semantics

| Concept | Before (misleading) | After (explicit) |
|---------|---------------------|------------------|
| Score pass at threshold 55 | `approvalRate` / `sensitivityPoints[].approvalRate` | **`scoreAboveThresholdRate`** |
| Production TDI APPROVED | Not separately reported in sensitivity | **`runtimeApprovalEquivalentRate`** |
| Score field | Single `consensusScore` (mixed semantics) | **`hybridCompositeScore`** / **`masterExpertConsensusScore`** + **`scoreType`** |
| Operator interpretation | "28.4% approval" | "28.4% **Score ≥ Threshold Rate**" vs "0% **Runtime Approval Rate**" |

**Visible explanation (all new v2 sensitivity artifacts):**

> Score threshold pass is a counterfactual metric and is not equivalent to production TDI APPROVED.

---

## 2. FIX-A result — align sensitivity with production verdict logic

**New module:** `src/server/forensics/tdi-verdict-replay.service.ts`

Offline replay rules (no live AI, no Binance):

| Record source | Replay rule |
|---------------|-------------|
| `hybrid:*` | `BUY → APPROVED`, `HOLD → WAIT`, else `REJECTED` |
| `tdi:*` | Uses recorded `legacyDecision` when present; else infers via `resolveEffectiveTradingDecision` (status **INCOMPLETE**) |

**Updated:** `src/server/forensics/tdi-sensitivity.service.ts`

New sensitivity outputs:

| Field | Meaning |
|-------|---------|
| `scoreAboveThresholdCount` / `scoreAboveThresholdRate` | Counterfactual: score ≥ threshold |
| `runtimeApprovalEquivalentCount` / `runtimeApprovalEquivalentRate` | Production replay approval |
| `runtimeWaitCount` / `runtimeRejectedCount` | Replay WAIT / REJECT distribution |
| `productionReplayStatus` | `COMPLETE` \| `PARTIAL` \| `INCOMPLETE` |
| `productionReplayReason` | Why full master replay may be incomplete |

---

## 3. FIX-B result — rename misleading metrics

**Schema:** `tdi-sensitivity-v2`

| Legacy field | New meaning / alias |
|--------------|---------------------|
| `approvalRate` (top-level) | **Deprecated** — now equals **recorded** runtime APPROVED rate |
| `sensitivityPoints[].approvalRate` | **Deprecated alias** of `scoreAboveThresholdRate` |
| `compatibility` block | Documents mapping for old readers |

**UI/reporting:** No dashboard component in `src/features` consumed `tdi-sensitivity.json`. Future readers must label:

- **Score ≥ Threshold Rate** (`scoreAboveThresholdRate`)
- **Runtime Approval Rate** (`runtimeApprovalEquivalentRate`)

---

## 4. FIX-C result — split score semantics

**Schema:** `tdi-decision-v2`

| Field | Hybrid record | Master record |
|-------|---------------|---------------|
| `scoreType` | `HYBRID_COMPOSITE` | `MASTER_EXPERT_AVERAGE` |
| `hybridCompositeScore` | composite value | `null` |
| `masterExpertConsensusScore` | `null` | expert average |
| `legacyDecision` | — | recorded at master bridge (new) |
| `consensusScore` | retained for backward compatibility | same value as typed score |

**Export:** `round-forensic-export.service.ts` writes:

```json
{
  "schemaVersion": "tdi-decision-v2",
  "records": [ ... ]
}
```

**Backward compatibility:** `normalizeTdiDecisionRecord()` migrates legacy artifacts using `candidateId` prefix (`hybrid:` / `tdi:`).

---

## 5. Artifact schema changes

| Artifact | Version | Key additions |
|----------|---------|---------------|
| `tdi-sensitivity.json` | `tdi-sensitivity-v2` | Split rates, replay status, explanation |
| `tdi-decisions.json` | `tdi-decision-v2` | `scoreType`, split scores, `legacyDecision` |

---

## 6. UI/reporting changes

- No production UI files required updates (none found).
- Forensic report terminology updated in this document.
- `scoreThresholdExplanation` embedded in every new sensitivity artifact.

---

## 7. Backward compatibility

- Old `consensusScore`-only records normalize correctly via `inferScoreTypeFromCandidateId`.
- `normalizeLegacyTdiSensitivityArtifact()` maps old `approvalRate` counterfactual to `scoreAboveThresholdRate`.
- Deprecated `approvalRate` fields retained with documented semantics in `compatibility` block.

---

## 8. Tests

**Suite:** `tests/forensics/tdi-sensitivity-reconciliation.test.ts` — **13/13 PASS**

Covers all required cases:

1. Score ≥ threshold + HOLD → score pass, no runtime approval  
2. Score ≥ threshold + NO_TRADE → score pass, no runtime approval  
3. Hybrid BUY → runtime approval  
4. Master legacy BUY → runtime approval  
5. Master WATCHLIST → wait, not approval  
6. Master NO_TRADE → rejected  
7. Hybrid HOLD → wait  
8. Hybrid NO_TRADE → rejected  
9. Score type separation  
10. Legacy `consensusScore` backward compat  
11. **Canonical 46-round fixture:** scoreAboveThresholdRate ≈ 28.7%, runtimeApprovalRate = 0%  
12. Legacy sensitivity normalization  
13. Score threshold explanation present  

**Regression:** `tests/forensics/p2-tdi-slot-strategy.test.ts` — **11/11 PASS**

---

## 9. Canonical 46-round fixture validation

| Metric | Value |
|--------|------:|
| jobId | `cmstltuqn0007un9ksbk3xn9c` |
| TDI decisions | 17,626 |
| **scoreAboveThresholdRate** | **0.2874** (≈28.4%) |
| **runtimeApprovalEquivalentRate** | **0** |
| Recorded `approvalRate` | 0 |
| `productionReplayStatus` | PARTIAL |
| Reason | 8,634 master records lack stored `legacyDecision`; inferred replay without expert opinions |

**Paradox resolved:** 28.4% was always a **score counterfactual**, not production approval.

---

## 10. Proof that runtime trading behavior was NOT modified

| Area | Changed? |
|------|----------|
| Hybrid BUY/HOLD/NO_TRADE logic | **No** |
| `resolveMasterDecision` thresholds | **No** |
| Momentum / learning gates | **No** |
| AI VETO execution gate | **No** |
| Sizing / risk / scanner / strategy | **No** |

**Only forensic layer changed:**

- `tdi-sensitivity.service.ts` — measurement  
- `tdi-verdict-replay.service.ts` — offline replay  
- `tdi-decision-forensics.service.ts` — artifact fields  
- `forensic.types.ts` — schema  
- `round-forensic-export.service.ts` — export wrapper  

**Observability-only bridge addition:** `master-decision-engine.service.ts` now records `legacyDecision` in `bridgeTdiDecision()` — same verdict already computed; additional forensic field only.

---

## 11. Remaining issues

1. **Historical artifacts** pre-fix lack `legacyDecision` → master replay is **PARTIAL** until rounds re-export with v2 schema.
2. **0 APPROVED is still expected** for the canonical run — this task fixes **measurement**, not trading outcomes.
3. Any external tool reading old `approvalRate` as "approvable trades" must migrate to explicit v2 fields.

---

## 12. Two-round validation design (not run)

After deploying forensic v2 to a future paper session:

| Acceptance | Target |
|------------|--------|
| `scoreAboveThresholdRate` vs counterfactual | within 2pp |
| `runtimeApprovalEquivalentRate` vs recorded APPROVED | within 2pp |
| `tdi-decision-v2` score fields | hybrid/master distinct |
| Trading behavior | unchanged unless separate fix |

**Do not** interpret improved metrics as permission to lower thresholds.

---

*Implementation complete. Forensic test suite passed. No Paper run started.*
