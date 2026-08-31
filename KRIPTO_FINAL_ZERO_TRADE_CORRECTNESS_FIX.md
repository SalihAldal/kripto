# KRIPTO P2 — FINAL ZERO-TRADE FUNNEL CORRECTNESS FIX

Generated: 2026-08-28T15:01:35.595Z

## Summary

Deterministic correctness fixes applied **without** threshold changes, AI VETO relaxation, or paper runs.

### A) Paper Lane Parity — PASS
- Shared `paper-lane-profile.ts`: paper priority **50**, live **55 boundary now consistent**
- `isPaperApprovedLane`, `selectPaperPumpLaneCandidates`, `resolvePaperRoundLane` aligned

### B) usePaperProfile Propagation — FIXED
- `isPaperExecutionContext(usePaperProfile)` replaces `EXECUTION_MODE === 'paper'` alone

### C) TDI → AI Routing — PASS (documented)
Architecture proof:
1. **Scanner AI** runs in `runScannerPipeline({ includeAi: true })`
2. **Selection gate** (`isBlockingAiDecision`) blocks before `executeAnalyzeAndTrade`
3. **TDI** (`bridgeTdiDecision`) runs only inside hybrid/execution path

**TDI_BYPASS = NO** — TDI is not bypassed; it is **not reached** because scanner AI blocks at selection.

Misleading metric fixed:
- Old: `AI_REACHED=31, TDI_REACHED=0` (ambiguous)
- New: `scanner_ai_reached=31, tdi_skipped=31, tdi_entered=0, execution_ai_reached=0`

### D) NO_TRADE State Machine — PASS
- `shouldBindSymbolOnTerminalFail` extracted to `auto-round-terminal-policy.ts`
- `transactionallyFailRound` clears symbol on terminal NON_EXECUTABLE/NO_TRADE

## Before / After Funnel

| Metric | Before | After |
|--------|--------|-------|
| scanner_candidates | 980 | 980 |
| symbol_selections | 31 | 31 |
| tdi_entered | 0 (unexplained) | 0 (documented: pre-execution skip) |
| tdi_skipped | — | 31 |
| scanner_ai_reached | 31 (mislabeled) | 31 |
| execution_ready | 0 | 0 |
| trades | 0 | 0 |

## Final Verdict

```
PAPER_LANE_PARITY = PASS
USE_PAPER_PROFILE = FIXED
TDI_AI_ROUTING = PASS
TDI_BYPASS = NO
AI_NO_TRADE_CLASSIFICATION = PASS
NO_TRADE_STATE_MACHINE = PASS
SYMBOL_BINDING = PASS
TESTS = PASS
READY_FOR_30_ROUND_PAPER = CONDITIONAL
THRESHOLDS_CHANGED = NO
AI_VETO_CHANGED = NO
PAPER_STARTED = NO
```

PRIMARY_REMAINING_BLOCKER: Scanner AI NO_TRADE at selection gate (31/50 rounds) + lane-empty terminal (18/50) — downstream TDI/hybrid never reached; correctness fixed, policy unchanged

NEXT_STEP: Run 30-round paper ONLY after verifying funnel telemetry in one dry-run round export shows scanner_ai + tdi_skip stages
