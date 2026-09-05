# PHASE-08 — 9H CONTINUOUS PAPER EDGE VALIDATION REPORT

## STATUS
- `STATUS`: COMPLETED_MANUAL_STOP
- `REPORT_STATE`: FINAL_DATASET_WITH_PIPELINE_FAILURE
- `RUN_TYPE`: `9H_CONTINUOUS_PAPER_EDGE_VALIDATION`

## RUN ID
- `jobId`: `cmthtqvct0009un3gkvu7e347`
- `mode`: `PAPER`
- `venue`: `BINANCE_TR`

## CONFIG HASH
- `configHash`: `255f094d15424f14e59fe15154e0d8de631a0feaa46344605044e31ee1ee1075`
- Tek snapshot ile run izlendi; explicit drift artifact bulunmadigi icin drift alani `NOT_RECORDED`.

## TRADING START
- `2026-08-31T22:43:05.402Z`

## TRADING END
- `2026-09-01T06:49:45.786Z`

## TRADING DURATION
- `8h 06m 40s` (manual stop ile 9 saatin altinda kapatildi)

## SETTLEMENT START
- `2026-09-01T06:48:55.214Z`

## SETTLEMENT END
- `2026-09-01T06:48:55.318Z`

## TOTAL WALL-CLOCK DURATION
- Yaklasik `8h 06m 40s`

## CONFIG DRIFT
- `NOT_RECORDED`
- Drift algi raporu bu campaign artifact setinde yok.

## LIVE ORDER GUARD
- `LIVE_ORDER_CALL_COUNT`: `0`
- Paper disinda order call kaniti yok.

## MARKET COVERAGE
- `NOT_RECORDED` (campaign-level coverage percentile artifact yok)

## WEBSOCKET HEALTH
- Run aktifti, scheduler health monitor akisi calisti.
- `WS_1008_COUNT`: `0` (fail reason bazli gözlem)

## 1008
- `0`

## 429 / 418
- `429`: `0` (direct recorded)
- `418`: `0` (direct recorded)

## BREAKER SUMMARY
- `BREAKER_OPEN_RELATED_FAILS`: `23`
- Top fail reason: `Binance API failure breaker`

## RESOURCE HEALTH
- `CPU`: `NOT_RECORDED`
- `EVENT_LOOP`: `NOT_RECORDED`
- `REDIS_LATENCY`: `NOT_RECORDED`

## MEMORY TREND
- `NOT_RECORDED` (checkpointlerde bu alan kampanya seviyesi normalize edilmemis)

## EVENT LOOP
- `NOT_RECORDED`

## REDIS LATENCY
- `NOT_RECORDED`

## AUTHORITY COUNTERS
- `aiHardVetoCount`: `0`
- `tdiHardVetoCount`: `0`
- `learningHardVetoCount`: `0`

## LEGACY COUNTERS
- `legacyScannerInvocationCount`: `0`
- `legacyScannerPersistCount`: `0`
- `legacyExecutionInvocationCount`: `0`

## TOTAL FUNNEL
- Shadow outcome tabanli campaign-window candidate: `0`
- Bu nedenle funnel sayaclari campaign sonucunda `0`.

## FUNNEL CONVERSION
- `DISCOVERED->HOT`: `0/0`
- `HOT->MICRO_CONFIRMED`: `0/0`
- `MICRO_CONFIRMED->EXECUTION_READY`: `0/0`
- `EXECUTION_READY->RISK_ALLOWED`: `0/0`
- `RISK_ALLOWED->PAPER_OPENED`: `0/0`

## EARLY FUNNEL
- `0` (candidate dataset yok)

## STEADY FUNNEL
- `0` (candidate dataset yok)

## MOMENTUM FUNNEL
- `0` (candidate dataset yok)

## CONTINUATION FUNNEL
- `0` (candidate dataset yok)

## GROUND TRUTH MOVERS
- `total movers in window`: `0` (campaign window query sonucu)

## MOVER RECALL
- Tum thresholdler icin `0/0` veya `NOT_RECORDED`

## EARLY RECALL
- `NOT_RECORDED`

## DETECTION LEAD TIME
- `median/p25/p75/p90`: `0 / 0 / 0 / 0` (sample yok)

## MFE>=1 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=2 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=3 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=5 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=7 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=10 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=15 FUNNEL
- `total`: `0`
- `traded`: `0`

## MFE>=20 FUNNEL
- `total`: `0`
- `traded`: `0`

## PROFITABLE OPPORTUNITY → TRADE CONVERSION
- `MFE>=2`: `0/0` (`0%`)
- `MFE>=3`: `0/0` (`0%`)
- `MFE>=5`: `0/0` (`0%`)
- `MFE>=10`: `0/0` (`0%`)

## MISSED PROFITABLE OPPORTUNITIES
- `0` (candidate window dataseti yok)

## PROFITABLE REJECTION HISTOGRAM
- `EMPTY`

## HOT VALUE
- `NOT_RECORDED / INSUFFICIENT_SAMPLE`

## MICRO VALUE
- `NOT_RECORDED / INSUFFICIENT_SAMPLE`

## FINALRANK VALUE
- `NOT_RECORDED / INSUFFICIENT_SAMPLE`

## RISK VALUE
- `NOT_RECORDED / INSUFFICIENT_SAMPLE`

## SCORE CALIBRATION
- `NOT_RECORDED` (window candidate set `0`)

## RANK CALIBRATION
- `NOT_RECORDED` (window candidate set `0`)

## PAPER TRADES
- `total`: `0`
- `closed`: `0`

## BEST TRADES
- Yok (`N=0`)

## WORST TRADES
- Yok (`N=0`)

## PAPER ECONOMICS
- `Trades`: `0`
- `Wins`: `0`
- `Losses`: `0`
- `Breakeven`: `0`
- `WinRate`: `0%`
- `GrossProfit`: `0`
- `GrossLoss`: `0`
- `GrossPnL`: `0`
- `Fees`: `0`
- `SpreadCost`: `0`
- `SlippageCost`: `0`
- `NetPnL`: `0`
- `NetReturn`: `0`
- `AverageWin`: `0`
- `AverageLoss`: `0`
- `Expectancy`: `0`
- `ProfitFactor`: `0`
- `MaxDrawdown`: `0`
- `AverageHoldingTime`: `0`

## LANE ECONOMICS
- `EARLY`: `NOT_RECORDED`
- `STEADY`: `NOT_RECORDED`
- `MOMENTUM`: `NOT_RECORDED`
- `CONTINUATION`: `NOT_RECORDED`

## STEADY ECONOMICS
- `INSUFFICIENT_SAMPLE`

## SMALL MOVE ECONOMICS
- `INSUFFICIENT_SAMPLE`

## BIG MOVER ECONOMICS
- `INSUFFICIENT_SAMPLE`

## PAPER VS SHADOW
- `NOT_RECORDED` (traded candidate yok)

## CAPTURE RATIO
- `NOT_RECORDED` (trade + shadow join yok)

## SYSTEM VS SIMPLE MOMENTUM BASELINE
- `NOT_RECORDED` (trade/candidate outcome dataseti campaign penceresinde yok)

## SYSTEM VS LIQUIDITY-MATCHED RANDOM BASELINE
- `NOT_RECORDED`

## PIPELINE LATENCY P50/P95
- `Detection->PaperOpened`: `0 / 0` (sample yok)

## DEEP STREAM LATENCY
- `NOT_RECORDED`

## ZERO-TRADE CHECK
- `PAPER_OPENED = 0` -> ZERO_TRADE_CONFIRMED
- Round-level sonuc: `143 no_trade`, `23 breaker fail`

## OVERTRADING CHECK
- `NO_OVERTRADING` (trade yok)

## SILENT DROP CHECK
- `silentDropCount = 0` (recorded)

## DUPLICATE EXECUTION CHECK
- Duplicate execution bulgusu yok (`trade yok`)

## SETTLEMENT STATUS
- `status`: `FINAL`
- `eligibleCandidates`: `0`
- `m60Complete`: `0`
- `m60Pending`: `0`
- `invalid`: `0`
- `historyUnavailable`: `0`
- `progressPercent`: `0`

## OUTCOME DATA QUALITY
- Campaign penceresinde shadow outcome candidate seti `0` dondugu icin kalite analizi `NOT_RECORDED`.

## KNOWN ISSUES
- Run manual stop ile 9 saat tamamlanmadan sonlandi.
- Campaign-level shadow outcome/mover dataset window query sonucu `0`.
- Coverage/CPU/event-loop/redis gibi alanlar bu artifact setinde `NOT_RECORDED`.
- Breaker fail (`Binance API failure breaker`) 23 kez goruldu.

## FINAL EDGE VERDICT
- `PIPELINE_FAILURE`
- Gerekce: 8h+ runtime boyunca `paper trade = 0`, profitable-opportunity->trade KPI uretilemedi, edge verdict istatistiksel olarak kanitlanamadi.

---

## FINAL QUESTIONS (1-80)
1. Trading window tam 9 saat surdu mu? **HAYIR** (`8h 06m 40s`)
2. Settlement tamamlandi mi? **EVET (FINAL)**
3. 60m pending kac kaldi? **0**
4. Config drift oldu mu? **NOT_RECORDED**
5. Live order call count kac? **0**
6. Market coverage ortalama/p95 ne? **NOT_RECORDED**
7. WS 1008 kac? **0**
8. 429 kac? **0**
9. 418 kac? **0**
10. Breaker kac kez OPEN oldu? **23 (breaker fail reason bazli)**
11. Silent drop count kac? **0**
12. aiHardVetoCount? **0**
13. tdiHardVetoCount? **0**
14. learningHardVetoCount? **0**
15. Toplam candidate kac? **0 (campaign shadow window)**
16. EARLY kac? **0**
17. STEADY kac? **0**
18. MOMENTUM kac? **0**
19. CONTINUATION kac? **0**
20. HOT kac? **0**
21. MicroConfirmed kac? **0**
22. ExecutionReady kac? **0**
23. RiskAllowed kac? **0**
24. PaperOpened kac? **0**
25. PaperClosed kac? **0**
26. +1 mover kac? **0**
27. +2 mover kac? **0**
28. +3 mover kac? **0**
29. +5 mover kac? **0**
30. +10 mover kac? **0**
31. +15 mover kac? **0**
32. +20 mover kac? **0**
33. +2 mover detection recall? **0/0 (N/A)**
34. +3 mover detection recall? **0/0 (N/A)**
35. +5 mover detection recall? **0/0 (N/A)**
36. +10 mover detection recall? **0/0 (N/A)**
37. MFE>=2 candidate kac? **0**
38. Bunlarin kaci HOT? **0**
39. Kaci MicroConfirmed? **0**
40. Kaci ExecutionReady? **0**
41. Kaci RiskAllowed? **0**
42. Kaci Paper trade oldu? **0**
43. MFE>=2 trade conversion? **0%**
44. MFE>=3 icin ayni conversion? **0%**
45. MFE>=5 icin? **0%**
46. MFE>=10 icin? **0%**
47. STEADY MFE>=2 candidate kac? **0**
48. STEADY paper trade kac? **0**
49. STEADY net PnL? **0**
50. STEADY expectancy? **0**
51. Total paper trades? **0**
52. Wins? **0**
53. Losses? **0**
54. Win rate? **0%**
55. Gross PnL? **0**
56. Fees? **0**
57. Spread cost? **0**
58. Slippage cost? **0**
59. Net PnL? **0**
60. Net return? **0**
61. Expectancy? **0**
62. Profit factor? **0**
63. Max drawdown? **0**
64. En iyi lane hangisi? **NOT_RECORDED**
65. En kotu lane hangisi? **NOT_RECORDED**
66. Small +1–3% movements fee sonrasi deger uretti mi? **INSUFFICIENT_SAMPLE**
67. Buyuk mover capture nasil? **INSUFFICIENT_SAMPLE**
68. System simple momentum baseline'i gecti mi? **NOT_RECORDED**
69. Random baseline'i gecti mi? **NOT_RECORDED**
70. Profitable firsatlarin en fazla kayboldugu stage hangisi? **NOT_RECORDED**
71. HOT gate fazla mi sert? **NOT_RECORDED**
72. Micro fazla mi sert? **NOT_RECORDED**
73. ExecutionReady fazla mi sert? **NOT_RECORDED**
74. Risk fazla mi sert? **NOT_RECORDED**
75. Paper execution bottleneck var mi? **EVET (zero-trade outcome nedeniyle kuvvetli suphe)**
76. Pipeline p95 Detection->PaperOpened latency ne? **0 ms (sample yok)**
77. Zero-trade bottleneck kirildi mi? **HAYIR**
78. Overtrading var mi? **HAYIR**
79. Final edge verdict ne? **PIPELINE_FAILURE**
80. Bir sonraki data-driven aksiyon ne? **Shadow outcome/mover campaign-window baglama ve zero-trade root-cause için yeni controlled 9h run once telemetry completeness gate**

