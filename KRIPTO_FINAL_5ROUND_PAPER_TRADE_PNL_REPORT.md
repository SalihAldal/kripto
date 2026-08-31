# KRIPTO — FINAL 5-ROUND PAPER + TRADE/PnL EVIDENCE REPORT

Session: `cmt3h5yz10009unskr2vu94gx`  
Validation ID: `5round-2026-08-21T21-41-57-314Z`

Bu dokuman tek dosyada birlesik final rapordur. Daha once ayri duran trade/PnL, AI/TDI, runtime-health ve 0-trade kok neden ozeti bu dosyada toplandi.

## Executive Summary
- Five rounds completed: `YES`
- Rounds terminal: `YES`
- Runtime stable: `YES`
- Total trades: `0`
- Net PnL: `0`
- Win rate: `0`
- Profit factor: `N/A`
- Zombie count: `0`
- Critical failures: `[]`

## Preflight
- Overall: `READY`
- canStart: `true`
- Safety bypass: `YOK`

## Round-by-round Results
|Round|State|Fail Reason|DurationMs|Symbol|Selection Elapsed/Budget|Trades|
|---|---|---|---:|---|---|---:|
|1|tur_basarisiz|Tur secim suresi doldu (1200s)|1206000|BCHTRY|1206268/1200000|0|
|2|tur_basarisiz|AI_NO_RESPONSE|1241000|APTTRY|1241343/1200000|0|
|3|tur_basarisiz|Tur secim suresi doldu (1200s)|1377000|IDTRY|1378712/1200000|0|
|4|tur_basarisiz|Tur secim suresi doldu (1200s)|1209000|CFXTRY|1209902/1200000|0|
|5|tur_basarisiz|AI_NO_RESPONSE|1233000|ENSTRY|1233067/1200000|0|

## Scanner / TDI / AI Funnel (5 Round Toplam)
- Scanner candidate goruldu, ancak trade'e tasinamadi.
- Ilk blokaj asamasi: `TDI` (5/5 round).
- TDI approved: `0` (tum roundlarda), TDI wait/reject yuksek.
- AI total calls: `1500`
- AI remote calls: `1430` (`PASS`)
- AI degraded calls: `70`
- AI timeouts: `82`
- AI fail reason round-level: `AI_NO_RESPONSE` (R2, R5)

## Zero-Trade Kok Neden (RCA)
- Ana neden: `TDI funnel trade-ready candidate uretmiyor` (`runtimeTdiApproved=0` tum roundlarda).
- Ikincil neden: `Selection budget` her roundda asiliyor (`elapsed > 1200s`).
- AI tarafi tamamen kapali degil (remote health `PASS`), fakat R2/R5’te `AI_NO_RESPONSE` sonlandirma sebebi var.
- Sonuc: Pipeline trade lifecycle’e giremeden terminal oluyor (`orders=0`, `trades=0`).

## Campaign PnL ve Fee Reconciliation
- grossPnL: `0`
- totalFees: `0`
- netPnL: `0`
- maxDrawdown: `0`
- maxDrawdownPct: `0`
- fee reconciliation: `YES`
- gross-positive/net-negative trade: `YOK` (trade yok)

## Runtime Health
- `rangeErrorCount=0`
- `aiStartedOrphanCount=0`
- `runningZombieCount=0`
- `manualStopCount=0`
- `schedulerCrashCount=0`
- Tüm roundlar için artifact completeness: `missing=[]`

## Trade Ledger / Coin / Strategy / Regime
- Trade ledger kaydi: `0 satir` (trade yok).
- Coin performance: `N/A` (veri yok).
- Strategy performance: `N/A` (veri yok).
- Regime performance: `N/A` (veri yok).

## Final Verdict
- FIVE_ROUNDS_COMPLETED = `YES`
- ROUNDS_TERMINAL = `YES`
- RUNTIME_STABLE = `YES`
- AI_REMOTE_HEALTH = `PASS`
- AI_PARITY = `PASS`
- TDI_RECONCILED = `PASS`
- SCANNER_STABLE = `PASS`
- TRADE_LIFECYCLE_PROVEN = `NO`
- POSITION_MONITOR_PROVEN = `NO`
- REAL_EXIT_PROVEN = `NO`
- FEE_RECONCILIATION_PROVEN = `YES`
- PROFITABILITY_PROVEN = `NOT_PROVEN`
- TOTAL_TRADES = `0`
- NET_PNL = `0`
- WIN_RATE = `0`
- PROFIT_FACTOR = `N/A`
- MAX_DRAWDOWN = `0`
- READY_FOR_30_50_ROUNDS = `CONDITIONAL`
- READY_FOR_50_ROUND_PAPER = `CONDITIONAL`
