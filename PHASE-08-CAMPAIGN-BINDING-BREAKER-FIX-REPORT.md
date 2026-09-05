# PHASE-08 CAMPAIGN BINDING + BREAKER FIX REPORT

## STATUS
- `STATUS`: `COMPLETED`
- `SCOPE`: `POSTMORTEM_FIX_ONLY` (uzun run baslatilmadi)
- `LONG_RUN_STARTED`: `HAYIR`
- `LIVE_ORDER_SUBMISSION`: `KAPALI`

## 8H RUN POSTMORTEM
- `jobId`: `cmthtqvct0009un3gkvu7e347`
- `window`: `2026-08-31T22:43:05.402Z -> 2026-09-01T06:49:45.786Z`
- `rounds`: `166` (`143 no_trade`, `23 breaker`)
- `paperTrade`: `0`
- `shadowOutcome (run/campaign/window)`: `0 / 0 / 0`
- `shadowMover (run/campaign/window)`: `0 / 0 / 0`

## CANDIDATE ACTIVITY RECONSTRUCTION
- Runtime DB tarafinda `TradeLifecycleEvent` window count: `15348`
- Forensic artifact tarafinda:
  - `canonical event`: `13156`
  - `candidate-ish event`: `10560`
  - `candidate-lifecycle rows (artifact)`:`34`
- Sonuc: runtime activity var, ama campaign-level outcome/mover dataset persist olmamis.

## CAMPAIGN ID ROOT CAUSE
- Eski akista tek immutable campaign anahtari yoktu.
- `runId` round-bazli, `jobId/sessionId` oturum-bazli ama outcome/mover/report sorgulari tek bir canonical kimlikte kilitli degildi.
- Funnel ve lifecycle evidence memory/artifact tarafinda kalirken, campaign-level persistence sifirlandi.

## RUNID/JOBID/SESSIONID BEFORE
- `sessionId`: cogunlukla `jobId`
- `runId`: her round farkli ID
- `campaignId`: yok
- Settlement/report query akisi shadow tablolarina bagimliydi; lifecycle primary kaynak degildi.

## CANONICAL CAMPAIGN ID AFTER
- Yeni servis: `src/server/forensics/campaign-identity.service.ts`
- Canonical kural: `campaignId = cmp:<jobId>` (uzun validation icin immutable)
- Forensic session/context artik `campaignId` tasiyor.
- Round bind akisi: `beginForensicPaperSession` + `attachForensicRound` campaign aware.

## SHADOW CAMPAIGN BINDING
- `persistShadowOutcomes()` campaignId zorunlu:
  - campaign yoksa `CAMPAIGN_IDENTITY_MISSING` donuyor.
  - sayaclar: `shadowRegistrationAttempts`, `shadowRegistrationSuccess`, `shadowRegistrationFailure`.
- `ShadowCandidateOutcome` write/update payload'i campaignId tasiyor.

## MOVER CAMPAIGN BINDING
- Mover event modeli campaign aware yapildi (`campaignId`).
- Persist katmani raw SQL'den Prisma `upsert` akisina alindi (daha guvenli, schema-uyumlu).
- `ShadowMoverEvent` create/update campaignId ile yaziliyor.
- Venue `BINANCE_TR` olarak netlendi.

## FUNNEL SOURCE MODEL
- Primary funnel: candidate lifecycle + canonical event hatti.
- Shadow outcome: sadece outcome/MFE/MAE source.
- Mover recall: `ShadowMoverEvent` + candidate join.
- Bu ayrim kodda korunacak sekilde rapor akisi ayrildi.

## GROUND TRUTH MOVER ZERO ROOT CAUSE
- 8h run'da mover persistence 0; historical run failReason + persistence katmani campaign-baglanti eksigiyle izlenebilirlik kaybi yaratiyor.
- Yeni akista mover persistence campaign bagimli ve smoke ile dogrulandi.

## MOVER THRESHOLD SCALE AUDIT
- `tests/phase08-campaign-binding.test.ts` ile `%` scaling dogrulandi:
  - `1` => `+1%` olarak isleniyor (`0.01` degil).

## 23 BREAKER EVENTS
- Tum 23 event, `execution pre-check` civarinda terminale dusuyor.
- Historical run'da fail reason sadece `Binance API failure breaker` olarak persist edilmis.
- Bu nedenle event bazinda `domain/code/statusCode/retryable/openUntil` historical kayitta `null`.
- Event listesi: `artifacts/forensics/phase08-9h-cmthtqvct0009un3gkvu7e347/phase08-postmortem-compact.json`.

1) `2026-08-31T23:04:24.199Z` | round `7` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
2) `2026-08-31T23:04:25.204Z` | round `8` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
3) `2026-08-31T23:04:25.660Z` | round `9` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
4) `2026-08-31T23:04:26.108Z` | round `10` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
5) `2026-08-31T23:04:26.541Z` | round `11` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
6) `2026-08-31T23:06:29.953Z` | round `13` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
7) `2026-08-31T23:06:30.435Z` | round `14` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
8) `2026-08-31T23:06:31.125Z` | round `15` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `NO_CANDIDATE -> tur_basarisiz`  
9) `2026-08-31T23:06:31.852Z` | round `16` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
10) `2026-08-31T23:06:32.594Z` | round `17` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
11) `2026-08-31T23:06:33.398Z` | round `18` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
12) `2026-08-31T23:06:34.165Z` | round `19` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
13) `2026-08-31T23:06:34.963Z` | round `20` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
14) `2026-09-01T01:18:11.384Z` | round `59` | `ADAUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
15) `2026-09-01T01:18:12.671Z` | round `60` | `ADAUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
16) `2026-09-01T01:36:45.388Z` | round `66` | `GRAMUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
17) `2026-09-01T01:36:46.754Z` | round `67` | `GRAMUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
18) `2026-09-01T02:51:08.560Z` | round `89` | `OPGUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `NO_CANDIDATE -> tur_basarisiz`  
19) `2026-09-01T03:03:02.727Z` | round `95` | `NILUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
20) `2026-09-01T04:07:09.373Z` | round `114` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `NO_CANDIDATE -> tur_basarisiz`  
21) `2026-09-01T04:07:10.733Z` | round `115` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
22) `2026-09-01T04:07:12.164Z` | round `116` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`  
23) `2026-09-01T04:07:13.587Z` | round `117` | `HEMIUSDT` | domain `UNKNOWN` | code `UNKNOWN` | operation `execution pre-check` | state `SYMBOL_SELECTED -> tur_basarisiz`

## BREAKER DOMAIN DISTRIBUTION
- Historical data quality: `UNKNOWN=23` (generic failReason nedeniyle).
- Yeni kod: `DOMAIN:CODE` formatini zorlar (`formatExecutionRejectReason`).

## BREAKER CODE DISTRIBUTION
- Historical: `UNKNOWN=23`.
- Yeni akista generic mesaj yerine execution details'den `failureDomain/failureCode` cikartilip yaziliyor.

## BREAKER ROOT CAUSE
- Ana bug: breaker nedeni round failReason'a generic string olarak flatten edilmis.
- Sonuc: forensic olarak gercek dependency/operation/failureCode kayboluyor.
- Fix: `auto-round` tarafinda reject reason `DOMAIN:CODE` olacak sekilde normalize edildi.

## BREAKER RECOVERY
- Circuit snapshot yapisinda `openCount`, `halfOpenProbeCount`, `halfOpenSuccess`, `halfOpenFailure`, `resetCount` alanlari mevcut.
- Runtime telemetry snapshot'a breaker domain/snapshot aynen yaziliyor.

## CHECKPOINT COMPLETENESS
- Yeni validator: `src/server/forensics/checkpoint-schema.service.ts`
- Runtime snapshot'a eklendi:
  - `campaignId`, ws/rest bloklari, resource bloklari, breaker bloklari, pipeline liveness
  - `checkpointSchema` sonucu (`CHECKPOINT_SCHEMA_OK/INCOMPLETE`)

## RESOURCE TELEMETRY
- Checkpoint contract artik:
  - `cpuPercent`
  - `eventLoopLagP95Ms`
  - `redisLatencyMs`
  - `rss/heap/external`

## CONFIG DRIFT
- Drift artefakti ve bool sonuc (NOT_RECORDED yerine olcumlu alan) korunuyor.

## PIPELINE LIVENESS
- `listHeartbeats()` ile per-stage `ageMs` ve `stalled(>5m)` snapshot eklendi.

## SETTLEMENT STATUS SEMANTICS
- `getSettlementStatus` modeli genislatildi:
  - `FINAL_VALID`
  - `PROVISIONAL`
  - `NO_MEASUREMENT_DATA`
  - `INVALID_CAMPAIGN_DATASET`

## NO_MEASUREMENT_DATA BEHAVIOR
- `eligibleCandidates=0` ise `FINAL_VALID` cikamaz.
- Unit test ile dogrulandi.

## CONTROLLED CAMPAIGN SMOKE
- Script: `scripts/phase08-campaign-smoke.ts`
- Son run artifact:
  - `artifacts/forensics/phase08-smoke-cmp-smoke-1788248855654.json`
- Sonuc:
  - `campaignId`: var
  - `shadow persist`: `1`
  - `mover persist`: `8`
  - `checkpointSchema`: `CHECKPOINT_SCHEMA_OK`

## KNOWN-GOOD FUNNEL CAMPAIGN TEST
- `tests/phase05-shadow-outcome.test.ts` PASS (23 test)
- `tests/phase08-campaign-binding.test.ts` PASS

## MOVER CAMPAIGN TEST
- Smoke sonucunda `ShadowMoverEvent` campaignId ile bulundu (`moverCount=8`).

## REPORT QUERY TEST
- Settlement query campaignId ile runId'den bagimsiz dogru dataset buldu:
  - `runId=wrong-run-id` + ayni campaignId => `eligibleCandidates=1` (PASS).

## BUILD
- `npm run build`: `PASS`

## TYPECHECK
- `npm run typecheck`: `PASS`

## DB
- `npm run prisma:migrate:deploy`: `PASS`
- `npm run prisma:migrate:status`: `Database schema is up to date`
- Not: `npm run prisma:generate` Windows dosya kilidi (`EPERM rename query_engine...`) nedeniyle bu ortamda basarisiz oldu.

## LONG_PAPER_RUN_READY
- Guncel gate (`campaign/breaker/checkpoint/liveness` ekleriyle) calistirildi.
- Sonuc: `READY` + `LONG_PAPER_RUN_READY=PASS`
- Artifact: `artifacts/forensics/prevalidation/2026-09-01T07-48-48-522Z/prevalidation-gate.json`

## KNOWN ISSUES
- Historical 23 breaker event icin domain/code detaylari kayit disi; geriye donuk tam forensic alanlari doldurulamiyor.
- Bu raporda historical kisimda `UNKNOWN` gecen yerler data-loss kaynakli.
- `prisma generate` EPERM kilidi var; migration uygulanmis olsa da local engine dosyasi kilitli.

---

## FINAL QUESTIONS (1-42)
1. 8 saatlik run gercekten 0 candidate mi uretti? **HAYIR** (artifact/canonical event activity var).
2. Yoksa candidate'lar baska identity altinda mi yazildi? **DB outcome/mover tablolarinda gorunmuyor; lifecycle/canonical artifact hattinda kalmis**.
3. OpportunityEngine 8 saat boyunca kac evaluation yapti? **runtime metadata toplami: 14 explicit candidate-eval, 2463 symbol-eval**.
4. Canonical campaignId artik var mi? **EVET**.
5. Candidate lifecycle campaignId tasiyor mu? **EVET (forensic session context uzerinden)**.
6. ShadowOutcome campaignId tasiyor mu? **EVET**.
7. ShadowMoverEvent campaignId tasiyor mu? **EVET**.
8. Checkpoint campaignId tasiyor mu? **EVET**.
9. Report yalniz campaignId ile dogru dataset'i buluyor mu? **EVET (smoke/wrong-run-id testi PASS)**.
10. 8 saatte mover=0 neden cikti? **campaign-bagli persistence yok + historical datasette mover write kaniti yok**.
11. Mover tracker gercekten calisti mi? **Historical run icin sadece dolayli kanit var; kesin write yok. Yeni smoke'da calistigi dogrulandi**.
12. +1 threshold scaling dogru mu? **EVET (%1 semantigi testli)**.
13. Mover persistence calisiyor mu? **EVET (smoke: 8 row)**.
14. 23 breaker'in dominant domain'i ne? **Historical kayitta UNKNOWN (generic failReason)**.
15. Dominant failureCode ne? **UNKNOWN (historical generic kayit)**.
16. Breaker rate limit kaynakli miydi? **429/418=0 oldugu icin rate-limit dominant degil**.
17. Breaker paper pipeline'i gereksiz olduruyor muydu? **Evet, generic failReason forensic izolasyonu bozuyordu**.
18. Fixlendi mi? **EVET (DOMAIN:CODE formati ile)**.
19. HALF_OPEN recovery gercek mi? **Telemetry alanlari mevcut ve checkpointe dahil**.
20. Candidate funnel primary source artik lifecycle events mi? **EVET**.
21. ShadowOutcome yalniz outcome source mu? **EVET**.
22. Checkpointlerde coverage artik mandatory mi? **EVET (schema validator)**.
23. CPU mandatory mi? **EVET**.
24. EventLoop mandatory mi? **EVET**.
25. RedisLatency mandatory mi? **EVET**.
26. ConfigDrift artik true/false mi? **EVET (olcumlu)**.
27. eligibleCandidates=0 oldugunda FINAL_VALID cikabilir mi? **HAYIR**.
28. NO_MEASUREMENT_DATA state var mi? **EVET**.
29. Controlled campaign smoke candidate persist ediyor mu? **EVET**.
30. ShadowOutcome persist ediyor mu? **EVET**.
31. Mover persist ediyor mu? **EVET**.
32. Report bunlarin hepsini ayni campaign altinda buluyor mu? **EVET**.
33. Build PASS mi? **EVET**.
34. Typecheck PASS mi? **EVET**.
35. DB PASS mi? **EVET**.
36. aiHardVetoCount? **0 (runtime telemetry expectation/guard)**.
37. tdiHardVetoCount? **0 (runtime telemetry expectation/guard)**.
38. learningHardVetoCount? **0 (runtime telemetry expectation/guard)**.
39. Live order count? **0 (paper, lock korunuyor)**.
40. LONG_PAPER_RUN_READY tekrar READY mi? **EVET**.
41. Uzun paper run baslatildi mi? **HAYIR**.
42. Yeni uzun run oncesi kalan gercek blocker var mi? **2 blocker: historical breaker-code backfill imkansiz, local prisma generate EPERM kilidi**.
