# KRIPTO Paper Readiness Completion Findings

## PR-FIXED-01 (HIGH) — FIXED
- Kök neden: `String(undefined ?? …)` → `"undefined"` literal; `if (!exchangeTradeId)` geçiyordu.
- Call path: `fix02-exit-reconciliation` → `buildFillCandidateFromExecution`.
- Düzeltme: `canonical-fill-identity.ts` → `isValidExchangeTradeId`, `resolveExchangeTradeIdFromMetadata`, `resolveCanonicalFillIdentity`.
- Kanıt: `tests/settlement-reconciliation.integration.test.ts` (`boş metadata fill candidate reddedilir`, `canonical settlement kimliği metadata trade kimliği ile uyuşmazsa`).

## PR-FIXED-02 (HIGH) — FIXED
- Kök neden: reconcile FILLED sonrası `continue` canceled order temizliğini atlıyordu.
- Call path: `reconcileFix02ExitBundles`.
- Düzeltme: terminal canceled/rejected/expired cleanup fill döngüsünden sonra; OK update `stateVersion` koşullu.
- Kanıt: `canceled partial fill sonrası rezervasyon temizlenir`, `reconcile OK güncellemesi yeni intent race`.

## PR-FIXED-03 (HIGH) — FIXED
- Kök neden: entry fee `openFee * (fillQty / remainingQty)` toplamı >1 üretiyordu.
- Call path: `post-trade-settlement`, `fix02-exit-reconciliation`, `canonical-settlement-fill`.
- Düzeltme: `entry-fee-allocation.ts` authoritative `entryFeeTotal` / `entryQuantityInitial` / `entryFeeAllocated`.
- Kanıt: `entry fee allocation iki kısmi kapanışta toplam 1 pay üretir`; production chain `entryFeeAllocated≈1`.

## PR-FIXED-04 (HIGH) — FIXED
- Kök neden: post-commit kill rastgele sleep/abort; IPC barrier yoktu.
- Call path: `canonical-settlement-fill` → `postCommitHook`.
- Düzeltme: child `CRASH_BARRIER_FILE` yazıp bekler; parent barrier sonrası SIGKILL; restart idempotent.
- Kanıt: `tests/execution-process-kill.integration.test.ts` ×3 tur PASS.

## PR-FIXED-05 (HIGH) — FIXED
- Kök neden: paper adapter metadata’da trade kimliği eksik; test mock ile örtülüyordu.
- Call path: `paper-exchange-adapter` → `post-trade-settlement`.
- Düzeltme: metadata `tradeId`, `fillId`, `simulationId`, `feeAsset`.
- Kanıt: `paper-readiness-production-chain` paper open `metadata.tradeId` assert.

## PR-FIXED-06 (HIGH) — FIXED
- Kök neden: counterfactual son-tick fill kaldırılmış ama intent→latency→fill modeli yoktu.
- Düzeltme: `counterfactual-exit-execution.ts`.
- Kanıt: `tests/counterfactual-exit-execution.test.ts`.

## PR-FIXED-07 (HIGH) — FIXED (engineering scope)
- Kök neden: tek testte entry→partial→stop kanıtı yoktu.
- Düzeltme: `tests/paper-readiness-production-chain.integration.test.ts` (paper adapter entry + `createPosition` repository path + fix02 exit).
- Sınırlama: tam `execution-orchestrator` admission zinciri bu testte koşulmadı; evaluator/router doğrudan çağrılmadı.

## PR-OPEN-01 (HIGH) — OPEN
- Kök neden: submit timeout + process ölümü + restart + submit count=1 tam e2e yok.
- Mevcut: clientOrderId discovery + reconcile apply PASS; correction test H PASS.
- Durum: `ACK_LOSS_PROCESS_RECOVERY=PARTIAL`.

## PR-OPEN-02 (HIGH) — OPEN
- Kök neden: authoritative paper cash/balance/exposure tek entegre testte doğrulanmadı.
- Mevcut: entry fee, PnL, reservation, fill/order assert’leri production chain testinde kısmi.
- Durum: `RESERVATION_AND_BALANCE=PARTIAL`.
