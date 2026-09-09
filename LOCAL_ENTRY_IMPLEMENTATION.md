# Local entry, execution risk and PR04 accounting delivery

Base: GitHub `codex/window-validation-and-risk-fixes`, commit `455460e`. New hypotheses were implemented with fixed rules, then evaluated. No thresholds were adjusted to manufacture a passing candidate.

## Implemented

- Two research-only entry families: hourly breakout and trend pullback, each requiring external 168h/48h trend context, external quote volume, contiguous local TRY minute history, local price confirmation and local volume/VWAP evidence. OI is not required.
- Historical two-ATR range must exceed three modeled round-trip costs. This is a feasibility screen, not a forecast of profit. Stops use the last closed TRY hour low, not a USDT amount.
- Guarded orders expire after two minutes and reject entry fill drift above 0.25%. Quantity is recalculated at the fill price using entry/exit fees and modeled stop slippage.
- New candidates limit modeled initial stop risk to 0.5% per entry / 1.5% combined, enforce two-hour symbol cooldown, and block new entries at 2% day loss or 8% drawdown. Existing positions still follow exits; these limits do not guarantee a realized loss cap in gaps or illiquidity.
- PR04 trailing and structural exits are now labeled separately when an already-raised stop is hit. This changes diagnosis, not an instruction to hold losing positions.
- Fixed PR04 risk reference: entry commission is added to stop risk rather than subtracted. Example: buy two units at 100, stop at 95, entry fee 2 => modeled risk 12, not 8. This legacy reference still excludes unspecified future exit fees/slippage; the new entry planner includes modeled exit costs.
- Fixed PR04 PnL: entry fees are allocated once between closed quantity and open remainder. Non-quote exit fees remain unknown until settlement normalization instead of subtracting BASE units from quote PnL. Remaining unrealized PnL explicitly excludes future exit costs.
- Replaced hardcoded Docker container/admin credentials in the disposable PostgreSQL test helper. It preserves the explicit test connection settings, creates only a generated test DB, cleans it up on migration failure, and restores environment state.
- Added rejection counters, risk rejection counts, and a strict paper outcome classifier. Preflight blocks, incomplete runs and zero-trade campaigns cannot masquerade as completed paper activity.

## One command

```powershell
$env:DEEP_OI_DATA_DIR = "C:\Users\salih\Desktop\kripto-main\KRIPTO_DEEP_DATASET\deep-oi-data"
npm run strategy:readiness
```

The command runs unit tests, app and strategy-tool type checks, five baseline and five research candidates on the long validation slice, and the 80-run recent-window/cost matrix. If PostgreSQL is reachable, it executes the production-chain integration tests. Only a production-selectable validation winner plus a passing production chain can trigger the existing 20-minute paper smoke. Research variants cannot automatically promote. Live authorization is always disabled in child processes.

`artifacts/strategy-readiness/result.json` is the combined outcome. Exit code 2 means checks completed but readiness was not achieved; it is not a profitable-strategy success code. Per-step logs are stored alongside it. `FIX02_PG_ADMIN_URL` optionally selects a test admin connection with permission to create disposable databases; the real application database is never used for migrations by this helper.

## Verified results

92 tests in 11 suites, both TypeScript checks, changed-file ESLint and **npm run build** passed. Build produced the standalone static/public assets. The real paper-smoke entrypoint was also invoked and correctly rejected the failed validation before loading runtime credentials. No paper/live orders were sent.

The 365-day archive provides a **270-day long validation slice**, with 45 days warmup/development, 5 buffer days and 45 previously seen days excluded from long-slice selection. Recent windows end on 2026-08-31 and explicitly reuse seen data; overlapping windows are not independent evidence.

| Research candidate | Long-slice closed trades | Portfolio net TRY | PF | Max DD |
|---|---:|---:|---:|---:|
| research_trend_cash | 22 | -98.32 | 0.605 | 2.19% |
| research_relative_strength | 9 | -50.06 | 0.591 | 1.05% |
| research_shock_reclaim | 2 | 15.35 | N/A (no losing trades) | 0.45% |
| research_local_breakout | 140 | -648.21 | 0.540 | 7.19% |
| research_local_pullback | 90 | -215.33 | 0.727 | 2.44% |

| New candidate | 30d net TRY | 60d net TRY | 90d net TRY |
|---|---:|---:|---:|
| research_local_breakout | 44.13 | -13.11 | -27.27 |
| research_local_pullback | -40.13 | -138.43 | -151.62 |

All runs use 10,000 TRY initial cash. Base cost assumptions: 0.15% fee and 7bps slippage per side; stress: 0.20% and 15bps. Closed-minute execution with 1% minute quote-volume participation remains an approximation, not live quotes or measured fills. Differences in trade count and capital exposure must not be interpreted as equal-risk alpha improvements.

Final status: unit/type checks PASS; engineering PARTIAL; strategy FAIL; research FAIL; paper BLOCKED_STRATEGY; production-chain BLOCKED_POSTGRES_UNAVAILABLE. No candidate qualified. The two new entry hypotheses are retained with their failures visible, not enabled in production.

A PostgreSQL server and deployed runtime are unavailable in this workspace. Therefore the updated database helper has isolated unit verification, not a newly passing real-PostgreSQL integration run. The existing production metadata feed and any eventual promotion of research candidates still need runtime evidence before use. This task did not inspect or change the user machine/server running mode.

Committed evidence is under `artifacts/local-entry-delivery/`. The recorded repositoryHead is the pre-edit base; sourceHash identifies the tested implementation. Detailed local per-trade worker files are regenerated by the readiness command and are not part of the patch.
