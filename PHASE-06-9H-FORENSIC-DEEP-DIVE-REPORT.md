# PHASE-06-9H-FORENSIC-DEEP-DIVE-REPORT

STATUS
COMPLETED_FORENSIC_REGENERATION

RUN INFORMATION
- runId: phase06-9h-20260830-034258
- start: 2026-08-30T00:42:59.109Z
- end: 2026-08-30T09:46:27.609Z
- duration: 9h 3m 28s

DATA SOURCES DISCOVERED
- artifacts: run-meta.json, checkpoints.jsonl (36 rows), worker.log (167 lines)
- database sources with in-window rows: 3
- deep raw: artifacts/live-runs/phase06-9h-20260830-034258/deep-dive-analysis.json

EVIDENCE QUALITY MATRIX
- DISCOVERED / scanner status dağılımı: DIRECT_STRUCTURED_DATA
- lane dağılımı (scanner metadata lane): RECONSTRUCTED_FROM_DATABASE
- decision/execution/paper: DIRECT_STRUCTURED_DATA
- shadow outcome: NOT_RECORDED (table missing)
- ws/fallback: RECONSTRUCTED_FROM_LOGS
- movers/MFE/MAE: NOT_RECORDED (market history + shadow outcome yok)

MARKET COVERAGE
- trackedUniverse (boot): 301
- symbols with MarketSnapshot events in run window: 0
- coverage: 0.00%

WEBSOCKET FORENSICS
- connected events (all log): 91
- connected events (run window): 84
- close events: 0
- reconnect attempts: 0
- reconnect success markers: 0
- classification: close/reason telemetry yok; 84/90 sayısı fiziksel reconnect yerine "connected" log tekrarları

CACHED FALLBACK FORENSICS
- message: TR open symbols failed, using cached data
- count (run window): 61
- call site: src/server/exchange/providers/binance.provider.ts
- error type: This operation was aborted
- effect: cache üzerinden exchangeInfo dönerek runtime devam etmiş; tek başına 0-trade root-cause kanıtı değil

PIPELINE FUNNEL:
DISCOVERED: 14673
EARLY: 0
STEADY: 0
MOMENTUM: 0
CONTINUATION: 0
HOT: NOT_RECORDED
MICRO_ANALYZED: NOT_RECORDED
MICRO_CONFIRMED: NOT_RECORDED
FINAL_RANKED: NOT_RECORDED
EXECUTION_READY: NOT_RECORDED
RISK_ALLOW: 0
RISK_REJECT: 0
PAPER_ATTEMPT: 0
PAPER_OPENED: 0
PAPER_CLOSED: 0

ZERO-TRADE ROOT CAUSE
- scanner candidate akışı var: ScannerResult=14673 (QUALIFIED=0, REJECTED=14673)
- downstream yok: DecisionLog=0, ExecutionLog=0, PaperExecution=0, PaperTrade=0
- root-cause checkpoint: scanner sonrası decision/execution ingress yok

FIRST PIPELINE STAGE WHERE FLOW COLLAPSED
DECISION_LOG_INGRESS (post-scan)

REJECTION HISTOGRAM
- Market data degraded | Data quality issue (KLINE_MISSING) | Directional edge not clear | Score below threshold | Regime LOW_VOLATILITY: momentum zayif, mean reversion disinda riskli: 13722 (93.52%)
- Market data degraded | Low liquidity | Low volume regime | Data quality issue (KLINE_MISSING) | Directional edge not clear | Score below threshold | Regime LOW_VOLUME_DEAD_MARKET: trade disabled: 463 (3.16%)
- Market data degraded | Data quality issue (KLINE_MISSING, CHANGE24H_FALLBACK) | Directional edge not clear | Score below threshold | Regime LOW_VOLATILITY: momentum zayif, mean reversion disinda riskli: 305 (2.08%)
- DATA_NOT_READY | Directional edge not clear | Score below threshold: 170 (1.16%)
- Market data degraded | Low liquidity | Low volume regime | Data quality issue (KLINE_MISSING, CHANGE24H_FALLBACK) | Directional edge not clear | Score below threshold | Regime LOW_VOLUME_DEAD_MARKET: trade disabled: 13 (0.09%)

RECONSTRUCTED_FROM_LOGS / METADATA REJECT CODES
- Market data degraded: 14503 (98.84%)
- Data quality issue (KLINE_MISSING): 14185 (96.67%)
- Low liquidity: 476 (3.24%)
- Low volume regime: 476 (3.24%)
- Data quality issue (KLINE_MISSING, CHANGE24H_FALLBACK): 318 (2.17%)
- DATA_NOT_READY: 170 (1.16%)

STEADY DEEP DIVE
- STEADY candidate NOT_RECORDED/0

EARLY DEEP DIVE
- EARLY candidate NOT_RECORDED/0

MOMENTUM DEEP DIVE
- MOMENTUM candidate NOT_RECORDED/0

CONTINUATION DEEP DIVE
- CONTINUATION candidate NOT_RECORDED/0

ACTUAL MARKET MOVERS
NOT_RECORDED (run-window MarketSnapshot rows = 0)

CANDIDATE VS MOVERS
NOT_RECORDED

MFE / MAE ANALYSIS
NOT_RECORDED (ShadowCandidateOutcome relation missing in DB)

PROFITABLE-BUT-NOT-TRADED
MISSED +1%: NOT_RECORDED
MISSED +2%: NOT_RECORDED
MISSED +3%: NOT_RECORDED
MISSED +5%: NOT_RECORDED
MISSED +10%: NOT_RECORDED

REST / 429 / 418
- checkpoints(last) REST: NOT_RECORDED
- checkpoints(last) 429: NOT_RECORDED
- checkpoints(last) 418: NOT_RECORDED

PIPELINE LATENCY
NOT_RECORDED

RESOURCE / MEMORY
- workerMemory start/mid/end from checkpoints: 5189632 / 200704 / 36864
- RSS/heapUsed/heapTotal direct runtime metrics: NOT_RECORDED

WHAT WAS ACTUALLY MEASURED
- ScannerResult (strong)
- Worker websocket/connect/fallback logs (strong)
- Decision/Execution/Paper tables (all zero in window)

WHAT WAS NOT RECORDED
- ShadowCandidateOutcome (DB relation missing)
- run-window MarketSnapshot history
- micro/final_rank/execution_ready structured counters
- websocket close code + reason
- pipeline latency and heap telemetry

OBSERVABILITY GAPS
- scanner sonrası decision/execution ingress için run-scoped counter yok
- reason-code zinciri (why no trade) structured değil

CONCRETE ROOT CAUSES
- candidates oluşmuş ama decision/execution/paper katmanına hiç akmamış
- bu nedenle trade sayısı 0 kalmış
- fallback olayları mevcut fakat bu kırılmayı tek başına açıklayan direkt kanıt değil
- scanner metadata kanıtı: tradable=false (14673), liveDataHealthy=false (14673), dataQualityOk=false (14673), score-below-threshold mention (14673)
- top marketDataCode: DATA_NOT_READY:170

NEXT FIXES ORDERED BY PRIORITY
1) ScannerResult -> DecisionLog geçiş counter ve reason persist
2) ExecutionReady/RiskAllow/RiskReject run-scoped structured telemetry
3) ShadowCandidateOutcome migration/DB alignment doğrulaması
4) WebSocket close/reconnect reason telemetry
5) MarketSnapshot run-window persistence ve mover analytics backfill

FINAL VERDICT
INSUFFICIENT_SAMPLE

FINAL QUESTIONS
1. 9 saat boyunca gerçekten candidate üretildi mi? EVET
2. Kaç candidate üretildi? 14673
3. STEADY candidate üretildi mi? HAYIR
4. Execution-ready candidate oldu mu? NOT_RECORDED
5. Risk ALLOW oldu mu? HAYIR/0
6. PaperExecutionAdapter hiç çağrıldı mı? HAYIR/0
7. Neden 0 trade açıldı? Scanner sonrası decision/execution ingress 0 olduğu için.
8. 9 saat içinde +1/+2/+3/+5/+10% mover oldu mu? NOT_RECORDED (market history yok)
9. Sistem bunlardan hangilerini yakaladı? NOT_RECORDED
10. Yakalanıp trade edilmeyen kârlı fırsat var mı? NOT_RECORDED
11. 84 event gerçek WebSocket reconnect mi? Hayır, bunlar reconnect kanıtı değil; connected-log sayısı.
12. 61 cached fallback trading pipeline'ı etkiledi mi? Potansiyel etkisi var, ama 0-trade için direkt kanıt yok.
13. Mevcut 9h dataset yeni run öncesi anlamlı edge analizi için yeterli mi? Hayır.
14. Yeni observability kodu gerçekten gerekli mi, yoksa data zaten mevcut mu? Gerekli.
