# PHASE-07 FIX3 PAPER EXECUTION FINALIZATION REPORT

## STATUS
- PARTIAL DONE (canonical paper execution path hardened, key invariants added, deterministic FIX3 tests added/passing).
- Long paper validation **başlatılmadı**.
- Live order submission lock korunuyor.

## PAPER EXECUTION BEFORE
- Paper execution path iki kola ayrılıyordu: orchestrator direct adapter vs V2 pipeline.
- V2 paper yolunda `candidateId` / `executionIntentId` / `marketDataVenue` adapter’a taşınmıyordu.
- Depth yetersizliğinde simülasyon kalan qty için sentetik fill üretebiliyordu.
- Settlement net PnL hesaplarında exit fill zaten slippage/spread içerdiği halde ekstra slippage maliyeti düşülebiliyordu.

## FINAL CANONICAL EXECUTION FLOW
- Canonical entry akışı:
  - `EXECUTION_READY -> Risk ALLOW -> ExecutionIntent -> executeApprovedSpotOrder -> simulatePaperExecution -> ExecutionPort(PAPER) -> PaperExchangeAdapter -> simulateMarketExecution -> Order/Fill -> Position`.
- V2 paper branch artık identity/venue/timestamp bilgilerini paper adapter’a iletir.

## EXECUTION PORT
- `src/server/paper-runtime/execution-port.ts` canonical hale getirildi:
  - `submitEntry`
  - `submitExit`
  - `cancelOrder`
  - `getOrderState`
  - `reconcile`
- Paper adapter bu portu uygular; live adapter hard-locked.

## PAPER/LIVE LOGIC SHARING
- Upstream strategy/risk/orchestrator paylaşılan kaldı.
- Adapter katmanı ayrıldı (paper/live).

## EXECUTION INTENT
- V2 execute input’una `candidateId`, `executionIntentId`, `lane`, `riskDecisionId`, `executionVenue`, `marketDataVenue`, `decisionAt`, `riskAllowedAt`, `configHash` eklendi.

## IDEMPOTENCY
- `buildIdempotencyKey` candidate tabanlı deterministic key destekliyor:
  - `userId:ENTRY:candidateId:side`
- Intent ID fallback destekli.

## PAPER ORDER STATE MACHINE
- FIX3 kapsamında order durum semantiği netleştirildi.
- `paper-runtime/types.ts` tarafında `CREATED` ve `EXPIRED` state desteği eklendi.

## ORDER BOOK WALK
- `walkOrderBook` artık kalan qty için fake impact fill üretmiyor.
- Eksik likidite gerçek `remainingQty` olarak kalıyor.

## SPREAD
- Fill bid/ask tarafı üzerinden yapılıyor.
- Spread attribution metadata olarak tutuluyor (`spreadCostQuote`).

## SLIPPAGE
- Slippage metrics tutuluyor (`slippagePct`, `slippageBps`).
- Attribution ile accounting ayrımı korunuyor.

## LATENCY
- `simulateMarketExecution` latency modelinden sonra execution-time book kullanıyor.
- Metadata: `decisionAt`, `exchangeSimulatedAt`, `firstFillAt`, `filledAt`.

## PARTIAL FILL
- Likidite yetersizliğinde `PARTIALLY_FILLED` gerçek davranışı aktif.
- Fake “kalanı doldur” davranışı kaldırıldı.

## BINANCE FILTERS
- Simülasyon öncesi filter doğrulaması devam ediyor (`validateSimulationFilters`).
- Reject reason normalizasyonu eklendi:
  - `PAPER_MIN_NOTIONAL`
  - `PAPER_MIN_QTY`
  - `PAPER_MAX_QTY`
  - `PAPER_STEP_SIZE`
  - `PAPER_TICK_SIZE`
  - `PAPER_SYMBOL_NOT_EXECUTABLE`
  - `PAPER_FILTER_REJECT`

## FEES
- Entry/exit fee modeli korunuyor.
- Exit’te mümkünse order metadata fee kullanımı eklendi.

## PAPER PORTFOLIO
- Paper side hala virtual account (`paper.account.*`) üstünden çalışıyor; live account zorunluluğu yok.

## POSITION STATE MACHINE
- Bu iterasyonda position state modeli yeniden yazılmadı; mevcut OPEN/CLOSED + monitor/settlement flow korundu.

## ENTRY ACCOUNTING
- Entry identity + venue metadata adapter katmanına kadar taşınıyor.

## EXIT ENGINE
- Exit authority mevcut canonical `position-monitor -> settleOpenPosition` path’inde.

## EXIT PRIORITY
- Existing exit priority korunuyor (safety/timeout/tp-sl/smart exits).

## STOP
- Stop exit kapanışları paper close simulator üzerinden gidiyor (market-side fill semantics).

## TAKE PROFIT
- TP kapanışları da aynı canonical settlement hattından geçiyor.

## PARTIAL TP
- Mevcut davranış korundu; bu turda yeni strateji/threshold değişikliği yapılmadı.

## TRAILING
- Mevcut trailing logic korundu; FIX3 bu kısımda strateji tuning yapmadı.

## TIME EXIT
- Time exit mevcut monitor akışıyla korunuyor.

## EXIT RACE PROTECTION
- `ensureSingleActiveExitOrder` mevcut koruma korunuyor.

## REALIZED PNL
- Settlement’ta realized PnL artık `closeFillPrice` (gerçek fill) üzerinden hesaplanıyor.
- Fill price spread/slippage içerdiği için extra slippage cost net PnL’de double-count edilmiyor.

## UNREALIZED PNL
- Mevcut `calculateUnrealizedPnl` akışı korunuyor.

## EQUITY
- Bu iterasyonda portfolio/equity hesap katmanı refactor edilmedi (mevcut repository yaklaşımı korunuyor).

## DRAWDOWN
- FIX3 kapsamında drawdown engine’i yeniden yazılmadı.

## PERFORMANCE METRICS
- Execution simulation metrikleri korunuyor.
- FIX3 ile attribution alanları güçlendirildi (spread/slippage/time stamps).

## TRADE LEDGER
- Fill metadata’da identity ve execution zamanları daha zengin taşınıyor.

## SHADOW VS PAPER OUTCOME
- Shadow ve paper outcome ayrımı korunuyor; bu turda observability genişletme kısmi.

## RESTART RECOVERY
- Bu iterasyonda restart recovery mekanizması yapısal olarak değiştirilmedi.

## LEGACY EXECUTION AUDIT
- Legacy paralel path’ler tespitli:
  - `trading-core/paper/live-paper-engine` familyası
  - `paper-runtime` bazı kısımları
- Canonical production paper path orchestrator+V2+adapter hattı olarak güçlendirildi.

## FUNNEL INVARIANTS
- Execution tarafında explicit identity/intent propagation geliştirildi.
- Full lifecycle funnel math (closed ledger vs position qty/cash reconciliation) bu iterasyonda kısmi.

## ACCOUNTING INVARIANTS
- Double-count slippage engeli eklendi.
- Partial fill/no fake fill semantiği güçlendirildi.

## TESTS
- PASS: `tests/fix3-paper-execution-finalization.test.ts` (5/5)
- PASS: `tests/fix2-binance-runtime-hardening.test.ts` (8/8)
- PASS: `tests/phase02-realtime-market-spine.test.ts` (20/20)
- PASS: `tests/canonical-identity-authority.test.ts` (önceki koşuda 11/11)
- FAIL (env bağlı): `tests/execution-settlement.integration.test.ts` (DB erişimi yok, timeout)
- FAIL (env bağlı): `tests/execution-orchestrator.integration.test.ts` (timeout)

## TYPECHECK
- FAIL: `npx tsc --noEmit` -> JS heap OOM (exit 134).

## BUILD
- FAIL: `npm run build` -> `ERR_WORKER_INVALID_EXEC_ARGV` (`NODE_OPTIONS` içinde geçersiz `--r=`).

## KNOWN ISSUES
- Local test ortamında Postgres bağlantısı yok (`localhost:5432`) olduğu için bazı integration testler timeout/fail.
- Repo genelinde typecheck OOM ve geniş TS debt devam ediyor.
- Build ortam değişkeni kirli (`NODE_OPTIONS`).

## FIX 4 READINESS
- FIX3 için core paper realism/idempotency/identity ilerletildi.
- FIX4’e geçmeden önce kalan blocker’lar:
  - DB-bağımlı integration test ortamı stabilizasyonu
  - Typecheck/build environment sorunları
  - Kalan lifecycle/accounting invariants’ın tam kapsam testlenmesi
