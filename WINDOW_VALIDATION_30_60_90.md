# Recent 30/60/90-day diagnostics

Verified GitHub base: `abaf38997fdf0afcac40d71038e304fa72186195`; its tree matches the earlier patch exactly. The default `main` branch still points at the dataset-builder commit; the reviewed code is on `codex/replay-correctness-and-alpha-research`.

## Reproduce

```powershell
$env:DEEP_OI_DATA_DIR = "C:\Users\salih\Desktop\kripto-main\KRIPTO_DEEP_DATASET\deep-oi-data"
npm run strategy:windows
```

Output: `artifacts/strategy-window-matrix.json`. The archive is loaded once. Eight fixed candidates, five unique windows at base costs, and three trailing windows at stress costs give **64 runs**. Latest measured runtime: 21.62 seconds, including checksum verification/loading. All start with 10,000 TRY and reset account state; historical feature warmup remains available.

Base assumptions: 0.15% fee + 7bps slippage per side. Stress: 0.20% + 15bps per side. Participation limit: 1% minute quote volume. These are uncalibrated execution assumptions. The runner cannot authorize paper/live and writes a separate result from strategy validation.

| Window | UTC start | UTC end |
|---|---|---|
| trailing_30d | 2026-08-02 | 2026-08-31 |
| trailing_60d | 2026-07-03 | 2026-08-31 |
| trailing_90d | 2026-06-03 | 2026-08-31 |
| block_31_60d_ago | 2026-07-03 | 2026-08-01 |
| block_61_90d_ago | 2026-06-03 | 2026-07-02 |

## Base results

| Candidate | 30d net TRY | 60d net TRY | 90d net TRY | 90d trades | 90d max DD |
|---|---:|---:|---:|---:|---:|
| baseline_fixed_8h_v1 | -467.18 | -761.81 | -1474.81 | 132 | 15.45% |
| baseline_fixed_8h_v2 | -364.51 | -599.84 | -1591.83 | 257 | 16.32% |
| entry_regime_filter_fixed_8h | -382.60 | -511.78 | -1470.53 | 227 | 15.09% |
| baseline_v2_pr04_trail | -1046.19 | -1321.17 | -1848.55 | 258 | 18.63% |
| combined_regime_trail | -986.46 | -1167.01 | -1629.38 | 224 | 16.38% |
| research_trend_cash | 102.98 | 98.17 | 114.54 | 8 | 1.23% |
| research_relative_strength | 102.98 | 98.17 | 100.74 | 6 | 1.19% |
| research_shock_reclaim | 0.00 | 0.00 | 0.00 | 0 | 0.00% |

No candidate passed even the descriptive economic screen. All rows remain ineligible for promotion independently of that screen. The trailing windows overlap and are not three independent confirmations. All data has already been seen in development/research.

## Findings and code fixes

- OI V2 30d: closed-fill raw PnL +48.71 TRY, costs 409.02 TRY. Portfolio PnL also includes unfinished-position PnL. At 90d its raw PnL is already -458.63 TRY: reducing commissions alone cannot fix that period.
- Trend/cash 90d: +114.54 TRY across eight closed trades; stress +93.46 TRY. Three separate 30d blocks produce +16.29, -4.79 and +102.98 TRY. This is low-sample, concentrated, inconsistent evidence.
- Trend/cash sampled invested allocation averages only 0.55% of equity in 90d. BTC hold is +22.71% and equal-weight hold +15.42%; these are fully invested, not exposure-matched comparisons. The trend account return translated to USDT is -3.64%.
- The old `--days` option starts at the original validation start, not archive end. New `strategy:windows` explicitly anchors trailing dates; the old option now refuses >270 days so it cannot silently cross into excluded history.
- Added exact closed-fill raw PnL / slippage / fee reconciliation and separate unfinished-position PnL, exit-reason totals, entry delay and sampled exposure. This is identical-fill attribution, not a simulated zero-cost strategy.
- Profit factor with no losing trades is displayed as null plus a status, rather than a misleading 999.
- Replay now rejects nonfinite cash/budgets and fractional position limits.

## Remaining work before a profitable production claim

The existing OI entry family remains unqualified. Price/volume confirmation and an entry whose prospective movement exceeds execution costs need a separately frozen hypothesis and new unseen data; no threshold was tuned to make these windows pass. The trend family remains research-only. Account-specific fees, actual executable spread/latency, and production chain tests are still required. This run does not verify any user machine/server runtime settings or running bot.

78 tests passed across eight suites. App and script/test TypeScript checks and changed-file ESLint passed. PostgreSQL chain tests and production build were not rerun. No live/paper orders or deployment were performed. Committed evidence is in `artifacts/window-validation-evidence/`. Recorded sourceHash identifies the tested code; repositoryHead records its pre-edit base.
