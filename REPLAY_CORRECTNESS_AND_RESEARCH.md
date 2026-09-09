# TRY replay correction and frozen strategy research

Based on `96002e5` (production bridge integration). Live authorization remains disabled;
no live orders, paper campaign, deployment, or database migration was performed.

## Changes

- Entry and exit prices include slippage once. Fees use each actual fill notional.
- Entry intent carries a TRY invalidation; external USDT distance is mapped at signal
  time. Production refuses to substitute USDT marks for missing local observations.
- Production and replay call the shared decision wrapper. Future/stale observations
  and mismatched symbol/quote mappings are rejected.
- One chronological cash ledger reserves pending entries and marks open positions.
  Maximum drawdown includes unrealized losses. Symbol input order cannot change fills.
- Orders fill at a later traded **minute close**, with a 1% quote-volume cap. Entry
  orders require full capacity and expire after 15 minutes; exits can fill partially
  and remain pending when liquidity disappears. No historical trade deletion or
  backdated time-cap fills. OHLC lows/highs are not bid/ask quotes.
- PR04 sessions use unique identities and scoped cleanup; replay never clears all
  production exit state. Its actual decision policy is retained.
- OI replay features are cached with causal expanding statistics; live mutable
  panels use the uncached as-of implementation. Formula/prefix parity is tested.
- Validation is isolated from the previously seen last 45 days. Its 18 fifteen-day
  folds measure frozen-rule temporal stability, not fitted walk-forward learning.
- Worker processes expose loading/replay progress, timeout, abort, exact input/code
  fingerprints and atomic completed-variant checkpoints. Interrupted results cannot
  activate paper. A paper smoke must match the current source fingerprint and uses
  the eligible variant. Research variants cannot be selected by production lookup.
- Three fixed research candidates: daily breakout/cash, breakout + top-three relative
  strength, price-shock reclaim. These are new hypotheses, not proven profitable
  strategies. No threshold sweep or automatic promotion was added.
- BTC/equal-weight hold, TRY cash and USDT-translated return provide context.
  Hold benchmarks are fully invested MTM comparisons, not exposure-matched alpha.
  Weekly bootstrap intervals are descriptive, not multiple-testing-adjusted evidence.

## Run

Use Node with `--import tsx` (the package scripts already do this):

```powershell
$env:DEEP_OI_DATA_DIR = "C:\Users\salih\Desktop\kripto-main\KRIPTO_DEEP_DATASET\deep-oi-data"
npm run strategy:replay-test
npm run strategy:validate
npm run strategy:research
# Resume only completed checkpoints with exactly matching code/data/config:
npm run strategy:validate -- --resume
# Short diagnostics are explicitly ineligible for paper:
npm run strategy:validate -- --symbols BTCUSDT --variant baseline_fixed_8h_v1 --days 7
```

`artifacts/strategy-validation-result.json` and `strategy-research-result.json`
are the current run indexes. Trade records, hourly/day-boundary equity, open positions,
assumptions and frozen jobs are under `artifacts/strategy-runs/<fingerprint>/`.
The small committed evidence snapshot is under `artifacts/replay-correctness-evidence/`.
The dataset remains ignored and must be present locally.

## Verification and limits

74 tests cover the replay invariants, OI parity, shared/production decisions,
validation evidence and existing PR04 behavior. A real CLI abort/resume test and
paper gate rejection test passed. Application and script/test type checking and
changed-file lint were checked. CPU sampling identified CSV loading as the dominant
remaining project cost; replay itself no longer rescans the entire OI history.

The 365-day archive supplies a 45-day warmup/development area, **270-day validation**,
5-day boundary buffer, and 45 previously seen days excluded from selection. The
current tests do not constitute 365 days of independent out-of-sample evidence.
No independent unseen/live profitability claim is made. Strategy acceptance is kept
strict; positive PnL from two trades is not sufficient evidence.

Docker is not available in this workspace, so disposable-PostgreSQL settlement and
full production-chain integration tests were not rerun. Next.js production build was
not run; these changes concern server replay/research and were type-checked.

The execution model is explicitly a **bar-close approximation**, not a quote replay.
Fee 0.15%/side and 7bps/side slippage remain account-unverified assumptions. No queue,
L2, measured latency, true liquidation stream or funding-arbitrage executor is claimed.
MTM uses the last traded close (open positions include mark time), without a forced
liquidation fee at data end. New forward-data collection and calibrated venue costs
remain prerequisites for stronger execution evidence. The research layer is disabled
for production even if a future research run passes the economic thresholds.

## Results from the fixed source

Initial cash: 10,000 TRY; 270 validation days; fees and modeled slippage included. Portfolio PnL includes open-position marks.

| Variant | Closed trades | Portfolio PnL (TRY) | Max DD | Acceptance |
|---|---:|---:|---:|---|
| baseline_fixed_8h_v1 | 503 | -2955.29 | 29.77% | FAIL |
| baseline_fixed_8h_v2 | 881 | -4659.02 | 46.79% | FAIL |
| entry_regime_filter_fixed_8h | 759 | -3629.87 | 36.60% | FAIL |
| baseline_v2_pr04_trail | 948 | -4726.64 | 47.88% | FAIL |
| combined_regime_trail | 818 | -3958.74 | 40.51% | FAIL |
| research_trend_cash | 22 | -98.32 | 2.19% | FAIL |
| research_relative_strength | 9 | -50.06 | 1.05% | FAIL |
| research_shock_reclaim | 2 | 15.35 | 0.45% | FAIL |

The two-trade shock result is insufficient evidence. Lower drawdown for the research candidates also reflects fewer trades and different exposure/risk sizing; it does not establish higher alpha. No variant is eligible for paper/live.

Committed JSON snapshots retain local full-evidence references. Those per-trade files are ignored and are recreated by the commands above. The recorded repository head is the pre-change base; `sourceHash` identifies the exact tested implementation.
