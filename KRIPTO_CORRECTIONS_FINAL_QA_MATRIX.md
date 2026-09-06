# KRIPTO CORRECTIONS FINAL QA — REQUIREMENT MATRIX

| Req ID | Correction | Expected | Production Path | Test | DB | Market | Result |
|---|---|---|---|---|---|---|---|
| EXEC-STOP-01 | EXEC | After terminal partial 0.5, stop at 90 closes without O | processFix02Pr04ExitTick | corrections-final-qa ADV-STOP-01 | Y | N | PASS |
| EXEC-PARTIAL-OPEN-01 | EXEC | Partially filled open order blocks duplicate sell quant | shouldSuppressDuplicateExit | execution-correction.integration.test.ts B | N | N | PASS |
| EXEC-FILL-01 | EXEC | Routing uses paper fill price/fee not decision mark | requireSettlementFillEvidence | corrections-final-qa ADV-FILL-01 + execution-correction C | Y | N | PASS |
| EXEC-ATOMIC-01 | EXEC | Partial settlement dedup/order/position/PnL in single P | applyCanonicalPartialSettlementFill | corrections-final-qa ADV-ATOMIC-01 + execution-correction D | Y | N | PASS |
| EXEC-CRASH-01 | EXEC | Rollback, duplicate fill idempotency, concurrent client | applyCanonicalPartialSettlementFill | ADV-ATOMIC-01 + ADV-CONCURRENT-01 + execution-correction F (3×) | Y | N | PARTIAL |
| REPLAY-AVAIL-01 | REPLAY | Trade/candle unavailable before receiveAt at decision | filterTradesAtDecision / klinesToCa | corrections-final-qa ADV-AVAIL-01/02 | N | N | PASS |
| REPLAY-NC-01 | REPLAY | Counterfactual entry does not shift market tick timesta | pr05-negative-control.ts | corrections-final-qa ADV-NC-01 + replay-correction | N | N | PASS |
| REPLAY-PORT-01 | REPLAY | Chronological portfolio rejects B at 10:01 when A holds | pr05-portfolio-replay.ts | corrections-final-qa ADV-PORT-01 + replay-correction | N | N | PASS |
| REPLAY-FILL-01 | REPLAY | Orphan applyFill without open order rejected | pr04-replay.ts | corrections-final-qa ADV-FILL-02 | N | N | PASS |
| CHAIN-SETTLE-01 | EXEC | Context→evaluator→persist→partial→stop settlement integ | ADV-STOP-01 path (DB-seeded positio | corrections-final-qa ADV-STOP-01 | Y | N | PARTIAL |
| EXEC-RECONCILE-01 | EXEC | RECONCILE_REQUIRED consumer finds order and ingests fil | NOT_VERIFIED | NOT_RUN | N | N | NOT_RUN |
| EXEC-FULL-ATOMIC-01 | EXEC | Full close through canonical single transaction | post-trade-settlement.service | NOT_RUN | N | N | NOT_RUN |