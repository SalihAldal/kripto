# BrainOS Simulation Lab — simulation-v1

## Trade 1

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:03:45.949Z |
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
| Stop Loss | 3960.83 |
| Take Profit | 4107.08 |
| Exit Price | 4001.06 |
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

## Trade 2

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:05:15.971Z |
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
| Stop Loss | 3359.15 |
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
| Timestamp | 2026-08-01T21:06:45.974Z |
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
| Stop Loss | 2333.03 |
| Take Profit | 2379.77 |
| Exit Price | 2356.25 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (256320 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (256320 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.7816 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 4

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:08:15.976Z |
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
| Confidence Threshold | 45 |
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
| Timestamp | 2026-08-01T21:09:45.978Z |
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
| Stop Loss | 1019.83 |
| Take Profit | 1040.58 |
| Exit Price | 1032.18 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.7027 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 6

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:11:15.980Z |
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
| Stop Loss | 3117.74 |
| Take Profit | 3181.83 |
| Exit Price | 3155.96 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.8437 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 7

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:12:45.982Z |
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
| Rejection Reason | Ranking below threshold (48.17 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (48.17 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 8

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:14:15.984Z |
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
| Stop Loss | 1278.83 |
| Take Profit | 1319.5 |
| Exit Price | 1296.37 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (46.4 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (46.4 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.8539 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 9

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:15:45.987Z |
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
| Stop Loss | 1922.44 |
| Take Profit | 1977.94 |
| Exit Price | 1975.76 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 1.875 |
| PnL USDT | 12.3229 |
| Trade Duration | 1080s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in volatile regime with confidence 72.23% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 10

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:17:15.991Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | SELL |
| Signal Score | 84.07 |
| Confidence | 85.29 |
| Ranking Score | 94.09 |
| Risk Score | 38.64 |
| Position Size | 446.55 |
| Entry Price | 3954.99 |
| Stop Loss | 3910.28 |
| Take Profit | 3989.95 |
| Exit Price | 3954.99 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (330123 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (330123 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.7468 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 1–10

- Completed Trades: 10
- Accepted: 1
- Rejected: 9
- Batch Win Rate: 100%
- Profit Factor: 999
- Expectancy: 12.3229
- Sharpe Ratio: 0
- Average Confidence: 67.91
- Average Holding Time: 1080s
- Average Risk Score: 36.29
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: momentum_scalp in volatile
- Most Common Failure Pattern: Risk per trade exceeds threshold
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 11

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:18:45.997Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 85.5 |
| Confidence | 55.69 |
| Ranking Score | 47 |
| Risk Score | 37.47 |
| Position Size | 558.46 |
| Entry Price | 3960 |
| Stop Loss | 3913.52 |
| Take Profit | 4023.29 |
| Exit Price | 3960 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (47 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (47 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 12

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:20:15.999Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 87.69 |
| Confidence | 91.77 |
| Ranking Score | 79.3 |
| Risk Score | 70.45 |
| Position Size | 699.65 |
| Entry Price | 198.69 |
| Stop Loss | 196.95 |
| Take Profit | 200.62 |
| Exit Price | 198.69 |
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

**Estimated Missed Profit:** 2.5537 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 13

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:21:46.002Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 55.86 |
| Confidence | 67.41 |
| Ranking Score | 65.78 |
| Risk Score | 34.43 |
| Position Size | 471.21 |
| Entry Price | 3100.48 |
| Stop Loss | 3067.34 |
| Take Profit | 3162.85 |
| Exit Price | 3100.48 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Abnormal volatility breaker |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Abnormal volatility breaker. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.4655 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Abnormal volatility breaker

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 14

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:23:16.004Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 75.51 |
| Confidence | 76.29 |
| Ranking Score | 42.69 |
| Risk Score | 46.93 |
| Position Size | 232.86 |
| Entry Price | 833.77 |
| Stop Loss | 818.81 |
| Take Profit | 840.61 |
| Exit Price | 833.77 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (42.69 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (42.69 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 15

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:24:46.007Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 90.09 |
| Confidence | 66.4 |
| Ranking Score | 49.25 |
| Risk Score | 19.1 |
| Position Size | 462.32 |
| Entry Price | 2199.78 |
| Stop Loss | 2175.62 |
| Take Profit | 2241.9 |
| Exit Price | 2199.78 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (49.25 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (49.25 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.2718 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 16

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:26:16.009Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 51.92 |
| Confidence | 73.15 |
| Ranking Score | 66.56 |
| Risk Score | 38.61 |
| Position Size | 663.01 |
| Entry Price | 2963115.21 |
| Stop Loss | 2909828.35 |
| Take Profit | 3013296.86 |
| Exit Price | 2953745.7 |
| Exit Reason | TIMEOUT |
| PnL % | -0.316 |
| PnL USDT | -2.0951 |
| Trade Duration | 2090s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed breakout_follow in trending regime with confidence 73.15% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

## Trade 17

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:27:46.012Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 45.31 |
| Confidence | 65.87 |
| Ranking Score | 47.94 |
| Risk Score | 48.29 |
| Position Size | 678.99 |
| Entry Price | 464.76 |
| Stop Loss | 458 |
| Take Profit | 470 |
| Exit Price | 464.76 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (47.94 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (47.94 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 18

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:29:16.014Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 53.31 |
| Confidence | 74.5 |
| Ranking Score | 44.35 |
| Risk Score | 40.34 |
| Position Size | 354.1 |
| Entry Price | 1459.65 |
| Stop Loss | 1440.73 |
| Take Profit | 1495.13 |
| Exit Price | 1459.65 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (44.35 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (44.35 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5601 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 19

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:30:46.016Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 52.94 |
| Confidence | 63.73 |
| Ranking Score | 51.25 |
| Risk Score | 47.18 |
| Position Size | 814.08 |
| Entry Price | 939.81 |
| Stop Loss | 926.89 |
| Take Profit | 957.34 |
| Exit Price | 939.81 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (51.25 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (51.25 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 20

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:32:16.019Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 89.04 |
| Confidence | 77.35 |
| Ranking Score | 67.63 |
| Risk Score | 41.51 |
| Position Size | 309.99 |
| Entry Price | 1976.47 |
| Stop Loss | 1944.02 |
| Take Profit | 2030.36 |
| Exit Price | 1974.83 |
| Exit Reason | TIMEOUT |
| PnL % | -0.083 |
| PnL USDT | -0.2573 |
| Trade Duration | 3217s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in ranging regime with confidence 77.35% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

### Batch Summary — Trades 11–20

- Completed Trades: 20
- Accepted: 3
- Rejected: 17
- Batch Win Rate: 0%
- Profit Factor: 5.238
- Expectancy: 3.3235
- Sharpe Ratio: 0.519
- Average Confidence: 69.56
- Average Holding Time: 2129s
- Average Risk Score: 39.36
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: momentum_scalp in ranging
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 21

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:33:46.022Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 67.34 |
| Confidence | 82.19 |
| Ranking Score | 48.18 |
| Risk Score | 77.86 |
| Position Size | 605.32 |
| Entry Price | 2858358.34 |
| Stop Loss | 2811929.81 |
| Take Profit | 2929901.8 |
| Exit Price | 2858358.34 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (48.18 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (48.18 < 55). Consecutive-loss telemetry (2) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 7.9479 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 22

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:35:16.024Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 50.28 |
| Confidence | 71.69 |
| Ranking Score | 57.93 |
| Risk Score | 68.22 |
| Position Size | 223.48 |
| Entry Price | 3931.41 |
| Stop Loss | 3887.97 |
| Take Profit | 3998.59 |
| Exit Price | 3931.41 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (2) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.428 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 23

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:36:46.026Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 74.88 |
| Confidence | 75.59 |
| Ranking Score | 47.78 |
| Risk Score | 70.09 |
| Position Size | 355.53 |
| Entry Price | 2903.58 |
| Stop Loss | 2864.71 |
| Take Profit | 2943.72 |
| Exit Price | 2903.58 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (47.78 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (47.78 < 55). Consecutive-loss telemetry (2) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.2799 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 24

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:38:16.028Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 72.75 |
| Confidence | 91.13 |
| Ranking Score | 58.41 |
| Risk Score | 30.87 |
| Position Size | 791.84 |
| Entry Price | 2676.08 |
| Stop Loss | 2646.01 |
| Take Profit | 2734.22 |
| Exit Price | 2676.08 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (2142072 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (2142072 < 5000000). Consecutive-loss telemetry (2) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.1843 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 25

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:39:46.030Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 91.49 |
| Confidence | 91.09 |
| Ranking Score | 69.2 |
| Risk Score | 45.84 |
| Position Size | 849.01 |
| Entry Price | 1799.99 |
| Stop Loss | 1770.71 |
| Take Profit | 1843.69 |
| Exit Price | 1839.08 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.172 |
| PnL USDT | 18.4405 |
| Trade Duration | 223s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in ranging regime with confidence 91.09% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 26

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:41:16.033Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | SELL |
| Signal Score | 66.37 |
| Confidence | 78.36 |
| Ranking Score | 65.41 |
| Risk Score | 40.17 |
| Position Size | 219.06 |
| Entry Price | 2906446.11 |
| Stop Loss | 2877706.63 |
| Take Profit | 2933711.98 |
| Exit Price | 2906446.11 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Signal not actionable |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Signal not actionable. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.9398 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Signal not actionable

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 27

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:42:46.035Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 71.77 |
| Confidence | 66.82 |
| Ranking Score | 43.26 |
| Risk Score | 31.93 |
| Position Size | 170.48 |
| Entry Price | 2559.53 |
| Stop Loss | 2539.64 |
| Take Profit | 2599.35 |
| Exit Price | 2559.53 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.26 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.26 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 28

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:44:16.037Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 73.77 |
| Confidence | 87.22 |
| Ranking Score | 55.74 |
| Risk Score | 38.11 |
| Position Size | 659.09 |
| Entry Price | 2984521.63 |
| Stop Loss | 2945272.52 |
| Take Profit | 3074257.04 |
| Exit Price | 2984521.63 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.8707 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 29

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:45:46.039Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 71.43 |
| Confidence | 83.67 |
| Ranking Score | 83.85 |
| Risk Score | 61.33 |
| Position Size | 354.12 |
| Entry Price | 856.22 |
| Stop Loss | 850.24 |
| Take Profit | 864.63 |
| Exit Price | 856.22 |
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

**Estimated Missed Profit:** 3.7112 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 30

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:47:16.040Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 67.97 |
| Confidence | 62.92 |
| Ranking Score | 67.04 |
| Risk Score | 48.65 |
| Position Size | 719.98 |
| Entry Price | 1167.26 |
| Stop Loss | 1155.89 |
| Take Profit | 1187.94 |
| Exit Price | 1181.77 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 1.243 |
| PnL USDT | 8.9494 |
| Trade Duration | 2936s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in trending regime with confidence 62.92% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

### Batch Summary — Trades 21–30

- Completed Trades: 30
- Accepted: 5
- Rejected: 25
- Batch Win Rate: 100%
- Profit Factor: 16.882
- Expectancy: 7.4721
- Sharpe Ratio: 0.969
- Average Confidence: 72.73
- Average Holding Time: 1909s
- Average Risk Score: 43.34
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: mean_reversion in ranging
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 31

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:48:46.044Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 68.38 |
| Confidence | 53.19 |
| Ranking Score | 94.51 |
| Risk Score | 78.21 |
| Position Size | 275 |
| Entry Price | 198.5 |
| Stop Loss | 196.23 |
| Take Profit | 201.58 |
| Exit Price | 198.5 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 32

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:50:16.046Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 47.63 |
| Confidence | 92.87 |
| Ranking Score | 42.3 |
| Risk Score | 60.9 |
| Position Size | 239.32 |
| Entry Price | 1423.63 |
| Stop Loss | 1403.73 |
| Take Profit | 1446.68 |
| Exit Price | 1423.63 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (42.3 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (42.3 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 33

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:51:46.048Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 73.57 |
| Confidence | 87.2 |
| Ranking Score | 70.94 |
| Risk Score | 37.68 |
| Position Size | 930.04 |
| Entry Price | 2172.21 |
| Stop Loss | 2155.23 |
| Take Profit | 2203.28 |
| Exit Price | 2172.21 |
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

**Estimated Missed Profit:** 4.5107 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 34

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:53:16.051Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 92.39 |
| Confidence | 63.2 |
| Ranking Score | 68.37 |
| Risk Score | 22.66 |
| Position Size | 725.45 |
| Entry Price | 3002.76 |
| Stop Loss | 2949.96 |
| Take Profit | 3093.93 |
| Exit Price | 3002.76 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (625400 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (625400 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 8.6111 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 35

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:54:46.053Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 65.82 |
| Confidence | 57.33 |
| Ranking Score | 67.63 |
| Risk Score | 27.28 |
| Position Size | 575.05 |
| Entry Price | 1875.11 |
| Stop Loss | 1843.26 |
| Take Profit | 1910.93 |
| Exit Price | 1875.11 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1789888 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1789888 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.1818 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 36

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:56:16.056Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 50.64 |
| Confidence | 71.61 |
| Ranking Score | 80.51 |
| Risk Score | 25.75 |
| Position Size | 221.03 |
| Entry Price | 1584.49 |
| Stop Loss | 1574.06 |
| Take Profit | 1620.11 |
| Exit Price | 1584.49 |
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

**Estimated Missed Profit:** 2.7364 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 37

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:57:46.059Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 62.49 |
| Confidence | 53.81 |
| Ranking Score | 71.18 |
| Risk Score | 46.22 |
| Position Size | 224.05 |
| Entry Price | 1302.38 |
| Stop Loss | 1290.45 |
| Take Profit | 1334.3 |
| Exit Price | 1302.38 |
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

**Estimated Missed Profit:** 2.292 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 38

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T21:59:16.061Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 86.48 |
| Confidence | 72.82 |
| Ranking Score | 85.22 |
| Risk Score | 47.9 |
| Position Size | 200.16 |
| Entry Price | 876.5 |
| Stop Loss | 867.07 |
| Take Profit | 902.23 |
| Exit Price | 895.41 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.157 |
| PnL USDT | 4.3175 |
| Trade Duration | 1261s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in trending regime with confidence 72.82% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 39

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:00:46.063Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 75.36 |
| Confidence | 72.54 |
| Ranking Score | 93.33 |
| Risk Score | 32.45 |
| Position Size | 930.82 |
| Entry Price | 1147.88 |
| Stop Loss | 1133.91 |
| Take Profit | 1171.62 |
| Exit Price | 1147.88 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1854771 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1854771 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.6249 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 40

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:02:16.065Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 87.3 |
| Confidence | 71.05 |
| Ranking Score | 92.14 |
| Risk Score | 71.02 |
| Position Size | 892.42 |
| Entry Price | 780.18 |
| Stop Loss | 769.08 |
| Take Profit | 792.82 |
| Exit Price | 780.18 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

### Batch Summary — Trades 31–40

- Completed Trades: 40
- Accepted: 6
- Rejected: 34
- Batch Win Rate: 100%
- Profit Factor: 18.717
- Expectancy: 6.9463
- Sharpe Ratio: 0.973
- Average Confidence: 71.94
- Average Holding Time: 1801s
- Average Risk Score: 43.76
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: momentum_scalp in trending
- Most Common Failure Pattern: AI consensus disagreement
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 41

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:03:46.069Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 56.93 |
| Confidence | 55.54 |
| Ranking Score | 70.07 |
| Risk Score | 47.13 |
| Position Size | 849.68 |
| Entry Price | 2807767.38 |
| Stop Loss | 2781944.09 |
| Take Profit | 2842315.37 |
| Exit Price | 2807767.38 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (421582 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (421582 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Liquidity gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 42

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:05:16.072Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 68.99 |
| Confidence | 73.34 |
| Ranking Score | 87.87 |
| Risk Score | 48.33 |
| Position Size | 912.34 |
| Entry Price | 1661.11 |
| Stop Loss | 1641.03 |
| Take Profit | 1684.57 |
| Exit Price | 1661.11 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1939002 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1939002 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.7882 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 43

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:06:46.075Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 86.62 |
| Confidence | 67.11 |
| Ranking Score | 73.01 |
| Risk Score | 38.66 |
| Position Size | 173.83 |
| Entry Price | 2930455.27 |
| Stop Loss | 2894541.78 |
| Take Profit | 2958057.02 |
| Exit Price | 2930455.27 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 44

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:08:16.078Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 49.97 |
| Confidence | 78.21 |
| Ranking Score | 58.37 |
| Risk Score | 62.36 |
| Position Size | 771.41 |
| Entry Price | 2844598.81 |
| Stop Loss | 2813447.44 |
| Take Profit | 2926237.04 |
| Exit Price | 2844598.81 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5688 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 45

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:09:46.081Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 90.46 |
| Confidence | 74.93 |
| Ranking Score | 83.87 |
| Risk Score | 46.08 |
| Position Size | 633.64 |
| Entry Price | 2261.35 |
| Stop Loss | 2232.24 |
| Take Profit | 2334.71 |
| Exit Price | 2316.02 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.418 |
| PnL USDT | 15.3214 |
| Trade Duration | 814s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 74.93% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 46

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:11:16.084Z |
| Market | SPOT_TRY |
| Symbol | ETHTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 89.89 |
| Confidence | 79.9 |
| Ranking Score | 58.75 |
| Risk Score | 60.43 |
| Position Size | 767.42 |
| Entry Price | 1180.27 |
| Stop Loss | 1167.18 |
| Take Profit | 1196.39 |
| Exit Price | 1180.27 |
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

## Trade 47

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:12:46.087Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 46.04 |
| Confidence | 58.39 |
| Ranking Score | 56.89 |
| Risk Score | 53.13 |
| Position Size | 887.37 |
| Entry Price | 1684.66 |
| Stop Loss | 1673.07 |
| Take Profit | 1731.93 |
| Exit Price | 1684.66 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.5665 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 48

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:14:16.090Z |
| Market | SPOT_TRY |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 54.71 |
| Confidence | 74.45 |
| Ranking Score | 81.03 |
| Risk Score | 27.26 |
| Position Size | 155.45 |
| Entry Price | 1962.49 |
| Stop Loss | 1944.77 |
| Take Profit | 1986.21 |
| Exit Price | 1962.49 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1635819 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Liquidity below threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1635819 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Liquidity gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 49

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:15:46.093Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 54.37 |
| Confidence | 52.06 |
| Ranking Score | 53.58 |
| Risk Score | 52.7 |
| Position Size | 928.74 |
| Entry Price | 2085.7 |
| Stop Loss | 2054.91 |
| Take Profit | 2119.83 |
| Exit Price | 2085.7 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Exchange restriction: symbol temporarily blocked |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | BLOCKED |

**Engineering Analysis:** Rejected due to: Exchange restriction: symbol temporarily blocked. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.8977 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Exchange restriction: symbol temporarily blocked

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 50

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:17:16.095Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 46.94 |
| Confidence | 85.67 |
| Ranking Score | 55.23 |
| Risk Score | 74.61 |
| Position Size | 973.53 |
| Entry Price | 2754.95 |
| Stop Loss | 2708.75 |
| Take Profit | 2811.54 |
| Exit Price | 2754.95 |
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

### Batch Summary — Trades 41–50

- Completed Trades: 50
- Accepted: 7
- Rejected: 43
- Batch Win Rate: 100%
- Profit Factor: 25.23
- Expectancy: 8.1428
- Sharpe Ratio: 1.127
- Average Confidence: 71.54
- Average Holding Time: 1660s
- Average Risk Score: 45.22
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: trend_pullback in trending
- Most Common Failure Pattern: Liquidity gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 51

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:18:46.098Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 77.85 |
| Confidence | 67.27 |
| Ranking Score | 72.33 |
| Risk Score | 27.12 |
| Position Size | 381.31 |
| Entry Price | 256.08 |
| Stop Loss | 254.3 |
| Take Profit | 260.23 |
| Exit Price | 256.08 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 52

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:20:16.100Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 54.44 |
| Confidence | 60.43 |
| Ranking Score | 49.54 |
| Risk Score | 43.67 |
| Position Size | 611.75 |
| Entry Price | 151.98 |
| Stop Loss | 149.59 |
| Take Profit | 154.03 |
| Exit Price | 151.98 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (49.54 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (49.54 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 53

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:21:46.103Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 46.7 |
| Confidence | 81.66 |
| Ranking Score | 68.79 |
| Risk Score | 74.77 |
| Position Size | 572.99 |
| Entry Price | 3502.85 |
| Stop Loss | 3474.2 |
| Take Profit | 3533.36 |
| Exit Price | 3502.85 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1029253 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1029253 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.203 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 54

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:23:16.105Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 53.08 |
| Confidence | 61.09 |
| Ranking Score | 67.28 |
| Risk Score | 23.07 |
| Position Size | 353.43 |
| Entry Price | 3316.4 |
| Stop Loss | 3291.04 |
| Take Profit | 3416.64 |
| Exit Price | 3415.45 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.987 |
| PnL USDT | 10.557 |
| Trade Duration | 922s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in ranging regime with confidence 61.09% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 55

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:24:46.107Z |
| Market | SPOT_TRY |
| Symbol | ADATRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 85.72 |
| Confidence | 69.78 |
| Ranking Score | 82.93 |
| Risk Score | 34.32 |
| Position Size | 287.19 |
| Entry Price | 3624.17 |
| Stop Loss | 3596.33 |
| Take Profit | 3689.37 |
| Exit Price | 3597.12 |
| Exit Reason | STOP_LOSS |
| PnL % | -0.746 |
| PnL USDT | -2.1424 |
| Trade Duration | 786s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 69.78% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

## Trade 56

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:26:16.110Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 63.37 |
| Confidence | 59.73 |
| Ranking Score | 61.92 |
| Risk Score | 48.25 |
| Position Size | 685.95 |
| Entry Price | 2812607.27 |
| Stop Loss | 2768351.28 |
| Take Profit | 2856826.15 |
| Exit Price | 2812607.27 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Abnormal volatility breaker |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Abnormal volatility breaker. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Abnormal volatility breaker

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 57

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:27:46.112Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 90.02 |
| Confidence | 81.3 |
| Ranking Score | 83.23 |
| Risk Score | 24.88 |
| Position Size | 657.75 |
| Entry Price | 1000.84 |
| Stop Loss | 993.17 |
| Take Profit | 1033.5 |
| Exit Price | 1000.84 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Exchange restriction: symbol temporarily blocked |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | BLOCKED |

**Engineering Analysis:** Rejected due to: Exchange restriction: symbol temporarily blocked. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Exchange restriction: symbol temporarily blocked

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 58

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:29:16.115Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 76.17 |
| Confidence | 58.58 |
| Ranking Score | 83.58 |
| Risk Score | 69.72 |
| Position Size | 665.13 |
| Entry Price | 1287.66 |
| Stop Loss | 1275.48 |
| Take Profit | 1323.27 |
| Exit Price | 1287.66 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1608611 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1608611 < 5000000). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.747 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 59

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:30:46.119Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 91.53 |
| Confidence | 92.23 |
| Ranking Score | 42.38 |
| Risk Score | 48.58 |
| Position Size | 710.5 |
| Entry Price | 2704.79 |
| Stop Loss | 2676.8 |
| Take Profit | 2772 |
| Exit Price | 2704.79 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (42.38 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (42.38 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 60

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:32:16.122Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 53.46 |
| Confidence | 62.78 |
| Ranking Score | 40.96 |
| Risk Score | 55.04 |
| Position Size | 820.37 |
| Entry Price | 2161.16 |
| Stop Loss | 2135.17 |
| Take Profit | 2219.5 |
| Exit Price | 2161.16 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (40.96 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (40.96 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

### Batch Summary — Trades 51–60

- Completed Trades: 60
- Accepted: 9
- Rejected: 51
- Batch Win Rate: 50%
- Profit Factor: 15.553
- Expectancy: 7.2682
- Sharpe Ratio: 1.005
- Average Confidence: 71.2
- Average Holding Time: 1481s
- Average Risk Score: 45.17
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: trend_pullback in ranging
- Most Common Failure Pattern: AI consensus disagreement
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 61

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:33:46.125Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.19 |
| Confidence | 80.55 |
| Ranking Score | 81.64 |
| Risk Score | 63.99 |
| Position Size | 474.41 |
| Entry Price | 690.45 |
| Stop Loss | 681.54 |
| Take Profit | 698.31 |
| Exit Price | 690.45 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 62

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:35:16.128Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 92.88 |
| Confidence | 56.88 |
| Ranking Score | 55.87 |
| Risk Score | 60.94 |
| Position Size | 775.22 |
| Entry Price | 1396.85 |
| Stop Loss | 1380.54 |
| Take Profit | 1410.8 |
| Exit Price | 1396.85 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.0777 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 63

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:36:46.131Z |
| Market | SPOT_TRY |
| Symbol | LINKTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 83.87 |
| Confidence | 75.46 |
| Ranking Score | 57.75 |
| Risk Score | 41.29 |
| Position Size | 303.64 |
| Entry Price | 1309.89 |
| Stop Loss | 1301.39 |
| Take Profit | 1337.18 |
| Exit Price | 1309.89 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Exchange restriction: symbol temporarily blocked |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | BLOCKED |

**Engineering Analysis:** Rejected due to: Exchange restriction: symbol temporarily blocked. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Exchange restriction: symbol temporarily blocked

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 64

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:38:16.134Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 72.48 |
| Confidence | 72.47 |
| Ranking Score | 68.32 |
| Risk Score | 78.28 |
| Position Size | 980.84 |
| Entry Price | 2937.68 |
| Stop Loss | 2918.01 |
| Take Profit | 3024.51 |
| Exit Price | 2928.26 |
| Exit Reason | TIMEOUT |
| PnL % | -0.321 |
| PnL USDT | -3.1485 |
| Trade Duration | 4523s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 72.47% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

## Trade 65

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:39:46.137Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 71.79 |
| Confidence | 85.43 |
| Ranking Score | 89.22 |
| Risk Score | 31.92 |
| Position Size | 526.43 |
| Entry Price | 1884.36 |
| Stop Loss | 1859.75 |
| Take Profit | 1936.73 |
| Exit Price | 1884.36 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (2) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 66

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:41:16.139Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 68.97 |
| Confidence | 90.82 |
| Ranking Score | 57.33 |
| Risk Score | 52.86 |
| Position Size | 920.57 |
| Entry Price | 1099.34 |
| Stop Loss | 1081.62 |
| Take Profit | 1127.28 |
| Exit Price | 1123.66 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.212 |
| PnL USDT | 20.363 |
| Trade Duration | 977s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 90.82% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 67

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:42:46.142Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 80.12 |
| Confidence | 68.78 |
| Ranking Score | 77.38 |
| Risk Score | 36.43 |
| Position Size | 579.81 |
| Entry Price | 2443.48 |
| Stop Loss | 2404.18 |
| Take Profit | 2506.78 |
| Exit Price | 2443.48 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1898600 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1898600 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.9516 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 68

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:44:16.144Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 76.3 |
| Confidence | 87.56 |
| Ranking Score | 58.47 |
| Risk Score | 36.98 |
| Position Size | 974.47 |
| Entry Price | 3822 |
| Stop Loss | 3783.24 |
| Take Profit | 3914.46 |
| Exit Price | 3822 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Signal not actionable |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Signal not actionable. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 10.4268 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Signal not actionable

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 69

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:45:46.147Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 59.75 |
| Confidence | 53.49 |
| Ranking Score | 94.29 |
| Risk Score | 65.43 |
| Position Size | 213.27 |
| Entry Price | 2563.61 |
| Stop Loss | 2522.22 |
| Take Profit | 2648.07 |
| Exit Price | 2563.61 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 70

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:47:16.149Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 88.53 |
| Confidence | 62.67 |
| Ranking Score | 43.54 |
| Risk Score | 40.44 |
| Position Size | 535.11 |
| Entry Price | 2844059.17 |
| Stop Loss | 2820616.96 |
| Take Profit | 2925844.26 |
| Exit Price | 2844059.17 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (43.54 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (43.54 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.2661 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 61–70

- Completed Trades: 70
- Accepted: 11
- Rejected: 59
- Batch Win Rate: 50%
- Profit Factor: 11.811
- Expectancy: 7.5117
- Sharpe Ratio: 0.91
- Average Confidence: 71.52
- Average Holding Time: 1712s
- Average Risk Score: 45.99
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: trend_pullback in trending
- Most Common Failure Pattern: Risk per trade exceeds threshold
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 71

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:48:46.152Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 66.56 |
| Confidence | 86.4 |
| Ranking Score | 72.42 |
| Risk Score | 43.41 |
| Position Size | 910.12 |
| Entry Price | 870.55 |
| Stop Loss | 858.71 |
| Take Profit | 897.97 |
| Exit Price | 889.62 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.191 |
| PnL USDT | 19.9407 |
| Trade Duration | 3744s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed momentum_scalp in trending regime with confidence 86.4% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 72

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:50:16.155Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 46.65 |
| Confidence | 75.17 |
| Ranking Score | 62.85 |
| Risk Score | 20.66 |
| Position Size | 201.56 |
| Entry Price | 1197.34 |
| Stop Loss | 1181.74 |
| Take Profit | 1220.35 |
| Exit Price | 1184.9 |
| Exit Reason | STOP_LOSS |
| PnL % | -1.039 |
| PnL USDT | -2.0942 |
| Trade Duration | 2493s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in volatile regime with confidence 75.17% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Adverse move after valid entry

**Lessons Learned:** Review stop placement for this strategy/regime combination.

---

## Trade 73

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:51:46.157Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 57.5 |
| Confidence | 53.14 |
| Ranking Score | 46.72 |
| Risk Score | 41.01 |
| Position Size | 776.23 |
| Entry Price | 1679.28 |
| Stop Loss | 1662.54 |
| Take Profit | 1726.3 |
| Exit Price | 1679.28 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (46.72 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (46.72 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 74

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:53:16.160Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 57.81 |
| Confidence | 52.83 |
| Ranking Score | 52.76 |
| Risk Score | 77.37 |
| Position Size | 725.76 |
| Entry Price | 3565.26 |
| Stop Loss | 3522.74 |
| Take Profit | 3654.75 |
| Exit Price | 3565.26 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (52.76 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (52.76 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 75

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:54:46.162Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 90.21 |
| Confidence | 77.44 |
| Ranking Score | 44.1 |
| Risk Score | 77.31 |
| Position Size | 603 |
| Entry Price | 2816565.4 |
| Stop Loss | 2770514.73 |
| Take Profit | 2879245.32 |
| Exit Price | 2816565.4 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (44.1 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (44.1 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 5.0773 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 76

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:56:16.165Z |
| Market | SPOT_USDT |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 52 |
| Confidence | 86.84 |
| Ranking Score | 83.04 |
| Risk Score | 28.27 |
| Position Size | 970.74 |
| Entry Price | 2864898.76 |
| Stop Loss | 2838331.02 |
| Take Profit | 2950887.49 |
| Exit Price | 2864898.76 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 12.3866 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 77

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:57:46.167Z |
| Market | SPOT_TRY |
| Symbol | ADATRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 82.53 |
| Confidence | 80.09 |
| Ranking Score | 69.66 |
| Risk Score | 78.93 |
| Position Size | 416.32 |
| Entry Price | 2376.95 |
| Stop Loss | 2362.22 |
| Take Profit | 2422.24 |
| Exit Price | 2376.95 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.0674 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 78

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T22:59:16.169Z |
| Market | SPOT_TRY |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | SELL |
| Signal Score | 87.27 |
| Confidence | 64.82 |
| Ranking Score | 71.59 |
| Risk Score | 60.3 |
| Position Size | 344.51 |
| Entry Price | 2536.5 |
| Stop Loss | 2506.03 |
| Take Profit | 2562.72 |
| Exit Price | 2536.5 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 1.4332 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 79

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:00:46.171Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 73.74 |
| Confidence | 53.09 |
| Ranking Score | 72.06 |
| Risk Score | 68.44 |
| Position Size | 200.57 |
| Entry Price | 3294.64 |
| Stop Loss | 3259.88 |
| Take Profit | 3321.35 |
| Exit Price | 3294.64 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.6295 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 80

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:02:16.176Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | momentum_scalp |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 46.84 |
| Confidence | 54.62 |
| Ranking Score | 52.18 |
| Risk Score | 53.61 |
| Position Size | 949.4 |
| Entry Price | 2883580.07 |
| Stop Loss | 2839006.05 |
| Take Profit | 2963981.49 |
| Exit Price | 2883580.07 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (52.18 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (52.18 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 5.1363 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 71–80

- Completed Trades: 80
- Accepted: 13
- Rejected: 67
- Batch Win Rate: 50%
- Profit Factor: 11.318
- Expectancy: 7.7288
- Sharpe Ratio: 0.883
- Average Confidence: 71.13
- Average Holding Time: 1928s
- Average Risk Score: 47.1
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: momentum_scalp in trending
- Most Common Failure Pattern: Ranking score gate
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 81

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:03:46.178Z |
| Market | SPOT_USDT |
| Symbol | DOGETRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | SELL |
| Signal Score | 46.88 |
| Confidence | 62.79 |
| Ranking Score | 73.98 |
| Risk Score | 48.24 |
| Position Size | 625.6 |
| Entry Price | 1102.32 |
| Stop Loss | 1087.4 |
| Take Profit | 1138.48 |
| Exit Price | 1102.32 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 82

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:05:16.181Z |
| Market | SPOT_TRY |
| Symbol | AVAXTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 68.18 |
| Confidence | 72.23 |
| Ranking Score | 70.49 |
| Risk Score | 64.23 |
| Position Size | 294.66 |
| Entry Price | 649.55 |
| Stop Loss | 638.71 |
| Take Profit | 661.93 |
| Exit Price | 649.55 |
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

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.1234 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 83

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:06:46.183Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 73.71 |
| Confidence | 92.43 |
| Ranking Score | 51.78 |
| Risk Score | 72.25 |
| Position Size | 399.55 |
| Entry Price | 3679.5 |
| Stop Loss | 3643.41 |
| Take Profit | 3800.6 |
| Exit Price | 3679.5 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (51.78 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (51.78 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 84

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:08:16.186Z |
| Market | SPOT_TRY |
| Symbol | ADATRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 84.77 |
| Confidence | 88.02 |
| Ranking Score | 45.68 |
| Risk Score | 71.32 |
| Position Size | 527.9 |
| Entry Price | 1987.3 |
| Stop Loss | 1968.68 |
| Take Profit | 2007.47 |
| Exit Price | 1987.3 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (45.68 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (45.68 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.6636 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 85

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:09:46.190Z |
| Market | SPOT_USDT |
| Symbol | AVAXTRY |
| Strategy | momentum_scalp |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 78.46 |
| Confidence | 76.71 |
| Ranking Score | 72.43 |
| Risk Score | 65.9 |
| Position Size | 278.49 |
| Entry Price | 1838.92 |
| Stop Loss | 1812.6 |
| Take Profit | 1861.49 |
| Exit Price | 1838.92 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.8828 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 86

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:11:16.192Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 86.09 |
| Confidence | 81.09 |
| Ranking Score | 52.98 |
| Risk Score | 70.25 |
| Position Size | 698.8 |
| Entry Price | 2422.15 |
| Stop Loss | 2383.96 |
| Take Profit | 2492.28 |
| Exit Price | 2422.15 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (52.98 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | PASS |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (52.98 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Ranking score gate

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 87

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:12:46.195Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 76.2 |
| Confidence | 53.86 |
| Ranking Score | 75.11 |
| Risk Score | 41.53 |
| Position Size | 362.22 |
| Entry Price | 1814.8 |
| Stop Loss | 1783.24 |
| Take Profit | 1870.46 |
| Exit Price | 1814.8 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5863 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 88

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:14:16.198Z |
| Market | SPOT_TRY |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 55.31 |
| Confidence | 71.62 |
| Ranking Score | 65.17 |
| Risk Score | 78.1 |
| Position Size | 591.83 |
| Entry Price | 2561.11 |
| Stop Loss | 2520.93 |
| Take Profit | 2625.88 |
| Exit Price | 2561.11 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.2616 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 89

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:15:46.202Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 52.26 |
| Confidence | 77.3 |
| Ranking Score | 50.01 |
| Risk Score | 58.89 |
| Position Size | 565.65 |
| Entry Price | 2853.76 |
| Stop Loss | 2807.44 |
| Take Profit | 2891.08 |
| Exit Price | 2853.76 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (50.01 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (50.01 < 55). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 7.0084 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 90

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:17:16.204Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | breakout_follow |
| Market Regime | ranging |
| Signal | BUY |
| Signal Score | 77.54 |
| Confidence | 73.7 |
| Ranking Score | 81.22 |
| Risk Score | 73.12 |
| Position Size | 438.61 |
| Entry Price | 2902404.19 |
| Stop Loss | 2852844.97 |
| Take Profit | 2943816.76 |
| Exit Price | 2902404.19 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.6492 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 81–90

- Completed Trades: 90
- Accepted: 13
- Rejected: 77
- Batch Win Rate: 0%
- Profit Factor: 11.318
- Expectancy: 7.7288
- Sharpe Ratio: 0.883
- Average Confidence: 71.56
- Average Holding Time: 1928s
- Average Risk Score: 49.02
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: N/A in N/A
- Most Common Failure Pattern: AI consensus disagreement
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Trade 91

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:18:46.208Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | breakout_follow |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 50.97 |
| Confidence | 71.72 |
| Ranking Score | 71.16 |
| Risk Score | 43.3 |
| Position Size | 472.8 |
| Entry Price | 424.41 |
| Stop Loss | 418.91 |
| Take Profit | 432.16 |
| Exit Price | 424.41 |
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

**Engineering Analysis:** Rejected due to: Risk per trade exceeds threshold. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.0518 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Risk per trade exceeds threshold

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 92

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:20:16.210Z |
| Market | SPOT_USDT |
| Symbol | ADATRY |
| Strategy | trend_pullback |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.58 |
| Confidence | 71.01 |
| Ranking Score | 83.81 |
| Risk Score | 23.24 |
| Position Size | 245.51 |
| Entry Price | 607.11 |
| Stop Loss | 600.05 |
| Take Profit | 625.09 |
| Exit Price | 607.11 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Abnormal volatility breaker |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Abnormal volatility breaker |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Abnormal volatility breaker. Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0.5573 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Abnormal volatility breaker

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 93

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:21:46.212Z |
| Market | SPOT_TRY |
| Symbol | BTCTRY |
| Strategy | trend_pullback |
| Market Regime | low_liquidity |
| Signal | SELL |
| Signal Score | 62.45 |
| Confidence | 66 |
| Ranking Score | 87.88 |
| Risk Score | 29.1 |
| Position Size | 522.01 |
| Entry Price | 2908659.55 |
| Stop Loss | 2860130.84 |
| Take Profit | 2985855.88 |
| Exit Price | 2908659.55 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1162066 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1162066 < 5000000). Consecutive-loss telemetry (1) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 4.0299 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 94

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:23:16.215Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | trend_pullback |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 59.35 |
| Confidence | 91.3 |
| Ranking Score | 59 |
| Risk Score | 68.34 |
| Position Size | 599.95 |
| Entry Price | 2895.08 |
| Stop Loss | 2859.13 |
| Take Profit | 2978.65 |
| Exit Price | 2971.33 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.634 |
| PnL USDT | 15.8027 |
| Trade Duration | 372s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed trend_pullback in trending regime with confidence 91.3% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 95

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:24:46.218Z |
| Market | SPOT_USDT |
| Symbol | ETHTRY |
| Strategy | momentum_scalp |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 64.58 |
| Confidence | 90.44 |
| Ranking Score | 49.67 |
| Risk Score | 53.29 |
| Position Size | 507.85 |
| Entry Price | 2002.19 |
| Stop Loss | 1969.62 |
| Take Profit | 2044.63 |
| Exit Price | 2002.19 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (49.67 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (49.67 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 6.3227 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 96

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:26:16.220Z |
| Market | SPOT_USDT |
| Symbol | LINKTRY |
| Strategy | mean_reversion |
| Market Regime | volatile |
| Signal | BUY |
| Signal Score | 47.17 |
| Confidence | 75.03 |
| Ranking Score | 78.62 |
| Risk Score | 60.44 |
| Position Size | 187.61 |
| Entry Price | 2450.79 |
| Stop Loss | 2431.62 |
| Take Profit | 2482.64 |
| Exit Price | 2450.79 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | AI consensus NO_TRADE |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Risk per trade exceeds threshold |
| Liquidity Result | PASS |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: AI consensus NO_TRADE. Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** AI consensus disagreement

**Lessons Learned:** Rejection prevented low-quality entry; gate behavior consistent with policy.

---

## Trade 97

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:27:46.223Z |
| Market | SPOT_TRY |
| Symbol | DOGETRY |
| Strategy | breakout_follow |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 84.95 |
| Confidence | 93.58 |
| Ranking Score | 45.14 |
| Risk Score | 46.45 |
| Position Size | 675.95 |
| Entry Price | 2940.49 |
| Stop Loss | 2903.04 |
| Take Profit | 2995.19 |
| Exit Price | 2940.49 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Ranking below threshold (45.14 < 55) |
| Confidence Threshold | 45 |
| Ranking Result | FAIL |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | BUY |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Ranking below threshold (45.14 < 55). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 3.1364 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Ranking score gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 98

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:29:16.225Z |
| Market | SPOT_USDT |
| Symbol | SOLTRY |
| Strategy | mean_reversion |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 83.28 |
| Confidence | 92.76 |
| Ranking Score | 69.5 |
| Risk Score | 53.99 |
| Position Size | 608.12 |
| Entry Price | 1268.77 |
| Stop Loss | 1257.96 |
| Take Profit | 1302.57 |
| Exit Price | 1268.77 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (624245 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (624245 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 2.5723 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

## Trade 99

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:30:46.227Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | mean_reversion |
| Market Regime | trending |
| Signal | BUY |
| Signal Score | 91.82 |
| Confidence | 81.2 |
| Ranking Score | 86.16 |
| Risk Score | 68.68 |
| Position Size | 362.58 |
| Entry Price | 3318.86 |
| Stop Loss | 3261.1 |
| Take Profit | 3409.77 |
| Exit Price | 3405 |
| Exit Reason | TAKE_PROFIT |
| PnL % | 2.595 |
| PnL USDT | 9.409 |
| Trade Duration | 852s |
| Accepted / Rejected | Accepted |

**Engineering Analysis:** Executed mean_reversion in trending regime with confidence 81.2% vs threshold 45%.

**Estimated Missed Profit:** 0 USDT

**Would acceptance have been profitable?** No

**Root Cause:** Signal quality aligned with regime

**Lessons Learned:** Maintain current gate ordering; pattern validated under simulated regime.

---

## Trade 100

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-01T23:32:16.231Z |
| Market | SPOT_USDT |
| Symbol | XRPTRY |
| Strategy | momentum_scalp |
| Market Regime | low_liquidity |
| Signal | BUY |
| Signal Score | 77.23 |
| Confidence | 78.68 |
| Ranking Score | 59.99 |
| Risk Score | 79.44 |
| Position Size | 958.28 |
| Entry Price | 3585.36 |
| Stop Loss | 3540.7 |
| Take Profit | 3614.78 |
| Exit Price | 3585.36 |
| Exit Reason | N/A |
| PnL % | 0 |
| PnL USDT | 0 |
| Trade Duration | 0s |
| Accepted / Rejected | Rejected |
| Rejection Reason | Liquidity below threshold (1482934 < 5000000) |
| Confidence Threshold | 45 |
| Ranking Result | PASS |
| Risk Rule | Spread above threshold |
| Liquidity Result | FAIL |
| AI Consensus Result | NO_TRADE |
| Exchange Restriction | NONE |

**Engineering Analysis:** Rejected due to: Liquidity below threshold (1482934 < 5000000). Consecutive-loss telemetry (0) did not block (policy: consecutiveLossBlocksEntry=false).

**Estimated Missed Profit:** 10.9627 USDT

**Would acceptance have been profitable?** Yes

**Root Cause:** Liquidity gate

**Lessons Learned:** Potential false negative — validate gate threshold against missed profit estimate.

---

### Batch Summary — Trades 91–100

- Completed Trades: 100
- Accepted: 15
- Rejected: 85
- Batch Win Rate: 100%
- Profit Factor: 13.907
- Expectancy: 8.3791
- Sharpe Ratio: 0.998
- Average Confidence: 72.52
- Average Holding Time: 1753s
- Average Risk Score: 49.38
- Top Rejection Reason: AI consensus NO_TRADE
- Most Successful Pattern: trend_pullback in trending
- Most Common Failure Pattern: Risk per trade exceeds threshold
- Recommended Engineering Adjustments: Review confidence cap and ranking threshold for false negatives.

---

## Final Simulation Report — Trade 100 Complete

### Overall Statistics
- Completed Trades: 100
- Accepted: 15 | Rejected: 85
- Win Rate: 66.67%
- Profit Factor: 13.907
- Expectancy: 8.3791 USDT
- Sharpe Ratio: 0.998
- Total PnL: 125.6866 USDT
- Acceptance Rate: 15%
- Cumulative Missed Profit (rejected): 231.3646 USDT

### Best Strategies
1. trend_pullback — 7 trades, 54.659 USDT
2. momentum_scalp — 5 trades, 45.2732 USDT
3. mean_reversion — 2 trades, 27.8495 USDT

### Worst Strategies
1. breakout_follow — 1 trades, -2.0951 USDT
2. mean_reversion — 2 trades, 27.8495 USDT
3. momentum_scalp — 5 trades, 45.2732 USDT

### False Positives
- Count: 5
- Primary pattern: accepted trades with negative PnL (TIMEOUT)

### False Negatives
- Count: 54
- Estimated missed profit: 231.3646 USDT

### Risk Engine Analysis
- Policy: consecutiveLossBlocksEntry=false
- Top risk rejections: Liquidity below threshold (256320 < 5000000); Liquidity below threshold (374582 < 5000000)

### Confidence Threshold Analysis
- Effective bounded threshold: 45
- Average candidate confidence: 72.52

### Ranking Analysis
- Ranking threshold used: 55
- Rejections citing ranking: 26

### Liquidity Analysis
- Liquidity rejections: 21

### AI Consensus Analysis
- NO_TRADE rejections: 48

### Engineering Recommendations
1. Keep consecutive-loss telemetry-only policy; simulation shows no streak hard-blocks.
2. Tune ranking threshold if false-negative missed profit exceeds acceptable bounds.
3. Continue bounding stale DB confidence via boundMinConfidenceThreshold.

### Business Recommendations
1. Prioritize strategies with positive simulated expectancy in trending regimes.
2. Reduce exposure during low_liquidity regime signals.
3. Use /api/risk/evaluate dry-run before promoting strategy config changes.

---

