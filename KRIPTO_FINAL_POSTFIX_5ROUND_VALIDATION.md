# KRIPTO FINAL POSTFIX 5ROUND VALIDATION

- Session: `cmt4wd5rg0009unq0p8hdx3su`
- Validation ID: `5round-2026-08-22T21-35-13-376Z`
- Rounds: 5/5
- Rounds terminal: YES
- TDI approved total: 0
- Execution ready total: 0
- Opened trades: 0
- Closed trades: 0
- AI_STARTED orphan: 0
- GrossPnL: 0.000000
- Fees: 0.000000
- NetPnL: 0.000000
- First blocking stage: SCANNER
- Variant_D live exercised: NO

## Notes
- Preflight `READY` geçti (`canStart=true`), run `PAPER` modunda `BINANCE_TR` ve `AI_GATE_POLICY=VETO` ile başladı; bu aşamada threshold/policy değişikliği yapılmadı.
- Session akışı: `2026-08-22T21:35:22Z` start -> `2026-08-22T22:43:04Z` finalize; toplamda 5 round DB'de terminale indi, job state `STOPPED`.
- Round 1: `candidateCount=274`, `TDI approved=0`, `AI invoked=97`, fail reason `AI_NO_RESPONSE`; execution'e geçiş olmadı (`executionReady=0`, order=0).
- Round 2: `candidateCount=226`, `TDI approved=0`; fail reason `SIM_TIGHT_FILTER_15m` + kalite/consensus zayıflığı; execution aşaması yine 0.
- Round 3: `candidateCount=0` görünüyor ama TDI/AI sayaçları dolu; fail reason yine `SIM_TIGHT_FILTER_15m` ve trend/likidite blokları. Bu, pipeline’da "aday üretim/raporlama tutarlılığı" açısından inceleme gerektiren bir sinyal.
- Round 4: `candidateCount=0`, fail reason `AI_GATE_BLOCK: AI_VETO`; policy bypass yok, gate doğru çalışmış.
- Round 5: `candidateCount=0`, fail reason tekrar `SIM_TIGHT_FILTER_15m`; neticede 5/5 round trade açmadan kapandı.
- AI lifecycle açısından kritik hedef korundu: `AI_STARTED orphan=0`, runtime tarafında `zombieRound=0`, `schedulerCrash=0`, `dbTransientFailure=0`.
- Senin manuel müdahalen dahil not: run uzun sürdüğü için ve "ilk adımı ilerlet, sorunları not et" talebin doğrultusunda kontrollü stop tetiklendi; bu yüzden runtime çıktısında `manualStop=1` ve final job state `STOPPED` görünüyor.
- Bu run’da doğal trade açılmadığı için `Variant_D` canlı exit path’i hiç tetiklenmedi (`Variant_D live exercised=NO`), PnL/fee metrikleri sıfır kaldı.
- Potansiyel sorun adayları (öncelik sırası):
- `SIM_TIGHT_FILTER_15m` filtresi production kuralı olarak çok baskın; TDI/AI'dan önce trade üretimini fiilen boğuyor olabilir.
- `AI_NO_RESPONSE` olayı en az bir round’da terminal nedeni olmuş; provider yanıt sürekliliği / timeout davranışı gözden geçirilmeli.
- `candidateCount=0` iken TDI/AI sayaçlarının dolu görünmesi, forensic sayaçların round snapshot'ına nasıl yazıldığı konusunda veri-tutarlılık kontrolü gerektiriyor.
- `AI_VETO` blokları beklendiği gibi çalışıyor; bypass kanıtı yok (bu iyi), fakat upstream kalite/funnel sıkılığı nedeniyle execution’a hiç sıra gelmiyor.
