# BrainOS Simulation Lab — simulation-v1

## Trade 1

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:04:57.283Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 56.3 |
| Confidence | 65.86 |
| Ranking Score | 93.93 |
| Risk Score | 21.23 |
| Position Size | 336.61 |
| Entry Price | 4001.06 |
| Stop Loss | 3959.7 |
| Take Profit | 4107.08 |
| Exit Price | 4001.06 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 2

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:06:27.290Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 49.79 |
| Confidence | 52.34 |
| Ranking Score | 71.56 |
| Risk Score | 21.32 |
| Position Size | 955.02 |
| Entry Price | 3409.42 |
| Stop Loss | 3359.17 |
| Take Profit | 3440.62 |
| Exit Price | 3409.42 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 5.606 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 3

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:07:57.292Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 92.09 |
| Confidence | 55.83 |
| Ranking Score | 59.87 |
| Risk Score | 35.53 |
| Position Size | 726.68 |
| Entry Price | 2356.25 |
| Stop Loss | 2333.04 |
| Take Profit | 2379.77 |
| Exit Price | 2356.25 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (59.87 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (59.87 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.7816 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 4

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:09:27.294Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 83.4 |
| Confidence | 81.98 |
| Ranking Score | 63.3 |
| Risk Score | 32.57 |
| Position Size | 793.87 |
| Entry Price | 392.91 |
| Stop Loss | 389.7 |
| Take Profit | 405.86 |
| Exit Price | 392.91 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (374582 < 5000000) |
| Confidence Threshold | 51 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (374582 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.628 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 5

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:10:57.297Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.5 |
| Confidence | 59.2 |
| Ranking Score | 91.49 |
| Risk Score | 36.83 |
| Position Size | 965.25 |
| Entry Price | 1032.18 |
| Stop Loss | 1011.54 |
| Take Profit | 1040.58 |
| Exit Price | 1032.18 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.7027 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 6

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:12:27.299Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 46.74 |
| Confidence | 80.3 |
| Ranking Score | 93.39 |
| Risk Score | 59.45 |
| Position Size | 937.49 |
| Entry Price | 3155.96 |
| Stop Loss | 3100.97 |
| Take Profit | 3181.83 |
| Exit Price | 3155.96 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.8437 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 7

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:13:57.301Z |
| Market | SPOT_TRY |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 72.31 |
| Confidence | 59.09 |
| Ranking Score | 48.17 |
| Risk Score | 48.12 |
| Position Size | 727.87 |
| Entry Price | 1169.52 |
| Stop Loss | 1153.3 |
| Take Profit | 1207.98 |
| Exit Price | 1169.52 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (48.17 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (48.17 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 8

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:15:27.304Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 75.79 |
| Confidence | 67 |
| Ranking Score | 46.4 |
| Risk Score | 33.32 |
| Position Size | 908.87 |
| Entry Price | 1296.37 |
| Stop Loss | 1272.42 |
| Take Profit | 1319.5 |
| Exit Price | 1296.37 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (46.4 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (46.4 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.8539 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 9

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:16:57.306Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 64.04 |
| Confidence | 72.23 |
| Ranking Score | 55.94 |
| Risk Score | 35.89 |
| Position Size | 657.22 |
| Entry Price | 1939.4 |
| Stop Loss | 1910.57 |
| Take Profit | 1977.94 |
| Exit Price | 1939.4 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 10

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:18:27.308Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 92.41 |
| Confidence | 56.98 |
| Ranking Score | 82.98 |
| Risk Score | 67.14 |
| Position Size | 525.75 |
| Entry Price | 741.77 |
| Stop Loss | 737.22 |
| Take Profit | 765.67 |
| Exit Price | 741.77 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (82.98 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (82.98 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.1987 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 1–10

- Completed Trades: 10
- Accepted: 0
- Rejected: 10
- Batch Win Rate: 0%
- Profit Factor: 0
- Expectancy: 0
- Sharpe Ratio: 0
- Average Confidence: 65.08
- Average Holding Time: 0s
- Average Risk Score: 39.14
- Top Rejection Reason: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: N/A in N/A
- Most Common Failure Pattern: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 11

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:19:57.311Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 52.58 |
| Confidence | 82.06 |
| Ranking Score | 84.55 |
| Risk Score | 23.44 |
| Position Size | 556.43 |
| Entry Price | 2013.68 |
| Stop Loss | 1989.69 |
| Take Profit | 2078.62 |
| Exit Price | 2013.68 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (827921 < 5000000) |
| Confidence Threshold | 51 |
| Ranking Result | PASS |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (827921 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.9157 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 12

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:21:27.313Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 83.71 |
| Confidence | 93.69 |
| Ranking Score | 86.96 |
| Risk Score | 76.71 |
| Position Size | 344.43 |
| Entry Price | 3435 |
| Stop Loss | 3372.23 |
| Take Profit | 3465.03 |
| Exit Price | 3435 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.7612 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 13

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:22:57.314Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 91.64 |
| Confidence | 80.16 |
| Ranking Score | 51.95 |
| Risk Score | 40.75 |
| Position Size | 482.07 |
| Entry Price | 2751.6 |
| Stop Loss | 2710.15 |
| Take Profit | 2825.56 |
| Exit Price | 2751.6 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Expected profit below minimum |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.8967 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 14

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:24:27.316Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 78.36 |
| Confidence | 89.09 |
| Ranking Score | 73.56 |
| Risk Score | 53.85 |
| Position Size | 995.68 |
| Entry Price | 2868617.31 |
| Stop Loss | 2839386.1 |
| Take Profit | 2905080.55 |
| Exit Price | 2868617.31 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 7.7862 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 15

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:25:57.318Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 83.95 |
| Confidence | 54.11 |
| Ranking Score | 89.6 |
| Risk Score | 39.25 |
| Position Size | 502.99 |
| Entry Price | 1591.59 |
| Stop Loss | 1566.68 |
| Take Profit | 1625.41 |
| Exit Price | 1591.59 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Exchange restriction: symbol temporarily blocked |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | BLOCKED |

**Engineering Analysis:** Rejected due to: Exchange restriction: symbol temporarily blocked. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.1185 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Exchange restriction: symbol temporarily blocked

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 16

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:27:27.320Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 63.49 |
| Confidence | 90.03 |
| Ranking Score | 47.61 |
| Risk Score | 49.22 |
| Position Size | 998.82 |
| Entry Price | 3244.7 |
| Stop Loss | 3208.93 |
| Take Profit | 3336.82 |
| Exit Price | 3244.7 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (47.61 < 48) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (47.61 < 48). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 17

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:28:57.322Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 63.11 |
| Confidence | 74.96 |
| Ranking Score | 50.27 |
| Risk Score | 24.12 |
| Position Size | 118.352691 |
| Entry Price | 3109.61 |
| Stop Loss | 3076.52 |
| Take Profit | 3153.32 |
| Exit Price | 3149.93 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 1.297 |
| PnL USDT | 1.3687 |
| Trade Duration | 1280s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in ranging regime with confidence 74.96% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 18

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:30:27.328Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 80.78 |
| Confidence | 67.87 |
| Ranking Score | 49.14 |
| Risk Score | 51.22 |
| Position Size | 643.3 |
| Entry Price | 3679.5 |
| Stop Loss | 3591.19 |
| Take Profit | 3740.66 |
| Exit Price | 3679.5 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (49.14 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (49.14 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.0027 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 19

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:31:57.331Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 79.16 |
| Confidence | 92.66 |
| Ranking Score | 48.73 |
| Risk Score | 35.32 |
| Position Size | 698.46 |
| Entry Price | 2702.67 |
| Stop Loss | 2663.65 |
| Take Profit | 2738.81 |
| Exit Price | 2702.67 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Signal not actionable |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Signal not actionable. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal not actionable

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 20

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:33:27.333Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 73.07 |
| Confidence | 58.39 |
| Ranking Score | 88.44 |
| Risk Score | 55.42 |
| Position Size | 888.01 |
| Entry Price | 110.26 |
| Stop Loss | 108.64 |
| Take Profit | 112.45 |
| Exit Price | 110.26 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (958344 < 5000000) |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (958344 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 9.3063 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 11–20

- Completed Trades: 20
- Accepted: 1
- Rejected: 19
- Batch Win Rate: 100%
- Profit Factor: 999
- Expectancy: 1.3687
- Sharpe Ratio: 0
- Average Confidence: 71.69
- Average Holding Time: 1280s
- Average Risk Score: 42.04
- Top Rejection Reason: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: mean_reversion in ranging
- Most Common Failure Pattern: Liquidity gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 21

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:34:57.336Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 54.88 |
| Confidence | 75.39 |
| Ranking Score | 87.86 |
| Risk Score | 47.25 |
| Position Size | 794.1 |
| Entry Price | 2807.85 |
| Stop Loss | 2758.35 |
| Take Profit | 2843.73 |
| Exit Price | 2807.85 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 22

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:36:27.338Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 55.37 |
| Confidence | 78.59 |
| Ranking Score | 86.7 |
| Risk Score | 51.78 |
| Position Size | 525.99 |
| Entry Price | 2352.09 |
| Stop Loss | 2326.48 |
| Take Profit | 2411.84 |
| Exit Price | 2352.09 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 5.9016 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 23

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:37:57.341Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 47.45 |
| Confidence | 61.56 |
| Ranking Score | 43.16 |
| Risk Score | 45.52 |
| Position Size | 340.03 |
| Entry Price | 1802.31 |
| Stop Loss | 1787.71 |
| Take Profit | 1841.92 |
| Exit Price | 1802.31 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.16 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.16 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.9375 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 24

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:39:27.343Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 79.87 |
| Confidence | 91.09 |
| Ranking Score | 84.93 |
| Risk Score | 62.46 |
| Position Size | 479.47 |
| Entry Price | 1015.36 |
| Stop Loss | 1002.86 |
| Take Profit | 1047.2 |
| Exit Price | 1015.36 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (84.93 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (84.93 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 25

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:40:57.345Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 58.42 |
| Confidence | 68.97 |
| Ranking Score | 92.14 |
| Risk Score | 36.18 |
| Position Size | 224.82 |
| Entry Price | 1785.16 |
| Stop Loss | 1766.71 |
| Take Profit | 1828.8 |
| Exit Price | 1785.16 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.549 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 26

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:42:27.348Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 60.07 |
| Confidence | 53.68 |
| Ranking Score | 54.38 |
| Risk Score | 48.93 |
| Position Size | 347.45 |
| Entry Price | 1569.57 |
| Stop Loss | 1538.41 |
| Take Profit | 1582.57 |
| Exit Price | 1569.57 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (54.38 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (54.38 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.1375 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 27

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:43:57.351Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 87.27 |
| Confidence | 73.25 |
| Ranking Score | 51.74 |
| Risk Score | 59.92 |
| Position Size | 779.56 |
| Entry Price | 407.44 |
| Stop Loss | 400.84 |
| Take Profit | 419.15 |
| Exit Price | 407.44 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (51.74 < 68) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (51.74 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 28

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:45:27.354Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 53.09 |
| Confidence | 52.43 |
| Ranking Score | 85.65 |
| Risk Score | 53.54 |
| Position Size | 567.37 |
| Entry Price | 709.44 |
| Stop Loss | 698.39 |
| Take Profit | 724.21 |
| Exit Price | 709.44 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.5588 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 29

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:46:57.356Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 70.28 |
| Confidence | 93.94 |
| Ranking Score | 59.07 |
| Risk Score | 59.61 |
| Position Size | 785.8 |
| Entry Price | 1442.47 |
| Stop Loss | 1423.37 |
| Take Profit | 1479.36 |
| Exit Price | 1442.47 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (59.07 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (59.07 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.2902 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 30

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:48:27.359Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 77.53 |
| Confidence | 59.97 |
| Ranking Score | 41.74 |
| Risk Score | 22.56 |
| Position Size | 340.12 |
| Entry Price | 295.03 |
| Stop Loss | 292.23 |
| Take Profit | 297.94 |
| Exit Price | 295.03 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (41.74 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (41.74 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.5714 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 21–30

- Completed Trades: 30
- Accepted: 1
- Rejected: 29
- Batch Win Rate: 0%
- Profit Factor: 999
- Expectancy: 1.3687
- Sharpe Ratio: 0
- Average Confidence: 71.42
- Average Holding Time: 1280s
- Average Risk Score: 44.28
- Top Rejection Reason: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: N/A in N/A
- Most Common Failure Pattern: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 31

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:49:57.362Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 71.08 |
| Confidence | 83.96 |
| Ranking Score | 86.85 |
| Risk Score | 79.14 |
| Position Size | 292.85 |
| Entry Price | 4044.09 |
| Stop Loss | 3972.71 |
| Take Profit | 4103.72 |
| Exit Price | 4044.09 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Entry quality: elevated AI risk (79) without elite confidence (82% < 82%) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Entry quality: elevated AI risk (79) without elite confidence (82% < 82%). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.1013 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Entry quality: elevated AI risk (79) without elite confidence (82% < 82%)

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 32

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:51:27.364Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 93.43 |
| Confidence | 70.84 |
| Ranking Score | 45.79 |
| Risk Score | 78.82 |
| Position Size | 258.4 |
| Entry Price | 247.21 |
| Stop Loss | 243.5 |
| Take Profit | 254.33 |
| Exit Price | 247.21 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (45.79 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (45.79 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.5013 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 33

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:52:57.367Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 61.46 |
| Confidence | 53.75 |
| Ranking Score | 49.59 |
| Risk Score | 41.06 |
| Position Size | 697.8 |
| Entry Price | 2330.29 |
| Stop Loss | 2300.7 |
| Take Profit | 2367.94 |
| Exit Price | 2330.29 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (49.59 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (49.59 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.869 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 34

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:54:27.370Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 45.79 |
| Confidence | 57.98 |
| Ranking Score | 76.49 |
| Risk Score | 53.14 |
| Position Size | 330.79 |
| Entry Price | 2903157.1 |
| Stop Loss | 2860335.53 |
| Take Profit | 2971198.48 |
| Exit Price | 2903157.1 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (76.49 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (76.49 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.7333 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 35

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:55:57.372Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 61.21 |
| Confidence | 72.93 |
| Ranking Score | 85.4 |
| Risk Score | 31.73 |
| Position Size | 825.7 |
| Entry Price | 2089.3 |
| Stop Loss | 2073 |
| Take Profit | 2122.71 |
| Exit Price | 2089.3 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1893735 < 5000000) |
| Confidence Threshold | 51 |
| Ranking Result | PASS |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1893735 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 9.8589 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 36

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:57:27.378Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 74.09 |
| Confidence | 70.74 |
| Ranking Score | 67.8 |
| Risk Score | 42.17 |
| Position Size | 171.94 |
| Entry Price | 3025.99 |
| Stop Loss | 2992.33 |
| Take Profit | 3107.04 |
| Exit Price | 3025.99 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (770968 < 5000000) |
| Confidence Threshold | 51 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (770968 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Liquidity gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 37

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T20:58:57.381Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 79.15 |
| Confidence | 74.58 |
| Ranking Score | 86.43 |
| Risk Score | 79.09 |
| Position Size | 979.1 |
| Entry Price | 2347.27 |
| Stop Loss | 2320.37 |
| Take Profit | 2392.58 |
| Exit Price | 2347.27 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Entry quality: elevated AI risk (79) without elite confidence (73% < 82%) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Entry quality: elevated AI risk (79) without elite confidence (73% < 82%). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 11.4751 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Entry quality: elevated AI risk (79) without elite confidence (73% < 82%)

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 38

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:00:27.383Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 84.72 |
| Confidence | 78.56 |
| Ranking Score | 77.9 |
| Risk Score | 77.59 |
| Position Size | 785.11 |
| Entry Price | 3368.65 |
| Stop Loss | 3328.93 |
| Take Profit | 3418.32 |
| Exit Price | 3368.65 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Entry quality: elevated AI risk (78) without elite confidence (77% < 82%) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Entry quality: elevated AI risk (78) without elite confidence (77% < 82%). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.0355 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Entry quality: elevated AI risk (78) without elite confidence (77% < 82%)

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 39

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:01:57.386Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 69.07 |
| Confidence | 58.5 |
| Ranking Score | 51.62 |
| Risk Score | 51.49 |
| Position Size | 348.17 |
| Entry Price | 2508.59 |
| Stop Loss | 2478.81 |
| Take Profit | 2589.47 |
| Exit Price | 2508.59 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (51.62 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (51.62 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.8682 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 40

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:03:27.388Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 59.94 |
| Confidence | 69.98 |
| Ranking Score | 88.28 |
| Risk Score | 63.88 |
| Position Size | 876.86 |
| Entry Price | 3463.69 |
| Stop Loss | 3424.07 |
| Take Profit | 3573.49 |
| Exit Price | 3463.69 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.1197 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 31–40

- Completed Trades: 40
- Accepted: 1
- Rejected: 39
- Batch Win Rate: 0%
- Profit Factor: 999
- Expectancy: 1.3687
- Sharpe Ratio: 0
- Average Confidence: 70.86
- Average Holding Time: 1280s
- Average Risk Score: 48.16
- Top Rejection Reason: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: N/A in N/A
- Most Common Failure Pattern: Entry quality: elevated AI risk (79) without elite confidence (82% < 82%)
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 41

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:04:57.391Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 60.45 |
| Confidence | 55.26 |
| Ranking Score | 45.95 |
| Risk Score | 68.59 |
| Position Size | 549.39 |
| Entry Price | 1034.44 |
| Stop Loss | 1025.26 |
| Take Profit | 1056.85 |
| Exit Price | 1034.44 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (45.95 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (45.95 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.3015 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 42

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:06:27.393Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 53.48 |
| Confidence | 88.23 |
| Ranking Score | 92.18 |
| Risk Score | 28.83 |
| Position Size | 565.78 |
| Entry Price | 1999.47 |
| Stop Loss | 1975.28 |
| Take Profit | 2058.97 |
| Exit Price | 1999.47 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 7.3551 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 43

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:07:57.396Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 49.3 |
| Confidence | 53.54 |
| Ranking Score | 71.88 |
| Risk Score | 26.12 |
| Position Size | 433.19 |
| Entry Price | 3409.98 |
| Stop Loss | 3356.61 |
| Take Profit | 3488.43 |
| Exit Price | 3409.98 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (71.88 < 88) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (71.88 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 44

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:09:27.398Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 87.91 |
| Confidence | 74.53 |
| Ranking Score | 48.63 |
| Risk Score | 26.29 |
| Position Size | 758.1 |
| Entry Price | 477.56 |
| Stop Loss | 471.12 |
| Take Profit | 485.37 |
| Exit Price | 477.56 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 7.9449 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 45

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:10:57.401Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 65.67 |
| Confidence | 81.92 |
| Ranking Score | 54.81 |
| Risk Score | 56.65 |
| Position Size | 534.94 |
| Entry Price | 3717 |
| Stop Loss | 3667.24 |
| Take Profit | 3820.86 |
| Exit Price | 3717 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (54.81 < 66) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (54.81 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.4925 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 46

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:12:27.403Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 89.94 |
| Confidence | 55.65 |
| Ranking Score | 75.42 |
| Risk Score | 69.35 |
| Position Size | 714.69 |
| Entry Price | 676.72 |
| Stop Loss | 665.8 |
| Take Profit | 697.32 |
| Exit Price | 676.72 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.337 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 47

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:13:57.406Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 76.35 |
| Confidence | 60.28 |
| Ranking Score | 40.82 |
| Risk Score | 30.18 |
| Position Size | 279.24 |
| Entry Price | 3726.79 |
| Stop Loss | 3667.05 |
| Take Profit | 3758.53 |
| Exit Price | 3726.79 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (40.82 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (40.82 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 48

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:15:27.408Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 65.58 |
| Confidence | 66.96 |
| Ranking Score | 41.43 |
| Risk Score | 35.38 |
| Position Size | 604.31 |
| Entry Price | 826.24 |
| Stop Loss | 810.11 |
| Take Profit | 836.86 |
| Exit Price | 826.24 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (41.43 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (41.43 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 49

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:16:57.411Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 60.11 |
| Confidence | 91.29 |
| Ranking Score | 55.35 |
| Risk Score | 39.87 |
| Position Size | 151.12 |
| Entry Price | 2306.36 |
| Stop Loss | 2277.85 |
| Take Profit | 2335.62 |
| Exit Price | 2306.36 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.0896 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 50

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:18:27.414Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 45.19 |
| Confidence | 70.36 |
| Ranking Score | 42.74 |
| Risk Score | 24.67 |
| Position Size | 831.51 |
| Entry Price | 764.41 |
| Stop Loss | 752.9 |
| Take Profit | 771.27 |
| Exit Price | 764.41 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (42.74 < 48) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (42.74 < 48). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.4319 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 41–50

- Completed Trades: 50
- Accepted: 1
- Rejected: 49
- Batch Win Rate: 0%
- Profit Factor: 999
- Expectancy: 1.3687
- Sharpe Ratio: 0
- Average Confidence: 70.65
- Average Holding Time: 1280s
- Average Risk Score: 46.65
- Top Rejection Reason: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: N/A in N/A
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 51

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:19:57.417Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 63.67 |
| Confidence | 89.8 |
| Ranking Score | 51.79 |
| Risk Score | 46.78 |
| Position Size | 459.06 |
| Entry Price | 341.98 |
| Stop Loss | 337.6 |
| Take Profit | 350.33 |
| Exit Price | 341.98 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (204699 < 5000000) |
| Confidence Threshold | 51 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (204699 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Liquidity gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 52

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:21:27.421Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 57.48 |
| Confidence | 92.13 |
| Ranking Score | 48.47 |
| Risk Score | 75.04 |
| Position Size | 320.59 |
| Entry Price | 2377.58 |
| Stop Loss | 2342.91 |
| Take Profit | 2407.82 |
| Exit Price | 2377.58 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (48.47 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (48.47 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.7731 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 53

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:22:57.423Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 85.71 |
| Confidence | 74.47 |
| Ranking Score | 76.93 |
| Risk Score | 33.04 |
| Position Size | 750.3 |
| Entry Price | 2574.77 |
| Stop Loss | 2538.16 |
| Take Profit | 2597.56 |
| Exit Price | 2574.77 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 54

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:24:27.426Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | SELL |
| Signal Score | 89.07 |
| Confidence | 81.23 |
| Ranking Score | 41.63 |
| Risk Score | 52.02 |
| Position Size | 334.04 |
| Entry Price | 2910551.22 |
| Stop Loss | 2872248.37 |
| Take Profit | 2945588.74 |
| Exit Price | 2910551.22 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (41.63 < 68) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (41.63 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 55

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:25:57.429Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 48.2 |
| Confidence | 75.22 |
| Ranking Score | 53.5 |
| Risk Score | 64 |
| Position Size | 788.83 |
| Entry Price | 3966.24 |
| Stop Loss | 3904.81 |
| Take Profit | 4007.12 |
| Exit Price | 3966.24 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (53.5 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (53.5 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 56

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:27:27.431Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 91.24 |
| Confidence | 75.78 |
| Ranking Score | 55.03 |
| Risk Score | 59.99 |
| Position Size | 582.7 |
| Entry Price | 364.73 |
| Stop Loss | 361.44 |
| Take Profit | 373.22 |
| Exit Price | 364.73 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (55.03 < 68) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (55.03 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.8763 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 57

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:28:57.434Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 76.53 |
| Confidence | 66.06 |
| Ranking Score | 69.49 |
| Risk Score | 77.27 |
| Position Size | 836.02 |
| Entry Price | 715.17 |
| Stop Loss | 703.08 |
| Take Profit | 735.76 |
| Exit Price | 715.17 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Expected profit below minimum |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 58

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:30:27.437Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 74.87 |
| Confidence | 92.67 |
| Ranking Score | 80.83 |
| Risk Score | 69.04 |
| Position Size | 843.275454 |
| Entry Price | 1285.75 |
| Stop Loss | 1270.08 |
| Take Profit | 1302.64 |
| Exit Price | 1275.4 |
| Exit Reason | STOP_LOSS |
| PnL % | -0.805 |
| PnL USDT | -7.9774 |
| Trade Duration | 1302s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 92.67% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

## Trade 59

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:31:57.441Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 84.38 |
| Confidence | 63.87 |
| Ranking Score | 71.03 |
| Risk Score | 37.91 |
| Position Size | 159.84 |
| Entry Price | 1730.46 |
| Stop Loss | 1706.03 |
| Take Profit | 1749.53 |
| Exit Price | 1730.46 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (71.03 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (71.03 < 88). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 60

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:33:27.444Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 75.69 |
| Confidence | 54.04 |
| Ranking Score | 62.66 |
| Risk Score | 42.96 |
| Position Size | 214.99 |
| Entry Price | 2254.63 |
| Stop Loss | 2211.54 |
| Take Profit | 2284.86 |
| Exit Price | 2254.63 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (62.66 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (62.66 < 82). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.664 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 51–60

- Completed Trades: 60
- Accepted: 2
- Rejected: 58
- Batch Win Rate: 0%
- Profit Factor: 0.172
- Expectancy: -3.3044
- Sharpe Ratio: -0.707
- Average Confidence: 71.63
- Average Holding Time: 1291s
- Average Risk Score: 48.18
- Top Rejection Reason: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: trend_pullback in trending
- Most Common Failure Pattern: Liquidity gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 61

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:34:57.447Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | SELL |
| Signal Score | 94.34 |
| Confidence | 78.11 |
| Ranking Score | 54.65 |
| Risk Score | 58.43 |
| Position Size | 970.58 |
| Entry Price | 1937.91 |
| Stop Loss | 1909.67 |
| Take Profit | 1981.9 |
| Exit Price | 1937.91 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (54.65 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (54.65 < 88). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 12.9087 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 62

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:36:27.450Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 54.11 |
| Confidence | 87.86 |
| Ranking Score | 46.47 |
| Risk Score | 66.82 |
| Position Size | 362.33 |
| Entry Price | 3113.67 |
| Stop Loss | 3092.26 |
| Take Profit | 3179.92 |
| Exit Price | 3113.67 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (46.47 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Expected profit below minimum |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (46.47 < 66). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.6848 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 63

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:37:57.453Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 91.88 |
| Confidence | 92.93 |
| Ranking Score | 59.62 |
| Risk Score | 69.57 |
| Position Size | 321.89 |
| Entry Price | 327.8 |
| Stop Loss | 323.24 |
| Take Profit | 332.64 |
| Exit Price | 327.8 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (59.62 < 66) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (59.62 < 66). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.75 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 64

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:39:27.456Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 67.95 |
| Confidence | 72.02 |
| Ranking Score | 40.59 |
| Risk Score | 23.24 |
| Position Size | 265.08 |
| Entry Price | 3249.29 |
| Stop Loss | 3174.07 |
| Take Profit | 3334.56 |
| Exit Price | 3249.29 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (40.59 < 48) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (40.59 < 48). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.7813 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 65

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:40:57.458Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | SELL |
| Signal Score | 86.16 |
| Confidence | 90.87 |
| Ranking Score | 71.01 |
| Risk Score | 60.19 |
| Position Size | 655.88 |
| Entry Price | 597.5 |
| Stop Loss | 590.79 |
| Take Profit | 611.25 |
| Exit Price | 597.5 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (71.01 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (71.01 < 88). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.397 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 66

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:42:27.461Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 67.14 |
| Confidence | 87.13 |
| Ranking Score | 52.92 |
| Risk Score | 40.18 |
| Position Size | 215.042268 |
| Entry Price | 1405.28 |
| Stop Loss | 1387.18 |
| Take Profit | 1450.03 |
| Exit Price | 1448.61 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 3.083 |
| PnL USDT | 6.1599 |
| Trade Duration | 1246s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in ranging regime with confidence 87.13% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 67

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:43:57.465Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 88.16 |
| Confidence | 60.95 |
| Ranking Score | 83.34 |
| Risk Score | 20.98 |
| Position Size | 861.71 |
| Entry Price | 1562.24 |
| Stop Loss | 1528.61 |
| Take Profit | 1601.15 |
| Exit Price | 1562.24 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.9963 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 68

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:45:27.468Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 70.28 |
| Confidence | 56.8 |
| Ranking Score | 89.04 |
| Risk Score | 32.48 |
| Position Size | 257.44 |
| Entry Price | 1907.37 |
| Stop Loss | 1861.59 |
| Take Profit | 1932.7 |
| Exit Price | 1907.37 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.4442 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 69

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:46:57.471Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 93.5 |
| Confidence | 82.49 |
| Ranking Score | 44.71 |
| Risk Score | 63.22 |
| Position Size | 785.06 |
| Entry Price | 3895.6 |
| Stop Loss | 3851 |
| Take Profit | 3994.09 |
| Exit Price | 3895.6 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (44.71 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (44.71 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.1776 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 70

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:48:27.474Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 48.72 |
| Confidence | 58.78 |
| Ranking Score | 83.69 |
| Risk Score | 19.13 |
| Position Size | 243.75 |
| Entry Price | 1036.12 |
| Stop Loss | 1011.25 |
| Take Profit | 1062.82 |
| Exit Price | 1036.12 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.9256 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 61–70

- Completed Trades: 70
- Accepted: 3
- Rejected: 67
- Batch Win Rate: 100%
- Profit Factor: 0.944
- Expectancy: -0.1496
- Sharpe Ratio: -0.025
- Average Confidence: 72.37
- Average Holding Time: 1276s
- Average Risk Score: 47.78
- Top Rejection Reason: Strategy momentum_scalp (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: mean_reversion in ranging
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 71

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:49:57.479Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 67.65 |
| Confidence | 53.35 |
| Ranking Score | 47.56 |
| Risk Score | 28.65 |
| Position Size | 244.63 |
| Entry Price | 3955.02 |
| Stop Loss | 3915.27 |
| Take Profit | 4009.68 |
| Exit Price | 3955.02 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (47.56 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (47.56 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 72

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:51:27.482Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 89.71 |
| Confidence | 73.21 |
| Ranking Score | 43.06 |
| Risk Score | 57.7 |
| Position Size | 665.56 |
| Entry Price | 2934253.51 |
| Stop Loss | 2885926.35 |
| Take Profit | 3021546.61 |
| Exit Price | 2934253.51 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.06 < 66) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.06 < 66). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 73

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:52:57.485Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 74.3 |
| Confidence | 70.84 |
| Ranking Score | 43.34 |
| Risk Score | 59.83 |
| Position Size | 264.87 |
| Entry Price | 3872.83 |
| Stop Loss | 3830.76 |
| Take Profit | 3946.36 |
| Exit Price | 3872.83 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.34 < 68) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.34 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.1283 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 74

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:54:27.488Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 89.19 |
| Confidence | 68.79 |
| Ranking Score | 58.2 |
| Risk Score | 67.6 |
| Position Size | 311.97 |
| Entry Price | 2805878.56 |
| Stop Loss | 2779671.65 |
| Take Profit | 2886034.66 |
| Exit Price | 2805878.56 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (58.2 < 68) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (58.2 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.8049 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 75

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:55:57.492Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.84 |
| Confidence | 88.6 |
| Ranking Score | 67.16 |
| Risk Score | 60.41 |
| Position Size | 286.04 |
| Entry Price | 612.07 |
| Stop Loss | 597.38 |
| Take Profit | 622.13 |
| Exit Price | 612.07 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (67.16 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (67.16 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.1499 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 76

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:57:27.495Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 92.58 |
| Confidence | 55.48 |
| Ranking Score | 87.44 |
| Risk Score | 53.35 |
| Position Size | 867.37 |
| Entry Price | 1709.68 |
| Stop Loss | 1688.05 |
| Take Profit | 1729.99 |
| Exit Price | 1709.68 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 77

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T21:58:57.498Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 91.96 |
| Confidence | 65.63 |
| Ranking Score | 55 |
| Risk Score | 72.6 |
| Position Size | 742.8 |
| Entry Price | 3776.67 |
| Stop Loss | 3726.3 |
| Take Profit | 3839.77 |
| Exit Price | 3776.67 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (55 < 68) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (55 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.7985 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 78

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:00:27.502Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 91.47 |
| Confidence | 76.12 |
| Ranking Score | 40.9 |
| Risk Score | 45.41 |
| Position Size | 521.14 |
| Entry Price | 366.01 |
| Stop Loss | 357.23 |
| Take Profit | 369.05 |
| Exit Price | 366.01 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (40.9 < 48) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Expected profit below minimum |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (40.9 < 48). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.0266 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 79

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:01:57.505Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 91.03 |
| Confidence | 77.79 |
| Ranking Score | 67.57 |
| Risk Score | 23.79 |
| Position Size | 494.2053 |
| Entry Price | 1356.68 |
| Stop Loss | 1337.54 |
| Take Profit | 1368.82 |
| Exit Price | 1368.48 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 0.87 |
| PnL USDT | 3.494 |
| Trade Duration | 4513s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in ranging regime with confidence 77.79% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 80

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:03:27.509Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 63.96 |
| Confidence | 52.18 |
| Ranking Score | 43.27 |
| Risk Score | 43.99 |
| Position Size | 212.74 |
| Entry Price | 1326.05 |
| Stop Loss | 1310.77 |
| Take Profit | 1366.23 |
| Exit Price | 1326.05 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.27 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Confidence below minimum threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.27 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.5275 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 71–80

- Completed Trades: 80
- Accepted: 4
- Rejected: 76
- Batch Win Rate: 100%
- Profit Factor: 1.382
- Expectancy: 0.7613
- Sharpe Ratio: 0.143
- Average Confidence: 71.85
- Average Holding Time: 2085s
- Average Risk Score: 48.23
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: mean_reversion in ranging
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 81

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:04:57.512Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 84.41 |
| Confidence | 85.4 |
| Ranking Score | 91.73 |
| Risk Score | 23.47 |
| Position Size | 866.023776 |
| Entry Price | 2379.02 |
| Stop Loss | 2363.79 |
| Take Profit | 2436.05 |
| Exit Price | 2421.62 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 1.791 |
| PnL USDT | 13.8824 |
| Trade Duration | 775s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in ranging regime with confidence 85.4% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 82

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:06:27.517Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 72.98 |
| Confidence | 88.81 |
| Ranking Score | 56.73 |
| Risk Score | 31.61 |
| Position Size | 237.27 |
| Entry Price | 471.98 |
| Stop Loss | 466.7 |
| Take Profit | 483.79 |
| Exit Price | 471.98 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.9137 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 83

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:07:57.520Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 53.51 |
| Confidence | 81.69 |
| Ranking Score | 48.51 |
| Risk Score | 28.56 |
| Position Size | 332.06 |
| Entry Price | 3192.99 |
| Stop Loss | 3148.86 |
| Take Profit | 3232.78 |
| Exit Price | 3192.99 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Risk per trade exceeds threshold |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 84

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:09:27.523Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 59.68 |
| Confidence | 66.99 |
| Ranking Score | 73.54 |
| Risk Score | 56.37 |
| Position Size | 318.47 |
| Entry Price | 927.05 |
| Stop Loss | 914.14 |
| Take Profit | 937.9 |
| Exit Price | 927.05 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (73.54 < 88) |
| Confidence Threshold | 51 |
| Ranking Result | FAIL |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (73.54 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.1751 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 85

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:10:57.526Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | SELL |
| Signal Score | 67.23 |
| Confidence | 56.82 |
| Ranking Score | 94.3 |
| Risk Score | 41.64 |
| Position Size | 577.05 |
| Entry Price | 3557.5 |
| Stop Loss | 3517.62 |
| Take Profit | 3598.39 |
| Exit Price | 3557.5 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 86

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:12:27.529Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 52.56 |
| Confidence | 93.17 |
| Ranking Score | 94.79 |
| Risk Score | 62.86 |
| Position Size | 759.48 |
| Entry Price | 2729.25 |
| Stop Loss | 2683.86 |
| Take Profit | 2786.46 |
| Exit Price | 2729.25 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.2455 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 87

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:13:57.532Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 77.28 |
| Confidence | 57.09 |
| Ranking Score | 72.66 |
| Risk Score | 65.23 |
| Position Size | 705.67 |
| Entry Price | 990.8 |
| Stop Loss | 974.51 |
| Take Profit | 1020.87 |
| Exit Price | 990.8 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (72.66 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (72.66 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.6724 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 88

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:15:27.535Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 57.48 |
| Confidence | 58.19 |
| Ranking Score | 76.12 |
| Risk Score | 53.17 |
| Position Size | 384.16 |
| Entry Price | 2889.39 |
| Stop Loss | 2858.58 |
| Take Profit | 2956.33 |
| Exit Price | 2889.39 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.7326 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 89

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:16:57.539Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 70.99 |
| Confidence | 63.6 |
| Ranking Score | 85.7 |
| Risk Score | 56.4 |
| Position Size | 257.76 |
| Entry Price | 2789.24 |
| Stop Loss | 2722.3 |
| Take Profit | 2838.53 |
| Exit Price | 2789.24 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5596 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 90

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:18:27.542Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 69.45 |
| Confidence | 53.67 |
| Ranking Score | 74.59 |
| Risk Score | 74.11 |
| Position Size | 485.38 |
| Entry Price | 2042.26 |
| Stop Loss | 2003.02 |
| Take Profit | 2088.65 |
| Exit Price | 2042.26 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (74.59 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (74.59 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 5.0188 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 81–90

- Completed Trades: 90
- Accepted: 5
- Rejected: 85
- Batch Win Rate: 100%
- Profit Factor: 3.122
- Expectancy: 3.3855
- Sharpe Ratio: 0.478
- Average Confidence: 71.7
- Average Holding Time: 1823s
- Average Risk Score: 48.35
- Top Rejection Reason: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: mean_reversion in ranging
- Most Common Failure Pattern: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 91

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:19:57.546Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 61.98 |
| Confidence | 64.42 |
| Ranking Score | 68.28 |
| Risk Score | 51.83 |
| Position Size | 254.94 |
| Entry Price | 1977.46 |
| Stop Loss | 1948.81 |
| Take Profit | 2021.56 |
| Exit Price | 1977.46 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (68.28 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (68.28 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.3563 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 92

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:21:27.549Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 63.99 |
| Confidence | 87.78 |
| Ranking Score | 63.12 |
| Risk Score | 44.05 |
| Position Size | 629.62 |
| Entry Price | 2882591.67 |
| Stop Loss | 2840505.83 |
| Take Profit | 2969579.31 |
| Exit Price | 2882591.67 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy breakout_follow (BREAKOUT_CONTINUATION) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 93

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:22:57.553Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 50.62 |
| Confidence | 75.56 |
| Ranking Score | 73.63 |
| Risk Score | 45.16 |
| Position Size | 849.9994 |
| Entry Price | 3136.69 |
| Stop Loss | 3114.45 |
| Take Profit | 3222.99 |
| Exit Price | 3214.04 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.466 |
| PnL USDT | 19.108 |
| Trade Duration | 2918s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in trending regime with confidence 75.56% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 94

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:24:27.557Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 63.86 |
| Confidence | 88.54 |
| Ranking Score | 86.07 |
| Risk Score | 26.11 |
| Position Size | 354.34 |
| Entry Price | 3912.99 |
| Stop Loss | 3842.31 |
| Take Profit | 3957.89 |
| Exit Price | 3912.99 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 95

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:25:57.560Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 60.61 |
| Confidence | 74.42 |
| Ranking Score | 63.41 |
| Risk Score | 51.17 |
| Position Size | 169.13 |
| Entry Price | 1080.55 |
| Stop Loss | 1064.27 |
| Take Profit | 1092.12 |
| Exit Price | 1080.55 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (63.41 < 88) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (63.41 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.46 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 96

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:27:27.564Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 66.05 |
| Confidence | 83.79 |
| Ranking Score | 55.51 |
| Risk Score | 72.28 |
| Position Size | 684.06 |
| Entry Price | 3389.53 |
| Stop Loss | 3335.47 |
| Take Profit | 3446.7 |
| Exit Price | 3389.53 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (55.51 < 68) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (55.51 < 68). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.6037 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 97

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:28:57.567Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.21 |
| Confidence | 93.88 |
| Ranking Score | 56.58 |
| Risk Score | 38.43 |
| Position Size | 986.7 |
| Entry Price | 2854678.27 |
| Stop Loss | 2786165.99 |
| Take Profit | 2924027.46 |
| Exit Price | 2854678.27 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 98

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:30:27.570Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 75.94 |
| Confidence | 74.38 |
| Ranking Score | 53.2 |
| Risk Score | 64.2 |
| Position Size | 916.28 |
| Entry Price | 2002.42 |
| Stop Loss | 1955.21 |
| Take Profit | 2042.25 |
| Exit Price | 2002.42 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (53.2 < 82) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (53.2 < 82). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 99

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:31:57.574Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 71.95 |
| Confidence | 78.06 |
| Ranking Score | 52.72 |
| Risk Score | 27.96 |
| Position Size | 188.21 |
| Entry Price | 2948.15 |
| Stop Loss | 2904.81 |
| Take Profit | 3003.47 |
| Exit Price | 2948.15 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set |
| Confidence Threshold | 49 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.2152 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Strategy mean_reversion (RANGE_MEAN_REVERSION) misaligned with regime allowed set

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 100

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-04T22:33:27.577Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 57.5 |
| Confidence | 67.07 |
| Ranking Score | 78.11 |
| Risk Score | 53.22 |
| Position Size | 632.48 |
| Entry Price | 622.79 |
| Stop Loss | 613.17 |
| Take Profit | 630.11 |
| Exit Price | 622.79 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (78.11 < 88) |
| Confidence Threshold | 49 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (78.11 < 88). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5932 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 91–100

- Completed Trades: 100
- Accepted: 6
- Rejected: 94
- Batch Win Rate: 100%
- Profit Factor: 5.517
- Expectancy: 6.0059
- Sharpe Ratio: 0.688
- Average Confidence: 72.41
- Average Holding Time: 2006s
- Average Risk Score: 48.26
- Top Rejection Reason: Strategy trend_pullback (TREND_PULLBACK) misaligned with regime allowed set
- Most Successful Pattern: momentum_scalp in trending
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Final Simulation Report — Trade 100 Complete

### Overall Statistics
- Completed Trades: 100
- Accepted: 6 | Rejected: 94
- Win Rate: 83.33%
- Profit Factor: 5.517
- Expectancy: 6.0059 USDT
- Sharpe Ratio: 0.688
- Total PnL: 36.0356 USDT
- Acceptance Rate: 6%
- Cumulative Missed Profit (rejected): 259.2234 USDT

### Best Strategies
1. mean_reversion — 4 trades, 24.905 USDT
2. momentum_scalp — 1 trades, 19.108 USDT
3. trend_pullback — 1 trades, -7.9774 USDT

### Worst Strategies
1. trend_pullback — 1 trades, -7.9774 USDT
2. momentum_scalp — 1 trades, 19.108 USDT
3. mean_reversion — 4 trades, 24.905 USDT

### False Positives
- Count: 1
- Primary pattern: accepted trades with negative PnL (STOP_LOSS)

### False Negatives
- Count: 66
- Estimated missed profit: 259.2234 USDT

### Risk Engine Analysis
- Policy: consecutiveLossBlocksEntry=false
- Top risk rejections: Liquidity below threshold (374582 < 5000000)

### Confidence Threshold Analysis
- Effective bounded threshold: 45
- Average candidate confidence: 72.41

### Ranking Analysis
- Ranking threshold used: 55
- Rejections citing ranking: 50

### Liquidity Analysis
- Liquidity rejections: 21

### AI Consensus Analysis
- NO_TRADE rejections: 33

### Engineering Recommendations
1. Keep consecutive-loss telemetry-only policy; simulation shows no streak hard-blocks.
2. Tune ranking threshold if false-negative missed profit exceeds acceptable bounds.
3. Continue bounding stale DB confidence via boundMinConfidenceThreshold.

### Business Recommendations
1. Prioritize strategies with positive simulated expectancy in trending regimes.
2. Reduce exposure during low_liquidity regime signals.
3. Use /api/risk/evaluate dry-run before promoting strategy config changes.

---

