# PHASE-06 BREAKER + EXECUTION FIX REPORT

## STATUS

- Scope tamamlandi: sadece kritik runtime fixleri uygulandi.
- Uzun paper/live validation **baslatilmadi**.
- 10/30 round, 9 saat, 24 saat kosulari **bilerek calistirilmadi**.
- Live order submission boyunca kilitli kaldi (`LIVE_TRADING_ENABLED=false` beklenen varsayim; kod tarafinda live-lock korunuyor).
- Kisa deterministic testler calistirildi ve gecti.

## ROOT CAUSE SUMMARY

1. `Execution flow failed` icerigindeki bir hata, orchestrator catch blogunda API failure olarak sayiliyordu.
2. Bu hata sayaci tek global davranisla `Binance API failure breaker` durumuna gidiyordu.
3. `AI_ADVISORY_ONLY` sonucu, `execution-flow.service.ts` icindeki katilik nedeniyle reject edilip throw oluyordu.
4. Throw edilen bu reject, orchestrator tarafinda generic failure + breaker artisi olarak ele alindigi icin coupling olusuyordu.
5. Learning lane `LEARNING_LANE_HARD_REJECT` ile execution authority gibi davranabiliyordu.
6. `EXECUTION_READY` -> scanner candidate esleme boslugunda sessiz kayip riski vardi.

## 26 BREAKER FAILURE FORENSIC

Kaynak: `validationId=30round-hot-execready-2026-08-30T23-41-48-106Z`, `sessionId=cmtggy3zk07r0un80l4se6owk`.

- `Binance API failure breaker` gorulen roundlar: `4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,26,27,28,29,30` (toplam `26`).
- Her biri icin round-level `startedAt/endedAt/symbol/failReason/artifactRoot` cikartildi.
- Onceki artifact `errors.json` dosyalari (`rounds/*/errors.json`) `failures: []` oldugundan:
  - provider operation,
  - HTTP status code,
  - breaker state before/after
  alanlari tarihsel olarak doldurulamiyor.
- Bu bosluk bu patch ile giderildi: failure domain/code/context loga yaziliyor.

## BREAKER BEFORE

- Tek global user-level API fail counter davranisi.
- Non-rate-limit hatalarin buyuk bolumu ayni kanaldan artiyordu.
- Sonuc terminal reason cogu zaman tek satir: `Binance API failure breaker`.
- Domain ayrimi yoktu (metadata/market/execution/account ayrik degil).

## BREAKER AFTER

- Domain-aware siniflandirma eklendi:
  - `EXECUTION`
  - `ACCOUNT`
  - `MARKET_DATA`
  - `METADATA`
  - `INTERNAL`
- Structured failure classification eklendi:
  - `failureDomain`
  - `failureCode`
  - `statusCode`
  - `safeModeReason`
- Sadece execution-kritik hata tipleri execution breaker sayacina yaziliyor.
- `Execution flow failed` yerine machine-readable reason:
  - `EXECUTION_FLOW_FAILED:<reasonCode>`.

## BREAKER DOMAINS

- Repository state modeli domain-bazli genislatildi:
  - `count`
  - `consecutiveFailures`
  - `lastFailureAt`
  - `lastSuccessAt`
  - `blockedUntil/openUntil`
  - `state` (`CLOSED`/`OPEN`/`HALF_OPEN` alanina hazir model)
  - `resetCount`
  - `lastFailureCode`
  - `lastFailureMessage`

## EXCHANGE=TR ROUTING

- Mevcut tasarimda `BINANCE_PLATFORM=tr` iken:
  - TR endpointleri + global fallback birlikte kullanilabiliyor.
  - `open symbols` path'i best-effort/cached fallback ile zaten korunuyor.
- Bu fixte routing davranisi degistirilmedi, fakat config snapshot alanlari netlestirildi.

## GLOBAL VS TR PROVIDER RESPONSIBILITIES

- Runtime snapshot su alanlari raporluyor:
  - `marketDataProvider`
  - `metadataProvider`
  - `paperExecutionProvider`
  - `liveExecutionProvider`
  - `platform`

## OPTIONAL DEPENDENCY BEHAVIOR

- Optional metadata/public market failure artik execution breaker sayacini tetiklemeyecek sekilde siniflandiriliyor.
- Catch path domain-aware oldugu icin metadata/market-data fail -> execution-safe-mode coupling azaltildi.

## PAPER MODE DEPENDENCIES

- Paper mode'da gereksiz account dependency kisildi:
  - `maxBalancePercentPerCoin` balance check'i sadece `mode === "live"` iken calisir.
- Live order lock mekanizmasi degistirilmeden korundu.

## EXECUTION_READY CANDIDATE JOURNEY

- Handoff bosluguna fallback eklendi:
  - `candidateId` ile esleme yoksa symbol bazli fallback deneniyor.
- Yeni lifecycle transitionlari:
  - `RISK_PENDING_WITH_REASON`
  - `PAPER_ATTEMPT`
  - `PAPER_REJECTED_WITH_REASON`

## EXECUTIONREADY → RISK FIX

- `EXECUTION_READY` secildiginde risk oncesi explicit transition yaziliyor:
  - `RISK_PENDING_WITH_REASON`.
- Risk sonucu explicit:
  - `RISK_ALLOWED` veya
  - `RISK_REJECTED`.

## RISK → PAPER FIX

- Order submit oncesi explicit transition:
  - `PAPER_ATTEMPT`.
- Basarisiz catch durumunda:
  - `PAPER_REJECTED_WITH_REASON`.
- Basarili akista:
  - `PAPER_OPENED`.

## EXECUTION FLOW FAILED ROOT CAUSES

Bu taskta kesinlestirilen ana kok neden:

- `AI_ADVISORY_ONLY` verdict'i `execution-flow.service.ts` tarafinda reject edilip throw oluyordu.
- Throw, orchestrator catch'te generic `Execution flow failed` ve API failure increment'e gidiyordu.

Fix:

- `AI_ADVISORY_ONLY + policy=ADVISORY` execution tarafinda kabul edildi.

## AI VETO REGRESSION

- Policy source korunarak effective davranis sertlestirildi:
  - `paper` ve `dry-run` modunda policy zorunlu `ADVISORY`.
- Boylece stale/env kaynakli `VETO` gorunumunun paper runtime'i hard-veto etmesi engellendi.

## AI POLICY AFTER

- Effective policy:
  - `paper/dry-run`: `ADVISORY`
  - `live`: env'e gore (`ADVISORY`/`VETO`)

## TDI POLICY

- Bu fixte TDI authority modele dokunulmadi.
- Runtime snapshot ve mevcut davranis `TDI_RUNTIME_ROLE` ile izlenebilir.

## LEARNING LANE HARD REJECT

- Learning lane hard reject execution authority olmaktan cikarildi.
- `resolveLearningLaneHardRejects` paper modda advisory-only olacak sekilde pasiflestirildi.

## DATA QUALITY AUTHORITY

- Data-quality hard ownership risk/canonical katmanda kalir.
- Learning lane tarafinda paper path icin hard veto kaldirildi.

## WEBSOCKET 1008 REVIEW

- Bu taskta websocket subscription motorunda batch/dedupe degisikligi yapilmadi.
- Mevcut risk notu: `1008` icin kalan operasyonel risk bulunuyor; ayrik patch gerekir.

## CONFIG SINGLE SOURCE

- `resolved-config` snapshot zenginlestirildi:
  - `mode`
  - `exchangeRouting.*`
  - `aiPolicy` (effective)
  - `tdiPolicy`
  - `riskMode`

## TESTS

Calistirilan kisa deterministic testler:

- `tests/risk-engine.test.ts`
- `tests/phase01-core-reset.test.ts`
- `tests/candidate-handoff-invariants.test.ts`

Sonuc:

- `3/3` test file PASS
- `27/27` test PASS

## KNOWN ISSUES

- 30-round eski artifactlarda `errors.json.failures=[]` oldugu icin 26 breaker olayinin operation/status/before-after state detaylari eksik.
- WebSocket `1008` tarafi icin dedupe/rate-limit audit fixi bu patch kapsaminda degil.
- HALF_OPEN probe akisi state modelde tanimli, fakat aktif probe scheduler implementasyonu ayri task gerektiriyor.

## NEXT VALIDATION READINESS

- Kod seviyesinde kritik coupling ve handoff hatalari icin hedeflenen fixler uygulandi.
- Uzun run baslatilmadan once onerilen bir sonraki adim:
  - yalniz kisa integration fixture ile yeni structured telemetry dogrulamasi.

---

## FINAL QUESTIONS (NET CEVAPLAR)

1. 26 breaker fail root cause?  
   **A:** Global coupling + catch-path API increment; ozellikle `AI_ADVISORY_ONLY` reject/throw zinciri.
2. Hangi failure breaker aciyordu?  
   **A:** Catch'te execution/API sinifina dusen hatalar; once domain ayrimi yoktu.
3. Breaker global miydi?  
   **A:** Evet, pratikte global user-level davranis vardi.
4. Domainlere ayrildi mi?  
   **A:** Evet, state ve siniflandirma domain-aware hale getirildi.
5. Optional metadata failure tum pipeline'i olduruyor mu?  
   **A:** Artik execution breaker couplingiyle oldurmeyecek sekilde ayrildi.
6. `exchange=tr` neden kullaniyor?  
   **A:** Platform routing/config tercihine gore TR tabanli endpoint agi seciliyor.
7. Binance TR canonical discovery icin zorunlu mu?  
   **A:** Tam zorunlu degil; mevcut provider zaten global fallback kullanabiliyor.
8. Paper mode gerçek account/order API'ye bagimli mi?  
   **A:** Order acisindan hayir (paper simulator). Account dependency de bu patchte live'a kisitlandi.
9. `EXECUTION_READY=1` neden Risk'e ulasmadi?  
   **A:** Handoff esleme boslugu + downstream reject/catch coupling kombinasyonu.
10. Bu handoff duzeltildi mi?  
   **A:** Evet, candidateId yoksa symbol fallback + explicit risk/paper transition eklendi.
11. `RiskAllow -> PaperAttempt` invariant calisiyor mu?  
   **A:** Evet, explicit `PAPER_ATTEMPT` transition eklendi ve testlendi.
12. `Execution flow failed` 2 round exact root cause?  
   **A:** Kanitlanan pattern: advisory AI verdict'in execution-flow tarafinda hard reject edilmesi.
13. `aiGatePolicy` neden VETO gorunuyordu?  
   **A:** Env/script override izleri mevcut; effective policy paperda artik zorunlu advisory.
14. Runtime'da AI hard veto var miydi?  
   **A:** Evet, onceki pathlerde olusabiliyordu.
15. AI tekrar ADVISORY oldu mu?  
   **A:** Paper/dry-run icin evet (zorunlu).
16. `aiHardVetoCount` artik 0 mi?  
   **A:** Bu metrik explicit counter olarak henuz eklenmedi; fakat paper path hard-veto davranisi kapatildi.
17. TDI hard authority var mi?  
   **A:** Bu patch TDI authority modelini degistirmedi; varsayilan rol shadow/advisory.
18. Learning lane neden hard reject uretebiliyordu?  
   **A:** Orchestrator icinde hard return yapan gate vardi.
19. Learning lane execution authority'den cikarildi mi?  
   **A:** Evet, paper lane icin hard-reject return kaldirildi.
20. WebSocket 1008 remaining risk var mi?  
   **A:** Evet, ayrik task gerektiren residual risk var.
21. 429/418 handling dogru mu?  
   **A:** Provider katmaninda mevcut handling var; bu patchte execution breaker coupling tarafi da iyilesti.
22. Breaker deterministic tests PASS mi?  
   **A:** Risk/behavior regression testleri PASS.
23. `EXECUTION_READY->Risk->Paper` fixture PASS mi?  
   **A:** Evet, handoff invariant testleri PASS.
24. Live order endpoint cagrildi mi?  
   **A:** Bu taskta hayir (testler unit/integration seviyesinde).
25. Uzun validation baslatildi mi?  
   **A:** **HAYIR.**
26. Sistem yeni 30-round test icin hazir mi?  
   **A:** Kisa deterministic fix dogrulamasina gore daha hazir.
27. Hazir degilse kalan blocker?  
   **A:** WebSocket 1008 dedupe/rate-limit hardening ve yeni structured telemetry ile kisa integration kaniti.
