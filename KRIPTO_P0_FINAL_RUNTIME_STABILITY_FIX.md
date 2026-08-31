# KRIPTO P0 Final Runtime Stability Fix

## Scope
- Objective: make long paper-round selection resilient to transient Binance TR market-data failures and transient Prisma connectivity failures without weakening AI/TDI/risk/safety semantics.
- Change set intentionally avoids strategy, sizing, threshold, VETO, and persistence-durability behavior changes.

## 1) Failure-Sensitive Dependency Map
| Dependency | Caller | Timeout | Retry | Fallback | Current Failure Semantics |
| --- | --- | --- | --- | --- | --- |
| Binance TR `/api/v3/ticker/24hr` | `discoverTopGainerSymbols()` -> scanner priority lane | 4000ms per attempt | bounded (3), exponential+jitter | cache fallback (max 3 min) only | per-request failure isolated, scanner continues |
| Exchange provider ticker bundle | `buildMarketContext()` via `marketDataOrchestrator.fetchContextBundle()` | adaptive per kind | provider-level + orchestrator backoff | cache + stale-on-backoff + safe degraded context | candidate-level degrade, not whole-round fatal |
| Pump live scan market-data | `resolveLiveTopGainerPumpCandidates()` via pump lifecycle | bounded live scan timeout | bounded + lifecycle fallback | fallback to normal scanner rotation | pump lane can fail without killing round |
| AI memory reads | `getAiProviderWeights()`, `evaluateAiPerformanceMemory()`, runtime-context read in AI consensus | bounded read path | bounded (2) for transient DB read | `NO_OPINION`/`MEMORY_UNAVAILABLE` behavior | non-critical DB read no longer auto-fatal |
| Confidence calibration read | `listConfidenceCalibration()` in AI consensus | inherited query timeout | no retry, transient trap | empty bins (`NO_OPINION`) | candidate continues |
| Critical runtime writes (`patchJobActiveRound`, `mergeRunMetadata`) | `RoundRuntimeController.persist()` | bounded prisma wrapper | bounded retry already present | none (must persist) | remains fatal on unrecoverable write, transient timeout tracked |

## 2) Binance TR Root Cause and Fix
- Root cause: intermittent public market-data instability on TR path (`/api/v3/ticker/24hr`), including network/429/auth-envelope style failures, could collapse priority discovery quality.
- Implemented in `top-gainer-discovery`:
  - bounded retry (`3`) with exponential backoff + jitter,
  - per-request deadline,
  - abort-aware cancellation,
  - explicit reason codes (`MARKET_DATA_TIMEOUT`, `MARKET_DATA_NETWORK_ERROR`, `MARKET_DATA_RATE_LIMIT`, `MARKET_DATA_UNAVAILABLE`, `MARKET_DATA_STALE`, `MARKET_DATA_ABORTED`),
  - explicit cache fallback policy (freshness bounded to max 3 minutes),
  - no stale-to-live silent conversion.

## 3) Scanner Failure Isolation
- Added market-data event propagation from discovery to scanner runtime.
- Scanner now updates runtime progress with explicit market-data progress timestamps and counters instead of failing whole selection loop.
- Symbol/provider level faults continue as candidate-level rejects; scanner loop remains alive where safe.

## 4) Safe Cache Fallback Policy
- Fallback allowed only when:
  - cache exists,
  - bounded age policy passes,
  - data path marks fallback explicitly.
- Otherwise returns unavailable/empty discovery result; no fabricated market-data promotion.

## 5) Prisma P1001/P1002 Root Cause and Fix
- Root cause: transient local DB connectivity failures in non-critical intelligence reads previously bubbled into AI/scanner flow.
- Implemented:
  - transient DB error classifier (`P1001`, `P1002`, network/reset/timeout signatures),
  - bounded retry for AI performance memory reads,
  - runtime-context read degrade in AI consensus to `MEMORY_UNAVAILABLE:NO_OPINION` instead of hard-failing candidate.

## 6) Critical Write Semantics
- Critical persistence path remains unchanged in strictness.
- Added explicit `lastPersistAt` and `dbTransientFailures` runtime tracking.
- Heartbeat timeout degradation remains observable and counted; no silent persistence bypass introduced.

## 7) AI Performance-Memory Path
- Wrapped non-critical reads with transient-safe fallback.
- If memory path unavailable:
  - no bullish/bearish fabrication,
  - no forced negative score,
  - analysis continues with `NO_OPINION` semantics.

## 8) Long-Selection Progress / Watchdog
- Runtime snapshot extended with:
  - `lastScannerProgressAt`, `lastMarketDataProgressAt`, `lastAIProgressAt`, `lastPersistAt`,
  - `scannerSymbolsProcessed`, `pumpSymbolsProcessed`,
  - `marketDataRequests`, `marketDataFailures`, `fallbackCount`, `dbTransientFailures`.
- Progress-state classifier now supports `DEPENDENCY_DEGRADED` and treats it as continue-safe (no premature stale kill).

## 9) Time Budget Behavior
- No global selection-budget expansion.
- Local bounded retries/deadlines introduced only for transient failures.
- Effective behavior remains budget-governed; work does not use unbounded retries.

## 10) Tests Added/Updated
- `tests/top-gainer-discovery.test.ts`
  - transient failure retry path,
  - cache fallback path,
  - stale cache rejection path.
- `tests/round-progress-state.test.ts`
  - dependency-degraded classification,
  - true stalled classification.
- `tests/ai-performance-resilience.test.ts`
  - transient `P1001` on memory read -> safe fallback,
  - transient `P1002` on pending read -> no crash.
- Existing `tests/round-runtime.test.ts` re-run for persistence safety.

## 11) Controlled 2-Round Runtime Validation
- Command executed: `pnpm tsx scripts/_p1-scanner-entry-2round-validation.ts`
- Session/job: `cmsz7lzqi0009uneosnuhv08d`
- Observed:
  - round loop advanced deeply through scanner/AI and later reached `currentRound=2`,
  - no immediate runtime abort from transient market-data/read-path failures,
  - process became non-productive/hung and exceeded 20 min per-round constraint.
- Action taken:
  - validation process terminated,
  - safe stop issued via `scripts/_stop-auto-round-job.ts` to avoid RUNNING zombie.

## 12) Before/After Runtime Metrics
| Metric | Before | After |
| --- | --- | --- |
| scanner event-gap p50/p95/p99/max | 11526 / 39086 / 167426 / 217188 ms | not exported in completed 2-round artifact (run interrupted) |
| market-data failures | intermittent `/api/v3/ticker/24hr` failures | observed and isolated via explicit retry/fallback path; counters added to runtime snapshot |
| fallback count | not explicit | explicit `fallbackCount` runtime field added |
| DB transient failures | P1001 could abort round | transient non-critical read path degrades to `NO_OPINION`; runtime tracks `dbTransientFailures` |
| `patchJobActiveRound` timeout count | low baseline | remained `0` in observed runtime logs during long run |
| round completion (2 rounds) | failed previously | not completed in this run (hung/forced stop) |
| scheduler crash | possible runtime abort chain | no scheduler crash observed; run stopped manually |

## 13) Remaining Blockers
- Full 2-round completion under 20 min/round is not yet proven.
- Runtime telemetry export for scanner event-gap/failure counters needs final artifact wiring for post-run forensic reports.
- AI stack-overflow candidate failure still appears (`Maximum call stack size exceeded`) and can amplify long-loop instability.
