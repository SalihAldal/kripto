/** A successful CLI exit alone does not mean a paper campaign ran or traded. */
export function classifyPaperCampaign(value: unknown) {
    const row = value as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return "MISSING_RESULT";
    if (row.phase === "PREFLIGHT_BLOCKED" || row.phase === "START_FAILED") return String(row.phase);
    if (row.executionMode !== "paper" || String(row.liveTradingEnabled) !== "false") return "UNVERIFIED_EXECUTION_MODE";
    if (row.reachedTerminal !== true || row.completedFullDuration !== true) return "INCOMPLETE_CAMPAIGN";
    if (!Number.isInteger(row.tradeCount) || Number(row.tradeCount) < 0 || !Number.isInteger(row.openPositionCount) || Number(row.openPositionCount) < 0) return "MISSING_TRADE_COUNTS";
    if (row.tradeCount === 0 && row.openPositionCount === 0) return "COMPLETED_NO_TRADES";
    return "COMPLETED_WITH_ACTIVITY_NOT_PROFITABILITY_PROOF";
}
