# KRIPTO P0 — FINAL HANG SNAPSHOT EXPORT + ABNORMAL TERMINAL FORENSIC FIX

## Scope
- Native KRIPTO repository üzerinde yapıldı.
- Trading davranışı, eşikler, strateji/TDI/AI/risk/sizing/fees değiştirilmedi.
- Amaç: `round-hang-snapshot.json` üretimini terminal sınıfına göre deterministik hale getirmek.

## 1) Previous Export Gap
- Son 2-round validation (`cmt3epoap0009un5od3he1qce`) sonrasında:
  - Round-1 (`Tur secim suresi doldu (1200s)`) için hang snapshot yoktu.
  - Round-2 (`AI_GATE_BLOCK: AI_VETO`) için hang snapshot yoktu.
- Problem: snapshot tetikleyicisi terminal sınıfına göre merkezi/konsolide değildi.

## 2) Abnormal Terminal Classification
Yeni canonical sınıflandırma eklendi:
- Dosya: `src/server/forensics/round-terminal-classification.service.ts`
- Sınıflar:
  - `NORMAL_TERMINAL`
  - `ABNORMAL_RUNTIME_TERMINAL`

`ABNORMAL_RUNTIME_TERMINAL` örnekleri:
- `SELECTION_BUDGET_EXCEEDED`
- `BUDGET_EXPIRED`
- `ROUND_STALLED`
- `JOB_TIMEOUT`
- `ROUND_NOT_TERMINAL`
- `PERSIST_TIMEOUT`
- `DEPENDENCY_RETRY_BUDGET_EXHAUSTED`
- `AI_TIMEOUT_STALL`
- `CANCELLATION_RUNTIME`
- `SCHEDULER_RUNTIME_FAILURE`
- `WATCHDOG_TERMINATION`

`NORMAL_TERMINAL` örnekleri:
- `AI_GATE_BLOCK: AI_VETO`
- `TDI_WAIT`, `TDI_REJECT`
- `RISK_REJECT`
- `SIM_TIGHT_FILTER`
- `NO_CANDIDATE(S)`

## 3) Canonical Snapshot Trigger
Tek giriş noktası:
- `ensureRoundHangSnapshotForAbnormalTerminal(...)`
- Dosya: `src/server/forensics/round-progress-watchdog.service.ts`

Wiring:
- `src/server/execution/round-selection.service.ts`  
  Budget/stall watchdog terminalizasyon yolunda çağrılır.
- `src/server/execution/auto-round-engine.service.ts`  
  `failRound(...)` içinde çağrılır (abnormal terminal path’lerin merkezi).
- `src/server/forensics/ai-runtime.service.ts`  
  Minimum AI stall artifact akışında aynı trigger kullanılır.

Idempotency:
- `roundId + reasonCode/reason` bazlı tek canonical snapshot.
- Aynı abnormal reason için duplicate write engellenir.

## 4) Snapshot Schema
`round-hang-snapshot.json` artık `hang-snapshot-v1` şemasında şu alanları taşır:
- Kimlik/terminal: `roundId`, `runId`, `jobId`, `sessionId`, `terminalReason`, `terminalReasonCode`, `terminalClass`, `currentStage`
- Zaman/bütçe: `startedAt`, `snapshotAt`, `endedAt`, `selectionBudgetMs`, `selectionElapsedMs`, `remainingBudgetMs`
- Liveness: `lastMeaningfulProgressAt`, `meaningfulProgressAgeMs`, `lastHeartbeatAt`, `heartbeatAgeMs`
- Stage progress: `lastScannerProgressAt`, `lastMarketDataProgressAt`, `lastPumpProgressAt`, `lastAIProgressAt`, `lastTDIProgressAt`, `lastPersistAt`
- Workload: `activeCandidates`, `activeAI`, `activeScannerWork`, `activePumpWork`, `activeDBWork`, `poolActive`, `poolQueued`, `retryCount`, `activeRetries`
- Recovery/watchdog: `watchdogState`, `watchdogDecision`, `recoveryState`
- Abort/terminalization: `abortRequested`, `abortReason`, `terminalizationStartedAt`, `terminalizationDurationMs`
- Failure counters/refs: `dbTransientFailures`, `marketDataFailures`, `fallbackCount`, `selectionTimeBudgetBreakdownRef`, `roundLivenessRef`, `recoveryTelemetryRef`

Not:
- Deep/cyclic runtime/watchdog object’leri ham şekilde JSON’a basılmıyor; özet alanlar kullanılıyor.

## 5) Round-1 Budget Exceeded Reproduction
Controlled replay ile aynı oturum üzerinde doğrulama:
- Session: `cmt3epoap0009un5od3he1qce`
- Round-1 reason: `Tur secim suresi doldu (1200s)`
- Sınıf: `ABNORMAL_RUNTIME_TERMINAL`
- Önce: `round-hang-snapshot.json` yok
- Trigger sonucu: `WRITTEN`
- Sonra: `round-hang-snapshot.json` var

Önemli:
- Snapshot için watchdog=`STALLED` şartı aranmadı.
- `BUDGET_EXCEEDED`/selection timeout tek başına yeterli abnormal sebep kabul edildi.

## 6) Round-2 AI Veto Semantics
Aynı controlled replay:
- Round-2 reason: `AI_GATE_BLOCK: AI_VETO`
- Sınıf: `NORMAL_TERMINAL`
- Trigger sonucu: `NORMAL_TERMINAL` (attempt yok)
- Snapshot zorunlu sayılmadı; false hang sınıflaması yapılmadı.

## 7) Export Failure Visibility
Hang snapshot export başarısız olursa:
- `export-error.json` yazılır:
  - `artifact`
  - `roundId`
  - `reason`
  - `errorType`
  - `stackDigest`
  - `timestamp`

Sessiz yutma kaldırıldı:
- Hang snapshot akışı business terminal state’i bloklamaz.
- Forensic export failure görünür hale gelir.

## 8) Prisma “Engine Empty Response” Handling
Gözlenen hata:
- `PrismaClientUnknownRequestError: Response from the Engine was empty`
- Önceki validator koşusunda `ai-performance` read path sırasında görüldü.

Bu fixte:
- Critical persistence semantiği gevşetilmedi.
- Forensic read tarafında (`round-forensic-export`) run runtime read hatası `tracker.failed` içine açık reason ile kaydediliyor.
- Hang snapshot export failure ayrıca `export-error.json` ile görünür.

## 9) Tests
Koşulan test komutu:
- `pnpm vitest run tests/forensics/hang-snapshot-contract.test.ts tests/ai-cancellation.test.ts tests/forensics/forensic-export-runner.test.ts`

Sonuç:
- 3 test dosyası, 22 test -> PASS

Yeni contract doğrulamaları:
- Abnormal reason’larda snapshot zorunlu üretim
- Normal business terminal’de snapshot zorunlu olmaması
- Idempotent duplicate handling
- Export failure visibility (`export-error.json`)
- Gerekli alanların şema doğrulaması
- Cyclic payload crash olmadan export
- Export failure’ın non-blocking kalması

## 10) Controlled Validation
Bu görevde uzun canlı 2-round tekrar koşmak yerine deterministic replay + unit contract test uygulandı:
- Round-1 abnormal budget terminal -> snapshot üretildi.
- Round-2 normal AI_VETO terminal -> snapshot zorunlu değil.
- Replay sonrası runtime temizlik:
  - `runningJobs=0`
  - `runningRounds=0`
  - `activeLocks=0`
  - `openAIStarted=0`

## 11) Remaining Blockers
- Bu görev kapsamında post-fix canlı 2-round full runtime campaign yeniden başlatılmadı; deterministic replay + test ile contract kanıtı verildi.

## Final Verdict
- `HANG_SNAPSHOT_CONTRACT = PASS`
- `ABNORMAL_TERMINAL_EXPORT = PASS`
- `NORMAL_TERMINAL_SEMANTICS = PASS`
- `EXPORT_FAILURE_VISIBLE = PASS`
- `PRISMA_FORENSIC_RESILIENCE = PARTIAL`
- `RUNTIME_LIVENESS = PASS`
- `READY_FOR_5_ROUNDS = CONDITIONAL`
- `READY_FOR_50_ROUNDS = CONDITIONAL`
