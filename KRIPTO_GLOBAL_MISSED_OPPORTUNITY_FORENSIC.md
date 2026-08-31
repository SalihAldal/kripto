# KRIPTO — GLOBAL MISSED-OPPORTUNITY FORENSIC

> Generated: 2026-08-23T12:16:13.854Z
> Research only — no policy/runtime changes

## PART 1–2 — Runtime Windows

- **Primary job**: cmt4zxkbm001gun8ghz4qsb0w
- **Timezone**: Europe/Istanbul (exchange-info); artifacts UTC
- **Merged windows**: 2
- **Total runtime**: 127 minutes

- **W1**: 2026-08-23 02:15:16 Istanbul → 2026-08-23 03:07:11 Istanbul (rounds 1,2,3,4,5)
- **W2**: 2026-08-23 03:07:18 Istanbul → 2026-08-23 04:22:17 Istanbul (rounds 6,7,8,9,10,11)

## PART 4–6 — Binance TR Market Data

- **Interval**: 1m klines via api.binance.me / www.binance.tr
- **Valid TRY pairs**: 307
- **Top gainers analyzed**: 50

### Global top 10 by max intrawindow gain

| Rank | Symbol | Best max gain % | Best close-to-close % |
|------|--------|-----------------|----------------------|
| 1 | ICPTRY | 13.64 | 0.63 |
| 2 | GASTRY | 13.20 | 13.20 |
| 3 | EULTRY | 8.97 | 4.57 |
| 4 | STRAXTRY | 8.20 | 2.28 |
| 5 | FFTRY | 7.42 | 4.51 |
| 6 | PORTALTRY | 7.15 | 3.56 |
| 7 | EGLDTRY | 6.34 | 4.63 |
| 8 | RAYTRY | 5.83 | 4.43 |
| 9 | AMPTRY | 5.47 | 0.50 |
| 10 | CHIPTRY | 5.05 | 4.60 |

## PART 7–16 — Decision Trace Summary (Top 50)

- **Discovered by engine**: 49
- **Never discovered**: 1
- **Scanner blocked**: 14
- **TDI blocked**: 0
- **AI blocked**: 10
- **EV blocked**: 0
- **Move before discovery**: 12

### Top 10 missed-opportunity ranking

| Rank | Symbol | Max gain % | Classification | First blocker |
|------|--------|------------|----------------|---------------|
| 1 | RAYTRY | 5.83 | B) DISCOVERED_BUT_SCANNER_REJECTED | ai|PRE_AI_SPREAD_REJECT|Candidate rejected before AI due to  |
| 2 | PORTALTRY | 7.15 | L) INSUFFICIENT_EVIDENCE | decision|SCANNER_REJECT|REJECTED |
| 3 | AMPTRY | 5.47 | L) INSUFFICIENT_EVIDENCE | decision|SCANNER_REJECT|REJECTED |
| 4 | THETRY | 4.57 | L) INSUFFICIENT_EVIDENCE | decision|SCANNER_REJECT|REJECTED |
| 5 | ZROTRY | 4.44 | L) INSUFFICIENT_EVIDENCE | decision|SCANNER_REJECT|REJECTED |
| 6 | HYPERTRY | 4.36 | B) DISCOVERED_BUT_SCANNER_REJECTED | scanner|REJECTED|REJECTED |
| 7 | RETRY | 4.12 | B) DISCOVERED_BUT_SCANNER_REJECTED | scanner|REJECTED|REJECTED |
| 8 | DASHTRY | 4.02 | L) INSUFFICIENT_EVIDENCE | decision|SCANNER_REJECT|REJECTED |
| 9 | TRBTRY | 3.05 | E) DISCOVERED_BUT_AI_BLOCKED | ai|AI_DEGRADED|AI_DEGRADED |
| 10 | ROBOTRY | 3.05 | E) DISCOVERED_BUT_AI_BLOCKED | ai|AI_DEGRADED|AI_DEGRADED |

## PART 24 — 10-Round Campaign Correlation

{
  "roundsTerminal": 10,
  "trades": 0,
  "top50InRuntime": 49,
  "top50Seen": 49,
  "top50Blocked": 49,
  "top50ReachedAi": 47,
  "top50ReachedEv": 43,
  "executionReady": 0
}

## FINAL VERDICT

```
RUNTIME_WINDOWS = 2
TOTAL_RUNTIME_MINUTES = 127
TOTAL_RUNTIME_COVERAGE = 2 merged window(s) covering overnight paper job active intervals
TOP_GAINERS_ANALYZED = 50
VALID_BINANCE_TR_PAIRS = 307
TOP_GAINER_COUNT_CAP = 50
TOP_GAINER_MARKET_DATA_INTERVAL = 1m
TOP_GAINER_DISCOVERED = 49
TOP_GAINER_NEVER_DISCOVERED = 1
TOP_GAINER_SCANNER_BLOCKED = 14
TOP_GAINER_TDI_BLOCKED = 0
TOP_GAINER_AI_BLOCKED = 10
TOP_GAINER_EV_BLOCKED = 0
TOP_GAINER_MOVE_BEFORE_DISCOVERY = 12
CLEAR_LATENCY_MISSES = 0
TOP_SYSTEMIC_ROOT_CAUSE = MIXED
TOP_SYSTEMIC_ROOT_CAUSE_SHARE = 0.50
EVIDENCE_CONFIDENCE = MEDIUM
PRODUCTION_CHANGE_RECOMMENDED = NO
NEXT_ENGINEERING_TASK = Scanner discovery coverage + reject reason forensics on top gainers; no threshold changes until outcome labeling validated
```
