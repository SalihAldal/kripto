# KRIPTO — FINAL 100-ROUND PAPER REPORT

Generated: 2026-08-29T10:33:28.216Z

## Stop

- Job ID: `cmtdla29j0009unhogsjcmoea`
- Stop result: {"stopped":false,"reason":"Aktif tur motoru yok"}
- Final status: **STOPPED** (stopRequested=true)

## Phase B Verdict

| Field | Value |
|-------|-------|
| PAPER_STARTED | YES |
| PAPER_STOPPED | YES |
| ROUNDS_TARGET | 100 |
| ROUNDS_ATTEMPTED | 77 |
| ROUNDS_COMPLETED | 0 |
| ROUNDS_FAILED | 79 |
| ROUND20_REACHED | YES |
| TRADES | 0 |
| TDI_ENTERED | 0 |
| TDI_APPROVED | 0 |
| AI_DEGRADED (funnel) | 11155 |
| AI_REMOTE_CALLS | 5 |
| NET_PNL | 0 |
| RUNTIME_STATUS | STABLE |
| PROFITABILITY_STATUS | NOT_PROVEN |
| PRIMARY_BLOCKER | RUNTIME_REFERENCE_ERROR (resolveMinimumProtectedProfitPercent) |

## Kök Neden

Gece boyunca **77 tur** denendi, **0 başarılı tamamlama**, **0 trade**.

Baskın hata: **`resolveMinimumProtectedProfitPercent is not defined`** — hybrid-decision-engine import eksikliği kaynak kodda düzeltildi ancak uzun süre çalışan scheduler process eski modül cache'i kullandı. Bu yüzden TDI/trade funnel'ına ulaşılamadı.

## Policy Firewall

POLICY_CHANGES=NO | THRESHOLD_CHANGES=NO | AI_VETO_CHANGED=NO

## Artifacts

- kripto-final-100round-paper.json
- kripto-final-100round-rounds.csv
- kripto-final-100round-funnel.csv
- kripto-final-100round-ai.csv
- kripto-final-100round-pnl.csv
- kripto-final-100round-incidents.csv
