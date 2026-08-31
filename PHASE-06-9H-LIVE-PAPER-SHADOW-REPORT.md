# PHASE-06-9H-LIVE-PAPER-SHADOW-REPORT

STATUS
NO_TRADE_OBSERVED

RUN START
2026-08-30T00:42:59.109Z

RUN END
2026-08-30T09:46:27.609Z

ACTUAL DURATION
9h 3m 28s

CONFIG HASH / CONFIG SNAPSHOT
runId=phase06-9h-20260830-034258
EXECUTION_MODE=paper
APP_ROLE=worker
ENABLE_SEPARATE_WORKER=true
MARKET_DATA_ALLOW_SYNTHETIC=false
LIVE_TRADING_ENABLED=false
LIVE_TRADING_ACK=<empty>

MARKET COVERAGE
symbolsCovered(last checkpoint): N/A
trackedUniverseAtBoot: 301 (worker log)

WS HEALTH
ws reconnect events (log connect events): 84
cached-symbol fallback events: 61
fatal crash markers: 0

REST / 429 / 418
RESTRequests(last checkpoint): N/A
429(last checkpoint): N/A
418(last checkpoint): N/A

CANDIDATE FUNNEL
DISCOVERED: N/A (this run collector captured worker-health checkpoints, not per-stage funnel counters)
HOT: N/A
MICRO_CONFIRMED: N/A
EXECUTION_READY: N/A
PAPER_OPENED: 0
PAPER_CLOSED: 0

CANDIDATE -> TRADE CONVERSION
EXECUTION_READY -> PAPER_OPENED: N/A (EXECUTION_READY counter unavailable in run dataset)

PROFITABLE OPPORTUNITY -> TRADE CONVERSION:
MFE +1%: N/A
MFE +2%: N/A
MFE +3%: N/A
MFE +5%: N/A
MFE +10%: N/A
MFE +15%: N/A
MFE +20%: N/A

LANE RESULTS:
EARLY: N/A
STEADY: N/A
MOMENTUM: N/A
CONTINUATION: N/A

STEADY DEEP DIVE
N/A

GROUND-TRUTH MOVERS
N/A

BIG MOVERS CAPTURE
N/A

SMALL/MEDIUM MOVE CAPTURE
N/A

MISSED PROFITABLE OPPORTUNITIES
N/A (shadow dataset count since start: unknown)

REJECTION HISTOGRAM
N/A (no opened trades and no captured per-candidate reject histogram in this run artifact)

PROFITABLE-BUT-REJECTED HISTOGRAM
N/A

PAPER PERFORMANCE
Starting Equity: N/A
Ending Equity: N/A
Gross PnL: 0.000000
Fees: 0.000000
Spread: N/A
Slippage: N/A
Net PnL: 0.000000
Net Return: N/A
Trades: 0
Closed Trades: 0
Open Trades: 0
Wins: 0
Losses: 0
WinRate: N/A
Expectancy: N/A
ProfitFactor: N/A
MaxDrawdown: N/A
AverageHoldingTime: N/A

BEST TRADES
N/A

WORST TRADES
N/A

CAPTURE RATIO
N/A

ZERO-TRADE CHECK
TRIGGERED: yes (openedTrades=0)

OVERTRADING CHECK
NO (trades/hour=0)

RESOURCE HEALTH
checkpointCount: 36
workerAliveAtEnd: false (stopped on finalize)
lastCheckpointWorkerMemory: 36864

MEMORY START/MID/END
start: 5189632
mid: 200704
end: 36864

PIPELINE LATENCY
N/A (run collector did not persist per-stage latency metrics)

KNOWN PROBLEMS
- Frequent `TR open symbols failed, using cached data` events (61).
- Run artifact set contains worker/process health checkpoints but not full funnel/outcome tables required for profitability attribution.

FINAL EVIDENCE VERDICT:
INSUFFICIENT_SAMPLE

LIVE ORDER HARD LOCK EVIDENCE:
- Runtime config captured as LIVE_TRADING_ENABLED=false and empty LIVE_TRADING_ACK.
- Worker log keyword scan for live order calls found matches=0 (expected 0).
