# PHASE-07 FIX2 BINANCE RUNTIME HARDENING REPORT

## STATUS
- PARTIAL DONE (core FIX-2 hardening implemented, deterministic tests green, typecheck/build environment issues unchanged).
- Long paper validation **NOT** started.
- Live order lock preserved (`LIVE_TRADING_ENABLED=false` path unchanged).

## ROUTING BEFORE
- Binance TR path had implicit mixed fallbacks (TR -> `/api/v3` -> global style paths in selected branches).
- WebSocket deep subscribe/unsubscribe commands were sent from a raw queue without explicit control-rate guardrail.
- Circuit breaker had basic OPEN/HALF_OPEN flags but no real single-probe HALF_OPEN lifecycle telemetry.

## FINAL VENUE MODEL
- Added canonical venue single-source in `src/server/exchange/venue-config.service.ts`.
- Introduced explicit responsibilities:
  - `DISCOVERY_VENUE`
  - `MARKET_DATA_VENUE`
  - `MICROSTRUCTURE_VENUE`
  - `METADATA_VENUE`
  - `PAPER_EXECUTION_VENUE`
  - `LIVE_EXECUTION_VENUE`
- Default runtime is deterministic and single-venue (platform-derived), cross-venue fallback disabled.

## DISCOVERY VENUE
- `resolveCanonicalVenueConfig().discoveryVenue`.

## MARKET DATA VENUE
- `resolveCanonicalVenueConfig().marketDataVenue`.

## MICROSTRUCTURE VENUE
- `resolveCanonicalVenueConfig().microstructureVenue`.

## METADATA VENUE
- `resolveCanonicalVenueConfig().metadataVenue`.

## PAPER EXECUTION VENUE
- `resolveCanonicalVenueConfig().paperExecutionVenue`.

## LIVE EXECUTION VENUE
- `resolveCanonicalVenueConfig().liveExecutionVenue`.

## PROVIDER RESPONSIBILITY MATRIX
- Venue config is centralized and exposed to startup + resolved config snapshot.
- Opportunity/Micro context metadata now includes venue fields (`discoveryVenue`, `marketDataVenue`, `microstructureVenue`, `paperExecutionVenue`, `metadataVenue`).
- Paper execution now validates market venue consistency (`VENUE_MISMATCH_PAPER_EXECUTION` guard).
- Classified canonical call-sites:
  - `DISCOVERY`: `src/server/opportunity/opportunity-engine.ts` (candidate context + venue tags)
  - `PUBLIC_MARKET_DATA`: `src/server/market-data/spine/market-data-daemon.ts`, `src/server/market-data/market-data-gateway.ts`
  - `MICROSTRUCTURE`: `src/server/microstructure/microstructure-engine.ts`
  - `METADATA`: `src/server/exchange/providers/binance.provider.ts#getExchangeInfo`
  - `PAPER_EXECUTION`: `src/server/exchange-simulator/paper-exchange-adapter.service.ts`
  - `LIVE_EXECUTION`: `src/server/execution/execution-orchestrator.service.ts` + `services/binance.service.ts`
  - `ACCOUNT`: `services/binance.service.ts#getAccountBalances` + `binance.provider.ts#getAccountBalances`
  - `RECOVERY`: `market-data-daemon` bootstrap (`refreshUniverse`, `bootstrapKlines`, `bootstrapDepth`)
  - `LEGACY`: legacy scanner/old trading-core paths kept outside canonical FIX-2 authority

## FALLBACK AUDIT
- TR klines global fallback path is now gated by explicit `allowCrossVenueFallback` and defaulted to `false`.
- Runtime policy now prefers deterministic same-venue semantics instead of implicit provider hopping.

## GLOBAL/TR MIXING REMOVED
- Removed implicit cross-venue klines fallback in normal FIX-2 runtime (config default: off).
- Startup now validates venue consistency with `assertVenueConfigConsistency`.

## LIGHT/DEEP SOCKET ARCHITECTURE
- Light and deep sockets already physically separated; this is now explicit via venue config roles:
  - `LIGHT_MARKET_CONNECTION`
  - `DEEP_MARKET_CONNECTION`
- Telemetry now tracks separate open/close counts by socket role.

## SUBSCRIPTION QUEUE
- Added `SubscriptionCommandQueue` (`src/server/market-data/spine/subscription-command-queue.ts`).
- Supports queued `SUBSCRIBE`/`UNSUBSCRIBE`, batching, and per-second send guard.

## SUBSCRIPTION DEDUPE
- Queue-level dedupe for pending subscribe/unsubscribe.
- Dynamic manager dedupe counters added.

## REF COUNT
- Existing ref-count model retained and hardened with lifecycle markers.
- Deterministic tests verify multi-consumer behavior.

## CONTROL MESSAGE RATE LIMIT
- Added explicit safe headroom:
  - Official reference limit: `5 msg/sec`
  - Internal cap: `3 msg/sec`
- Enforced in `SubscriptionCommandQueue`.

## 1008 HANDLING
- WS reconnect backoff now adds explicit penalty on close code `1008`.
- Socket close telemetry includes command burst windows (`commandsLast1s`, `commandsLast5s`) and pending subscriptions.
- `1008` counter added to daemon telemetry.

## RECONNECT
- Deep reconnect restores desired subscriptions from canonical registry.
- Queue dedupe prevents duplicate restore burst.

## BREAKER BEFORE
- Basic breaker with `failures`, `state`, and cooldown check only.
- HALF_OPEN was nominal, without active probe ownership control.

## BREAKER AFTER
- Rebuilt `withCircuitBreaker` as canonical state machine:
  - `CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN`
- Added single active HALF_OPEN probe ownership.
- Added bounded backoff escalation and 418/429-aware cooldown behavior.

## BREAKER DOMAINS
- Domain model added:
  - `MARKET_DATA`
  - `METADATA`
  - `ACCOUNT`
  - `EXECUTION`
  - `INTERNAL`
- Domain inferred from key and included in snapshots.

## HALF_OPEN IMPLEMENTATION
- Only one probe owner can execute in HALF_OPEN.
- Concurrent probes fail-fast with `CircuitOpenError`.
- Probe success closes/reset; probe failure re-opens with next backoff.

## METADATA FAILURE BEHAVIOR
- Metadata cache freshness details are now observable (`loadedAt`, `ageMs`, `expiresAt`, `source`) through provider runtime status.
- Stale-cache fallback behavior preserved, execution breaker isolation preserved.

## MARKET DATA FAILURE BEHAVIOR
- WS stale/degraded states remain explicit.
- Deep socket failure no longer implies light socket kill; tested via 1008 simulation.

## ACCOUNT FAILURE BEHAVIOR
- Account and execution circuit domains are isolated by key/domain model.
- Paper simulation path remains independent from live account hard dependency.

## PAPER EXECUTION FAILURE BEHAVIOR
- Paper simulator includes explicit venue consistency guard.
- Live execution venue eligibility gate added in execution orchestrator for live mode.

## 429
- Retry-After aware backoff continues and is now represented in breaker/open behavior.

## 418
- IP-ban style behavior escalates cooldown windows; limiter + breaker paths remain ban-aware.

## OPEN SYMBOL CACHE
- Open-symbol metadata cache usage retained.
- Cache freshness is now exposed in runtime status.

## CONFIG SINGLE SOURCE
- Canonical venue routing config is centralized (`venue-config.service.ts`).
- Resolved config snapshot now contains `venueRouting`.

## TELEMETRY
- Added/extended metrics in MarketDataDaemon telemetry:
  - `lightSocketState`, `deepSocketState`
  - `lightOpenCount`, `deepOpenCount`
  - `lightCloseCount`, `deepCloseCount`
  - `count1008`
  - `subscriptionRequested`, `subscriptionActivated`, `duplicateSubscriptionSuppressed`
  - `controlCommandsLast1s`, `controlCommandsLast5s`, `controlCommandsPerSecMax`, `controlCommandRateViolation`
- Socket close records include role, pending subscription count, and command burst windows.

## TESTS
- Added `tests/fix2-binance-runtime-hardening.test.ts` (8 deterministic tests):
  - queue batching + control-rate cap
  - duplicate subscription suppression
  - refcount behavior
  - deep 1008 isolation from light socket
  - breaker CLOSED/OPEN/HALF_OPEN lifecycle
  - single half-open probe owner
  - venue eligibility rejection (`VENUE_NOT_EXECUTABLE`)
  - canonical venue consistency
- Existing relevant suite re-run:
  - `tests/phase02-realtime-market-spine.test.ts` PASS
  - `tests/canonical-identity-authority.test.ts` PASS

## TYPECHECK
- `npx tsc --noEmit` -> FAIL (exit 134, JS heap out-of-memory).
- Retry with higher heap (`node --max-old-space-size=6144 ...`) -> completed but FAIL (large pre-existing TS error set; terminal count: 627 errors).

## BUILD
- `npm run build` -> FAIL (`ERR_WORKER_INVALID_EXEC_ARGV`, invalid `NODE_OPTIONS`: `--r=`).

## KNOWN ISSUES
- Global repository TypeScript heap pressure remains unresolved in this fix scope.
- Higher-heap typecheck reveals broad repository type debt unrelated to this patch set.
- Build environment contains invalid `NODE_OPTIONS` that is external/runtime-env related.

## FIX 3 READINESS
- FIX-2 core runtime hardening primitives are in place.
- Blockers before FIX-3:
  - workspace `typecheck` OOM
  - environment `NODE_OPTIONS` pollution
  - broader repository-level fallback audit can be expanded for remaining legacy modules.
