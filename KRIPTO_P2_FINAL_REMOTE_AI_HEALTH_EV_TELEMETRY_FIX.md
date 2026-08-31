# KRIPTO P2 — FINAL REMOTE AI HEALTH + EV TELEMETRY FIX

Generated: 2026-08-23T19:11:56.989Z

## Root cause
- **Category:** RETRY_BUG
- **Detail:** analysis-orchestrator.ts referenced withAiRetry without import; every lane threw ReferenceError and forensic ai-trace recorded withAiRetry is not defined.

## Provider probe
- Healthy remote providers: **3**
- Recovery: **PASS**

## EV 856 replay
- Anomalies before: **856**
- HYBRID_DECISION_MIRROR: **856**
- REAL_EV_REJECTION: **0**
- EV_FALSE_REJECTS: **0**

## Fixes (no threshold/policy changes)
1. Missing `withAiRetry` import restored
2. Provider health registry + recovery telemetry
3. EV telemetry labels: HYBRID_DECISION_MIRROR vs EV_REJECT_THRESHOLD
4. Per-provider model passed to remote LLM calls

## READY_FOR_30_ROUNDS: YES