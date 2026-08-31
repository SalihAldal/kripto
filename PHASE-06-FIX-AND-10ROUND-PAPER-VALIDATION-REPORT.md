# PHASE-06-FIX-AND-10ROUND-PAPER-VALIDATION-REPORT

## STATUS
- ValidationId: `10round-2026-08-30T11-41-40-671Z`
- SessionId: `cmtfqongi0009unkgls1gr5lc`
- Run Start: `2026-08-30T11:41:48.619Z`
- Run End: `2026-08-30T11:44:25.243Z`
- Duration: `156.62s`
- Job Status: `COMPLETED` (completedRounds=0, failedRounds=10)
- Live Trading Guard: `LIVE_TRADING_ENABLED=false`, `LIVE_TRADING_ACK empty`, execution mode `paper`

## FIXES IMPLEMENTED
- `src/server/scanner/scanner-worker.service.ts`: default snapshot authority canonical patha kaydirildi (`OpportunityEngine + MicrostructureEngine`), legacy branch env flaga baglandi.
- `src/server/scanner/market-context-builder.ts`: health modeli katmanlara ayrildi (`coreMarketDataHealthy`, `rollingHistoryHealthy`, `klineHealthy`, `microDataHealthy`, `optionalEnrichmentHealthy`).
- `src/server/scanner/market-context-builder.ts`: `tradable` hesaplamasindan opsiyonel enrichment/regime hard-veto etkisi ayrildi; sadece core tradeability kriterleri baz alindi.
- `src/server/scanner/market-context-builder.ts`: ring-buffer windowdan 1m kline turetimi eklendi (`deriveKlinesFromWindow`).
- `src/server/market-data/spine/ws-connection.ts` ve `src/server/market-data/spine/market-data-daemon.ts`: WS lifecycle telemetry detaylandirildi (`socketOpen/Close`, reconnect, subscription, plannedRotation, close detaylari).
- `src/server/scanner/signal-persistence.service.ts`: candidate reason-chain metadata alanlari eklendi.
- `src/server/execution/execution-orchestrator.service.ts`: legacy `runScannerPipeline` fallback persistence kapatildi (`persist:false`, `persistRejected:false`).

## ROOT CAUSE OF 14673/14673 REJECT
- Forensic call-chain bulgusu: rejectlerin ana kaynagi canonical `OpportunityEngine` degil, legacy scanner persistence zinciriydi.
- Zincir: `worker bootstrap -> scanner worker / scanner service -> runScannerPipeline -> persistCandidateSignal -> persistScannerResult`.
- 10-round kosuda da `ScannerResult.scannerName=kinetic-shortterm-scanner` goruldu; legacy yol halen yaziyor.

## SCANNERRESULT PRODUCER BEFORE
- `runScannerPipeline()` sonucundaki legacy skor/reject kararlari `ScannerResult` tablosuna kalici yaziliyordu.
- Bu yol `KLINE_MISSING` ve `LOW_VOLATILITY` kombinasyonunda toplu veto uretiyordu.

## CANONICAL OPPORTUNITY PIPELINE AFTER
- Canonical secim zinciri kodda: `MarketDataDaemon -> OpportunityEngine -> MicrostructureEngine -> (ExecutionReady) -> Risk -> Paper adapter`.
- Ancak runtime sonucunda candidate authority tamamen canonicala gecmis degil; legacy scanner persistence halen gozleniyor.

## KLINE_MISSING ROOT CAUSE
- Eksik timeframe: 1m kline beslemesi (ve yeterli rolling candle coverage).
- Beklenen kaynak: realtime WS eventleri + ring buffer aggregate; global discovery icin per-symbol REST polling olmamali.
- Gozlem: preflightta `liveDataHealthy=true` olsa da `klineMissing` yuksek kaldi; run sirasinda reject reason zincirinde `KLINE_MISSING` devam etti.

## MARKET DATA HEALTH BEFORE / AFTER
- Before (9h forensic): `liveDataHealthy=false` ve `dataQualityOk=false` tum adaylarda.
- After (mechanical preflight `artifacts/forensics/phase6-preflight.json`): sample 48/48 icin `liveDataHealthy=true`, `dataQualityOk=true`.
- Buna ragmen 10-round runtime scanner persistence satirlarinda `liveDataHealthy=false` kayitlari devam etti.

## TRADABLE BEFORE / AFTER
- Before: `tradable=false` toplu davranis (14673/14673).
- After code fix: `tradable` core kriterlere baglandi.
- 10-round runtime DB orneginde legacy kayitlarda `tradable=false` devam ediyor; canonical/legacy ayrimi tamamlanmadi.

## PRE-FLIGHT RESULT
- Mechanical preflight (`scripts/_tmp-phase6-preflight.ts`): `PASS`
- Kanitlar:
  - eventsPerSec > 0
  - coveragePct > 0
  - fresh symbols > 0
  - opportunity evaluations > 0
  - liveDataHealthy true count > 0
  - dataQualityOk true count > 0
  - paper adapter wiring PASS
  - live order hard lock PASS

## ROUND 1
- DurationMin: `0.85`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 2
- DurationMin: `0.13`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 3
- DurationMin: `0.07`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 4
- DurationMin: `0.03`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 5
- DurationMin: `0.05`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 6
- DurationMin: `0.03`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 7
- DurationMin: `0.05`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 8
- DurationMin: `0.08`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 9
- DurationMin: `0.58`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## ROUND 10
- DurationMin: `0.38`
- Result: `failed`
- Fail Reason: `Microstructure engine produced no confirmed candidate`
- CandidateCount: `0`, ExecutionReady: `0`, RiskAllow: `0`, PaperOpened: `0`

## TOTAL MARKET COVERAGE
- Preflight sample telemetry: `tracked=48`, `fresh=48`, `stale=0`, `coveragePct=15.95`.
- 10-round artifacts icinde round-bazli `trackedUniverse/fresh/stale/coveragePercent` alanlari standard olarak export edilmedi (pipeline telemetry gap).

## TOTAL PIPELINE FUNNEL
- DISCOVERED: `0`
- HOT: `0`
- MICRO_CONFIRMED: `0`
- FINAL_RANKED: `0`
- EXECUTION_READY: `0`
- RISK_ALLOW: `0`
- PAPER_OPENED: `0`
- PAPER_CLOSED: `0`
- EXECUTION_READY -> PAPER_OPENED: `0/0`
- RISK_ALLOW -> PAPER_OPENED: `0/0`

## EARLY RESULTS
- Candidates: `0`
- ExecutionReady: `0`
- Trades: `0`

## STEADY RESULTS
- Candidates: `0`
- ExecutionReady: `0`
- Trades: `0`
- Kucuk hareketlerin tradee donusumu: `yok (0/0)`

## MOMENTUM RESULTS
- Candidates: `0`
- ExecutionReady: `0`
- Trades: `0`

## CONTINUATION RESULTS
- Candidates: `0`
- ExecutionReady: `0`
- Trades: `0`

## GROUND-TRUTH MOVERS
- Bu 10-round artifact setinde mover tracker cikti tablosu uretilmedi.
- Persist edilen `ShadowCandidateOutcome` kaydi: `0` (session window icinde).

## MOVER DETECTION
- +1/+2/+3/+5/+10/+15/+20 capture metriği: `0` veya `NOT_RECORDED` (session bazli mover dataset yok).

## PROFITABLE OPPORTUNITY -> TRADE CONVERSION
- MFE>=+1%: total `0`, traded `0`, notTraded `0`, conversion `0%`
- MFE>=+2%: total `0`, traded `0`, notTraded `0`, conversion `0%`
- MFE>=+3%: total `0`, traded `0`, notTraded `0`, conversion `0%`
- MFE>=+5%: total `0`, traded `0`, notTraded `0`, conversion `0%`
- MFE>=+10%: total `0`, traded `0`, notTraded `0`, conversion `0%`

## MISSED PROFITABLE OPPORTUNITIES
- `MFE>=+2% && PaperTradeOpened=false` kayit: `0` (session icinde outcome kaydi yok).

## PROFITABLE-BUT-REJECTED HISTOGRAM
- Veri: `NOT_RECORDED` (profitable outcome dataset yok).

## ALL REJECTION HISTOGRAM
- Toplam session ScannerResult: `86` (tamami `REJECTED`)
- `82` (%95.35): `Market data degraded | Data quality issue (KLINE_MISSING) | Directional edge not clear | Score below threshold | Regime LOW_VOLATILITY...`
- `4` (%4.65): ayni reason + `CHANGE24H_FALLBACK`

## ZERO-TRADE REGRESSION
- Sonuc: `PAPER_OPENED=0` tekrarlandi.
- Ilk collapse stage: `DISCOVERED/HOT` asamasi (candidateCount her round 0).
- Duz akista darbogaz: Opportunity->Microstructure arasinda candidate dogmuyor; micro `confirmed=0`, executione hic aday dusmuyor.

## OVERTRADING CHECK
- tradesPerRound: `0`
- candidateToTradeConversion: `0`
- sameSymbolReentries: `0`
- feesAsPercentOfGrossProfit: `0` (trade yok)

## PAPER ECONOMICS
- Starting Equity: `10000` (default paper baseline)
- Ending Equity: `10000`
- Trades: `0`
- Wins: `0`
- Losses: `0`
- WinRate: `0%`
- GrossPnL: `0`
- Fees: `0`
- Spread: `0`
- Slippage: `0`
- NetPnL: `0`
- NetReturn: `0%`
- Expectancy: `INSUFFICIENT_SAMPLE`
- ProfitFactor: `INSUFFICIENT_SAMPLE`
- MaxDrawdown: `0`

## LANE ECONOMICS
- EARLY: Candidates `0`, ExecutionReady `0`, Trades `0`, WinRate `0%`, NetPnL `0`
- STEADY: Candidates `0`, ExecutionReady `0`, Trades `0`, WinRate `0%`, NetPnL `0`
- MOMENTUM: Candidates `0`, ExecutionReady `0`, Trades `0`, WinRate `0%`, NetPnL `0`
- CONTINUATION: Candidates `0`, ExecutionReady `0`, Trades `0`, WinRate `0%`, NetPnL `0`

## SCORE BUCKET PERFORMANCE
- 70-79: `0`
- 80-84: `0`
- 85-89: `0`
- 90-94: `0`
- 95+: `0`

## WEBSOCKET HEALTH
- WS lifecycle counterlari kodda eklendi.
- Preflight snapshot: `socketOpen=2`, `socketClose=0`, `reconnectAttempt=0`, `reconnectSuccess=2`.
- Round artifactlari bu metricleri her tur summary formatinda standart export etmedi.

## REST / 429 / 418
- Preflight snapshot: restCallsPerMin `1`, http429 `0`, http418 `0`.
- 10-round summaryde round-bazli detayli REST class counterlari export edilmedi.

## MEMORY / CPU
- Preflight snapshot: `memoryBytes=1574016`.
- Round-bazli `rssMB/heapUsedMB/heapTotalMB/externalMB/cpu/eventLoopLagMs` alanlari final artifactte eksik.

## PIPELINE LATENCY
- Round runtime heartbeatlerde `dbQueryMs` ve `dbTransactionMs` goruldu; scanner/execution latency funneli candidate yoklugu nedeniyle olcumsuz.

## TESTS
- `npm run prisma:migrate:status`: PASS
- `npm run test:run -- tests/forensics/paper-preflight.test.ts`: 5 PASS / 1 TIMEOUT
- `npx tsc --noEmit`: uzun surede tamamlanmadi (timeout/hang riski)

## KNOWN REMAINING PROBLEMS
- Legacy scanner persistence sessionda halen aktif iz birakiyor (`scannerName=kinetic-shortterm-scanner`).
- `KLINE_MISSING` reject zinciri runtime scanner kayitlarinda devam ediyor.
- Opportunity->Microstructure tarafinda candidate funnel sifirda kaliyor.
- Shadow outcome alignment kodu mevcut olsa da bu run windowda kayıt olusmadi (`shadowCount=0`).
- Round report contractinda istenen market coverage/REST/CPU/memory alanlarinin hepsi yok.

## FINAL VERDICT
- `PIPELINE_FAILURE`

## FINAL QUESTIONS
1. KLINE_MISSING sorunu gerçekten çözüldü mü? -> Hayir, yalnizca kismi yumusatildi; runtime reject chain'de devam ediyor.
2. liveDataHealthy artık true olabiliyor mu? -> Evet, mechanical preflightta true goruldu.
3. dataQualityOk artık true olabiliyor mu? -> Evet, mechanical preflightta true goruldu.
4. OpportunityEngine gerçek production/paper candidate authority mi? -> Kismi; kodda canonical yapildi ama runtime DB kayitlari legacy scanner persistence izini gosteriyor.
5. EARLY candidate oluştu mu? -> Hayir (0).
6. STEADY candidate oluştu mu? -> Hayir (0).
7. MOMENTUM candidate oluştu mu? -> Hayir (0).
8. CONTINUATION candidate oluştu mu? -> Hayir (0).
9. ExecutionReady oluştu mu? -> Hayir (0).
10. Risk ALLOW oluştu mu? -> Hayir (0).
11. Paper trade açıldı mı? -> Hayir.
12. Kaç paper trade açıldı? -> 0.
13. Kaç trade kârlı? -> 0.
14. Fee/spread/slippage sonrası net sonuç ne? -> NetPnL 0 (trade yok).
15. +1/+2/+3/+5/+10 mover'ların kaçı yakalandı? -> 0 / NOT_RECORDED (mover dataset export edilmedi).
16. Yakalanıp işlem açılmayan kârlı fırsat oldu mu? -> Bu run datasinda outcome kaydi yok; kanitlanamadi.
17. STEADY lane küçük hareketleri gerçekten trade'e çevirdi mi? -> Hayir.
18. Pipeline tekrar zero-trade bottleneck'e düştü mü? -> Evet.
19. En büyük mevcut darboğaz ne? -> Opportunity->Microstructure arasinda candidate sifirlanmasi ve legacy scanner KLINE_MISSING reject zinciri.
20. Bir sonraki mantıklı aksiyon ne? -> Legacy scanner persistence authority’sini runtime seviyesinde tamamen devreden cikarip, micro confirm icin canonical lane candidate contractini ve 1m kline/ws aggregate baglantisini zorunlu telemetry ile yeniden dogrulamak; sonra tekrar EXACT 10-round calistirmak.
