# Leverage Rulebook (BinanceTR-Safe)

## Purpose

This rulebook defines how the system performs deep leverage analysis while staying compliant with BinanceTR spot constraints and strict risk discipline.

## Exchange Reality Rules

- BinanceTR execution in this project runs in spot mode.
- If platform is `tr`, leverage analysis output is advisory and execution route is `SPOT_FALLBACK`.
- No synthetic short or unsupported derivatives execution is allowed in BinanceTR spot flow.

## Analysis Principles

- Use 3-provider consensus (`provider-1`, `provider-2`, `provider-3`).
- Require directional edge (`BUY` or `SELL`) for leverage eligibility.
- Prefer `NO_TRADE` when confidence-quality-ratio is weak.
- Use spread, volatility, risk score, and trend agreement to build leverage quality score.

## Risk Gating

- Hard cap requested leverage to `1..20`.
- Reduce effective leverage cap when:
  - risk band is HIGH,
  - spread is elevated,
  - volatility is elevated,
  - confidence is low,
  - trend agreement is weak.
- If quality is weak, force `1x` outcome (`LEVERAGE_DISABLED`).

## Scoring Inputs

- Consensus confidence and risk score
- Spread percent
- Volatility percent
- Expected move percent (target distance)
- Trend agreement score (provider directional agreement)

## Route Decisions

- `SPOT_FALLBACK`: BinanceTR path, advisory only, no leverage execution.
- `LEVERAGE_DISABLED`: conditions unsafe, keep 1x.
- `LEVERAGE_EXECUTION`: leverage conditions pass (non-TR path only).

## API Safety Baseline (Binance docs aligned)

- Signed endpoint timestamp/recvWindow must remain valid.
- Respect `429`/`418` headers and backoff rules.
- Treat `5XX` as unknown execution state and reconcile order status.
- Avoid request hammering; prefer cached snapshots where possible.

## Operational Notes

- Deep leverage analysis is intentionally stricter than normal fast-entry scan.
- Advisory output is displayed with profile, risk band, leverage suggestion, and reasons.
- If execution path remains spot (BinanceTR), all-balance spot logic remains the source of truth.

