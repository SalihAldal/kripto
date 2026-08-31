# PHASE-06 CANONICAL RUNTIME FIX + EXACT 10-ROUND REPORT

## STATUS
- ValidationId: `10round-2026-08-30T13-02-02-071Z`
- SessionId: `cmtftjvr30009un08outoxlv5`
- Sonuc: `completedRounds=10`, `failedRounds=0`
- Round status dagilimi: `COMPLETED_WITH_TRADES=0`, `COMPLETED_NO_TRADE=10`, `FAILED_INFRASTRUCTURE=0`

## ROOT CAUSE
- Asil blocker legacy scanner persistence degil, canonical pathta `Opportunity -> HOT -> Micro confirmed` gecisinde candidate olusmamasi.
- Bu kez failure immediate-loop degil; roundlar observation window tamamlayip `VALID_NO_CANDIDATE` olarak kapandi.
- 15m live diagnosticte Opportunity ve lane classifier aktifti, Micro analyze de calisti; fakat 10-round sirasinda executable candidate acilmadi.

## PREVIOUS RUNTIME PATH
`worker bootstrap -> scanner worker -> legacy scanner -> runScannerPipeline -> ScannerResult`

## FINAL CANONICAL RUNTIME PATH
`MarketDataDaemon -> OpportunityEngine -> Lane Classification -> HOT -> MicrostructureEngine -> FinalRanker -> ExecutionReady -> Risk -> PaperExecutionAdapter`

## LEGACY SCANNER
- invocation count: `0`
- persistence count: `0`
- Runtime DB window (`startedAt..completedAt`) icinde `ScannerResult` satiri: `0`

## PRE-FLIGHT (15m REAL BINANCE WS)
- Duration: `903s`
- Market coverage: `55.15%` (`liveSymbols=166`, `universe=301`)
- Kline health: `klineMissingRate=0`, source `WS_DERIVED=5728`
- Opportunity evaluations: `21476`
- Lane counts: `EARLY=832`, `STEADY=1810`, `MOMENTUM=52`, `CONTINUATION=346`
- Micro input: `microAnalyzed=504`, `microConfirmed=31`
- Result: `PASS`

## KLINE
- Source distribution: `WS_DERIVED=5728`, `WS_KLINE=0`, `BOOTSTRAP_REST=0` (diagnostic penceresinde)
- Missing rate: onceki raporda ~`95.35%` dominant (`KLINE_MISSING`), bu preflightte `0%`
- DB runtime window `KLINE_MISSING` scanner reason count: `0`

## ROUND 1
- Duration: `96s`
- Canonical: `legacyScannerInvocationCount=0`, `OpportunityEvaluations>0` (selection denemeleri var)
- Pipeline: `DISCOVERED=0 HOT=0 MICRO_CONFIRMED=0 EXECUTION_READY=0 RISK_ALLOW=0 PAPER_OPENED=0 PAPER_CLOSED=0`
- Reject: `NO_CANDIDATE -> "Microstructure engine produced no confirmed candidate"`
- Paper: `Trades=0 NetPnL=0`

## ROUND 2
- Duration: `96s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 3
- Duration: `95s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 4
- Duration: `92s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 5
- Duration: `92s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 6
- Duration: `92s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 7
- Duration: `92s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 8
- Duration: `93s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 9
- Duration: `93s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND 10
- Duration: `94s`
- Status: `COMPLETED_NO_TRADE`
- Pipeline terminal: `VALID_NO_CANDIDATE`

## ROUND DURATION ANALYSIS
- Ortalama round suresi: ~`93.5s`
- Onceki "2-3 saniyede fail-loop" davranisi yok.
- Tum roundlar sabit observation penceresi davranisina yakin tamamlandi.

## TOTAL FUNNEL
- marketEvents: preflightte `8394`
- symbolsEvaluated: preflightte `21476`
- DISCOVERED/HOT/MICRO_CONFIRMED/FINAL_RANKED/EXECUTION_READY/RISK_ALLOW/PAPER_OPENED/PAPER_CLOSED: 10-round runtime terminalde `0`
- N/A yok; terminal class net: `VALID_NO_CANDIDATE`

## EARLY
- preflight discovered: `832`
- round pipeline trade conversion: `0`

## STEADY
- preflight discovered: `1810`
- round trade conversion: `0`
- terminal reason: `NO_CANDIDATE (micro confirmed candidate yok)`

## MOMENTUM
- preflight discovered: `52`
- round trade conversion: `0`

## CONTINUATION
- preflight discovered: `346`
- round trade conversion: `0`

## MICRO REJECT HISTOGRAM
- `MICRO_BID_SUPPORT=374`
- `MICRO_LOW_ACTIVITY=306`
- `MICRO_DATA_STALE=297`
- `MICRO_WARMING=200`
- `MICRO_ASK_RELOAD=140`, `MICRO_BID_WITHDRAWAL=123`, `MICRO_ASK_DEPLETION=123`

## RISK REJECT HISTOGRAM
- `0` (risk stageye execution-ready candidate ulasmadi)

## GROUND-TRUTH MOVERS
- Bu 10-round window icinde candidate-trace tabanli mover kaydi uretilemedi.
- Shadow candidate/outcome DB count bu windowda `0` oldugu icin +1/+2/+3/+5/+10 bagimsiz mover korelasyonu cikmadi.

## PROFITABLE OPPORTUNITY CONVERSION
- MFE>=+1/+2/+3/+5 bucketlarinda `total=0`, `paperTraded=0`, `notTraded=0`, `conversion=0%`

## MISSED PROFITABLE OPPORTUNITIES
- `0` (windowda `PaperOpened=false & MFE>=+2` kaydi yok)

## PAPER ECONOMICS
- StartingEquity: degismedi
- EndingEquity: degismedi
- Trades/Wins/Losses: `0/0/0`
- GrossPnL/Fees/SpreadCost/SlippageCost/NetPnL: `0/0/0/0/0`
- Expectancy/ProfitFactor/MaxDrawdown: `0/0/0`

## WEBSOCKET
- wsLightState/wsDeepState: `CONNECTED`
- reconnectCount: `1`
- close olayi: `1008 Too many requests` (tekil), reconnect success var

## REST/429/418
- restCallsPerMin: `0` (hot path)
- `429=0`, `418=0`

## TESTS
- `npm run test:run -- tests/phase03-opportunity-engine.test.ts tests/phase04-microstructure-engine.test.ts tests/phase06-paper-production.test.ts tests/forensics/paper-preflight.test.ts` -> `91/91 PASS`
- `npx tsx scripts/_tmp-canonical-15m-diagnostic.ts` -> `PASS`
- `npx tsx scripts/run-5round-paper-validation.ts` (10-round config) -> `PASS` (`10 completed`, `0 failed`)

## KNOWN ISSUES
- Shadow outcome DB hizalama bu run windowunda hala `0` aday kaydi uretiyor.
- Opportunity->Micro->Execution zincirinde round runtime candidate üretimi halen sifir.
- Tekil WS `1008` kapanisi var; reconnect var ama burst-subscribe davranisi izlenmeli.

## FINAL VERDICT
- **Basarilan:** legacy scanner authority runtimedan cikti (invocation/persist `0`), KLINE_MISSING dominantligi kirildi, preflight/round immediate-fail drifti cozuldu, round semantigi duzeldi.
- **Basarilamayan ana hedef:** canonical candidate’in 10-round runtimeda micro-confirm/execution-ready/paper-open zincirini tetiklemesi. Darbogaz artik net olarak Opportunity->Micro gecisinde.

## FINAL QUESTIONS
1. Legacy kinetic scanner canonical runtime’dan tamamen cıktı mı? **Evet (bu runda).**
2. legacyScannerInvocationCount kac? **0**
3. Canonical OpportunityEngine tek candidate authority mi? **Evet, bu runda execution ingress only canonical path.**
4. KLINE_MISSING oranı kactan kaca dustu? **~%95.35 dominanttan preflightte %0’a.**
5. 1m history gercekten WS/ring-buffer’dan geliyor mu? **Evet (`WS_DERIVED`).**
6. EARLY candidate olustu mu? **Preflightte evet, round-trade zincirinde hayir.**
7. STEADY candidate olustu mu? **Preflightte evet, round-trade zincirinde hayir.**
8. MOMENTUM candidate olustu mu? **Preflightte evet, round-trade zincirinde hayir.**
9. CONTINUATION candidate olustu mu? **Preflightte evet, round-trade zincirinde hayir.**
10. Candidate Microstructure’e ulasti mi? **Preflightte evet (`microAnalyzed=504`).**
11. Micro confirmed candidate oldu mu? **Preflightte evet (`31`), 10-round runtimeda executiona tasinan yok.**
12. ExecutionReady oldu mu? **Hayir (10-round runtime).**
13. Risk ALLOW oldu mu? **Hayir.**
14. Paper trade acildi mi? **Hayir.**
15. Kac trade? **0**
16. Kaci kazandi? **0**
17. Net PnL ne? **0**
18. STEADY kucuk hareketleri trade’e donusturdu mu? **Hayir.**
19. Karlı olup trade edilmeyen candidate var mı? **Bu windowda kanitlanmis yok (shadow/mfe kaydi 0).**
20. Yeni ana darboğaz nedir? **Opportunity->Micro runtime handoff’ta executable candidate’in round akışına taşınamaması (NO_CANDIDATE terminal).**
