# KRIPTO ER03 - CANONICAL POLICY & SELECTION CONCURRENCY REPORT

## Executive Verdict

- `PHASE3_VERDICT=PARTIAL`
- `OVERALL_ENGINEERING_READINESS=PARTIAL`
- `NEXT_PAPER_PREFLIGHT=NO_GO`
- `PROFITABILITY_EVIDENCE=NOT_EVALUATED`

## İncelenen Sürüm ve Çalışma Kopyası

- HEAD: `a85a04677acc8dba27af3362f238f86a1d463ea5`
- Branch: `main`
- Worktree: `DIRTY`
- Node/NPM: `v24.13.0` / `11.6.2`
- Disk: `~477.52 GB` boş

## ER01/ER02 Dependency Doğrulaması

- ER01 structured terminal/evidence contract aktif ve regression PASS.
- ER02 feature snapshot adapter aktif; expected move `ai.score` fallback yok.
- Source/time/unit metadata handoff korunuyor (ER02 suite PASS).
- `ER01-K` dış DB bağımlılığı halen açık (`BLOCKED`), Faz 3 dışında bağımsız işler tamamlandı.

## Authority Haritası (Önce/Sonra)

- Candidate selection authority: `runCooperativeRoundSelection()` (`round-selection.service`)  
- Feature/data quality authority: `buildFeatureContractSnapshot()` (`er02-feature-contract.ts`)
- Strategy/regime authority: `evaluateCanonicalRegime()` + `routeStrategies()` (`p4-regime-strategy-shadow.ts`)
- Admission authority (son karar): `canonicalEntryDecision` (`execution-orchestrator.service.ts`)
- Risk authority: `evaluateCanonicalRiskDecision()` + `runPreTradeSafetyValidation()`
- Execution authorization authority: `resolveExecutionAuthorization()` (`er03-canonical-policy.ts`)
- Submit path authority: orchestrator submit branch + exchange/paper adapter çağrıları

Önce:
- `paperRelaxed` ile çoklu gate’ler paper’da bypass olabiliyordu.
- Admission blocker varken paper için `ENTER` üretebilen dal vardı.
- Selection event/fallback tetikleri parallel async check açabiliyordu.

Sonra:
- Admission kriterleri paper/live için aynı policy ile değerlendirilir.
- Canonical verdict blocker-first deterministik hesaplanır.
- Authorization ayrı aşama: admission `ENTER` olsa bile `LIVE_DISABLED/SHADOW_ONLY` submiti keser.
- Selection lifecycle explicit guard ile yarış durumları coalesce edilir.

## Admission / Risk / Authorization Ayrımı

- Admission (`ENTER|WAIT|REJECT`): kalite/strateji/orchestration/adaptive/smart-entry blocker’larına göre belirlenir.
- Risk/Safety: risk gate ve pre-trade safety admission’dan sonra ayrı doğrulanır.
- Authorization: `PAPER_ELIGIBLE | SHADOW_ONLY | LIVE_DISABLED` submitten hemen önce bağımsız uygulanır.
- Outcome: submit/fill/open/failure akışı bu fazda yeniden tasarlanmadı, ER01 contract uyumu korundu.

## Paper Bypass Değişiklikleri

- Kaldırılanlar:
  - paper requestedSymbol fallback ile sentetik aday/AI türetimi
  - market data unhealthy, data quality issue, no-trade, regime, quality, orchestration, adaptive, edge, momentum, smart-entry için paper bypass
  - pre-submit execution guard paper bypass
- Açıklaştırılanlar:
  - Paper/live execution sonucu farklı olabilir; fark authorization ve account/execution katmanında kalır.
  - Admission kararının policy kaynağı mode’dan bağımsızdır.

## Regime Authority ve Legacy Notu

- Admission için strateji/regime değerlendirmesi ER02 contract girdisinden beslenen P4 evaluator üzerinden devam eder.
- Legacy regime consumer’ları tamamen kaldırılmadı; diagnostic tüketim kalıntıları Prompt 4’e devredildi.

## Selection Concurrency State & Cleanup

`round-selection.service` içinde:
- `settled` guard: terminalden sonra yeni sonuç yazımı engellenir.
- `inFlight` + `pendingRecheck`: event/fallback aynı anda gelse tek aktif evaluation çalışır.
- `minimumCheckAt`: event ve fallback yolunda ortak minimum evidence window uygulanır.
- `scheduleCheck`: burst event’lerde starvation olmadan coalesced check planlar.
- async exception: `SELECTION_EXCEPTION:*` olarak explicit aborted sonucu üretir.
- terminal cleanup: timeout/interval/unsubscribe yolları tek noktadan temizlenir.

## Test Kanıtları

- 3x focused suite:
  - `tests/er03-canonical-policy.test.ts`
  - `tests/p1-round-selection-event-driven.test.ts`
  - `tests/entry-decision-engine.test.ts`
  - `tests/p7-paper-only-activation.test.ts`
  - `tests/er02-feature-contract-and-router-input.test.ts`
  - `tests/er01-telemetry-verdict.test.ts`
  - Sonuç: `exit 0`, `76/76 PASS` (üç ardışık tekrar)
- Etki alanı regression:
  - `tests/execution-orchestrator.integration.test.ts` PASS
  - `tests/p4-regime-strategy-shadow.test.ts` PASS
  - `tests/auto-round-engine.integration.test.ts` FAIL/TIMEOUT (DB `localhost:5432` erişim yok)

## Typecheck / Build

- `npm run typecheck` -> `exit 0`
- `npm run build` -> ilk koşu çok uzun finalization nedeniyle sonlandırıldı (`exit unknown`), ikinci koşu `exit 0` (compile+type generation+static pages tamamlandı)

## Açık Blockerlar

- `ER03-F`: auto-round integration test deterministic izolasyonunda dış DB bağımlılığı.
- Prompt 3’te istenen 36 maddelik matrisin tamamı bu iterasyonda kapsanmadı; kritik admission/authorization/concurrency çekirdekleri regression ile kapatıldı, kalan geniş entegrasyon matrisi Prompt 4’e devredildi.

## Prompt 4 Handoff

- decisionId-candidateId-strategyId-regimeId zincirinin persistence/settlement boyunca tekilleştirilmiş doğrulaması tamamlanmalı.
- Auto-round integration için DB bağımlılığını izole eden test harness (fake/test db) kurulmalı.
- Legacy consumer temizliği ve distributed claim/persistence garantisi netleştirilmeli.
- Enter->submit->fill->position lifecycle kimlik sürekliliği ve cross-process tutarlılık doğrulaması yapılmalı.
