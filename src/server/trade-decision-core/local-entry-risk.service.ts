import type { EntrySignalIntent } from "./types";
/** Frozen v1 limits. Modeled stop risk is not a guarantee against gaps/illiquidity. */
export const LOCAL_ENTRY_RISK = Object.freeze({ version: "local-execution-v1", riskFraction: .005,
    totalRiskFraction: .015,
    maxAdverseEntryDriftPct: .25, entryTtlMs: 120000, cooldownMs: 2 * 3600000,
    dailyLossLimitPct: 2, maxDrawdownPct: 8, maxHoldHours: 48, minNotionalTry: 100 });
export function isLocalEntry(intent: EntrySignalIntent) { return intent.metadata.executionRiskVersion === LOCAL_ENTRY_RISK.version; }
export function roundTripCostPct(feePerSidePct: number, slippageBpsPerSide: number) {
    const fee = feePerSidePct / 100, slip = slippageBpsPerSide / 10000;
    if (![fee, slip].every(Number.isFinite) || fee < 0 || fee >= 1 || slip < 0 || slip >= 1) return Infinity;
    return ((1 + slip) * (1 + fee) / ((1 - slip) * (1 - fee)) - 1) * 100;
}
export function planLocalEntry(input: { intent: EntrySignalIntent; mark: number; nowMs: number; maxNotionalTry: number; riskBudgetTry: number; feePerSidePct: number; slippageBpsPerSide: number }) {
    const { intent, mark, nowMs, maxNotionalTry, riskBudgetTry } = input;
    const fee = input.feePerSidePct / 100, slip = input.slippageBpsPerSide / 10000;
    const reference = Number(intent.metadata.tryPrice), stop = intent.invalidationPrice;
    if (![mark, nowMs, maxNotionalTry, riskBudgetTry, reference, fee, slip].every(Number.isFinite) || !(mark > 0 && reference > 0 && riskBudgetTry > 0 && maxNotionalTry > 0 && fee >= 0 && fee < 1 && slip >= 0 && slip < 1) ||
        intent.invalidationCurrency !== "TRY" || stop == null || !Number.isFinite(stop) || stop <= 0 || stop >= mark || !Number.isFinite(intent.availableAtMs)) return null;
    if (nowMs < intent.availableAtMs || nowMs - intent.availableAtMs > LOCAL_ENTRY_RISK.entryTtlMs) return null;
    const fillPrice = mark * (1 + slip);
    if ((fillPrice / reference - 1) * 100 > LOCAL_ENTRY_RISK.maxAdverseEntryDriftPct) return null;
    const riskPerUnit = fillPrice * (1 + fee) - stop * (1 - slip) * (1 - fee);
    const quantity = Math.floor(Math.min(maxNotionalTry / fillPrice, riskBudgetTry / riskPerUnit) * 1e8) / 1e8;
    const notionalTry = quantity * fillPrice;
    if (notionalTry < LOCAL_ENTRY_RISK.minNotionalTry) return null;
    return { quantity, fillPrice, notionalTry, feeTry: notionalTry * fee, modeledStopRiskTry: quantity * riskPerUnit };
}
