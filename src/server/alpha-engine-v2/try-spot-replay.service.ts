import { randomUUID } from "node:crypto";
import { SPOT_COST_REALISTIC } from "./cost-model-v2.service";
import { prepareOiFeatureCache } from "./oi-features.service";
import { evaluateUnifiedEntryDecision } from "../trade-decision-core/trade-decision-core.service";
import { attributeEntryLosses } from "../trade-decision-core/entry-loss-attribution.service";
import type { TrySpotPanel } from "../trade-decision-core/try-dataset-loader.service";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig, TrySpotTradeRecord } from "../trade-decision-core/types";
import type { AlphaExperimentStats } from "./types";
import { createPr04ExitReplaySession, stepPr04ExitReplayTick, type Pr04ExitReplaySession } from "../profitability/pr04-replay";
import { applyExitFill, releasePr04ReplayState } from "../profitability/pr04-exit-evaluator";
import { buildMatchedEntryManifest } from "../profitability/pr04-matched-entry-manifest";
import { buildRiskReference } from "../profitability/pr04-structural-stop";
import { entryIntentToInvalidation } from "../trade-decision-core/production-adapter.service";
import type { ExitDecisionKind } from "../profitability/pr04-types";
import { LOCAL_ENTRY_RISK, isLocalEntry, planLocalEntry } from "../trade-decision-core/local-entry-risk.service";
export const TRY_REPLAY_VERSION = "causal-portfolio-v2";
const HOUR = 3600000;
export type EquityPoint = {
    atMs: number;
    cashTry: number;
    equityTry: number;
    openPositions: number;
};
type ExitOrder = {
    atMs: number;
    reason: string;
    kind: ExitDecisionKind;
    quantity: number;
    leg: string | null;
};
type Position = {
    intent: EntrySignalIntent;
    entryAtMs: number;
    entryPrice: number;
    rawEntry: number;
    quantity: number;
    remaining: number;
    notional: number;
    entryFee: number;
    exitFee: number;
    proceeds: number;
    rawProceeds: number;
    fills: number;
    mfe: number;
    mae: number;
    mark: number;
    markAtMs: number;
    peak: number;
    exit: ExitOrder | null;
    session?: Pr04ExitReplaySession;
};
type Cursor = {
    panel: TrySpotPanel;
    ti: number;
    ei: number;
    lastTry: number;
    cooldownUntil: number;
    position: Position | null;
    pending: {
        intent: EntrySignalIntent;
        notional: number;
        expires: number;
    } | null;
};
export type ReplayOptions = {
    panels: TrySpotPanel[];
    btcPanel: TrySpotPanel;
    variant: StrategyVariantConfig;
    periodStart: number;
    periodEnd: number;
    freshPartialStart: number;
    initialCashTry?: number;
    notionalTry?: number;
    feePerSidePct?: number;
    slippageBpsPerSide?: number;
    participationRate?: number;
    maxPositions?: number;
    onProgress?: (p: {
        atMs: number;
        trades: number;
        elapsedMs: number;
        rssMb: number;
    }) => void;
};
function lastBefore<T>(rows: T[], at: number, time: (r: T) => number) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (time(rows[mid]) <= at)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo - 1;
}
export function tradeStatistics(trades: TrySpotTradeRecord[], maxDrawdown = 0): AlphaExperimentStats {
    const wins = trades.filter(t => t.netPnlTry > 0);
    const gains = wins.reduce((n, t) => n + t.netPnlTry, 0);
    const losses = -trades.filter(t => t.netPnlTry <= 0).reduce((n, t) => n + t.netPnlTry, 0);
    const net = gains - losses;
    return { trades: trades.length, wins: wins.length, losses: trades.length - wins.length,
        grossPnl: trades.reduce((n, t) => n + t.grossReturnPct / 100 * t.notionalTry, 0), netPnl: net,
        expectancy: trades.length ? net / trades.length : 0, profitFactor: losses ? gains / losses : gains ? 999 : 0,
        maxDrawdown, longTrades: trades.length, shortTrades: 0, cashSkips: 0 };
}
/** Closed-bar execution approximation, NOT a quote/order-book replay.
 * Orders submitted at t can fill only at a later positive-volume minute close.
 * Exits share volume with partial fills; missing liquidity never deletes a position.
 */
export function runTrySpotReplayUniverse(input: ReplayOptions) {
    const started = Date.now(), runId = randomUUID();
    const initialCash = input.initialCashTry ?? 10000, budget = input.notionalTry ?? 1000;
    const fee = (input.feePerSidePct ?? SPOT_COST_REALISTIC.takerFeePerSidePct) / 100;
    const slip = (input.slippageBpsPerSide ?? 7) / 10000;
    const participation = input.participationRate ?? .01;
    const maxPositions = input.maxPositions ?? (input.variant.researchOnly ? 3 : 10);
    if (![initialCash, budget, fee, slip, participation, maxPositions].every(Number.isFinite) ||
        !(initialCash > 0 && budget > 0 && fee >= 0 && fee < 1 && slip >= 0 && slip < 1 && participation > 0 && participation <= 1 && Number.isInteger(maxPositions) && maxPositions > 0))
        throw new Error("INVALID_REPLAY_CONFIG");
    if (!(Number.isFinite(input.periodStart) && Number.isFinite(input.periodEnd) && input.periodEnd >= input.periodStart))
        throw new Error("INVALID_REPLAY_PERIOD");
    const panels = [...input.panels].sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (new Set(panels.map(p => p.symbol)).size !== panels.length)
        throw new Error("DUPLICATE_REPLAY_SYMBOL");
    if (!input.variant.researchOnly)
        panels.forEach(prepareOiFeatureCache);
    const cursors: Cursor[] = panels.map(panel => ({ panel,
        ti: Math.max(0, lastBefore(panel.executionBarsTRY, input.periodStart - 1, b => b.closeTime) + 1),
        ei: Math.max(0, lastBefore(panel.bars, input.periodStart - 1, b => b.closeTime) + 1),
        lastTry: lastBefore(panel.executionBarsTRY, input.periodStart - 1, b => b.closeTime), cooldownUntil: 0, position: null, pending: null }));
    const trades: TrySpotTradeRecord[] = [], equity: EquityPoint[] = [];
    let cash = initialCash, peak = initialCash, maxDd = 0, lastEquity = initialCash, nextSample = input.periodStart;
    let nextProgress = started, rejectedCash = 0, expiredOrders = 0;
    let riskRejectedEntries = 0, riskBlockedSignals = 0, day = -1, dayStartEquity = initialCash;
    const entryDiagnostics: Record<string, number> = {};
    const sessions: string[] = [];
    const markedEquity = () => cash + cursors.reduce((sum, c) => sum + (c.position ? c.position.remaining * c.position.mark : 0), 0);
    const reserved = () => cursors.reduce((sum, c) => sum + (c.pending ? c.pending.notional * (1 + fee) : 0), 0);
    const modeledOpenRisk = (excludePending?: Cursor) => cursors.reduce((sum, c) => {
        const p = c.position;
        const positionRisk = p && isLocalEntry(p.intent) ? p.remaining * Math.max(0, p.entryPrice * (1 + fee) - p.intent.invalidationPrice! * (1 - slip) * (1 - fee)) : 0;
        return sum + positionRisk + (c !== excludePending && c.pending && isLocalEntry(c.pending.intent) ? Number(c.pending.intent.metadata.riskBudgetTry) : 0);
    }, 0);
    const riskEntryAllowed = () => {
        const account = markedEquity();
        return (dayStartEquity - account) / dayStartEquity * 100 < LOCAL_ENTRY_RISK.dailyLossLimitPct && (peak - account) / peak * 100 < LOCAL_ENTRY_RISK.maxDrawdownPct;
    };
    const requestExit = (p: Position, at: number, reason: string, kind: ExitDecisionKind = "TIME_EXIT", quantity = p.remaining, leg: string | null = null) => {
        if (!p.exit)
            p.exit = { atMs: at, reason, kind, quantity: Math.min(quantity, p.remaining), leg };
    };
    try {
        while (true) {
            let now = Infinity;
            for (const c of cursors)
                now = Math.min(now, c.panel.executionBarsTRY[c.ti]?.closeTime ?? Infinity, c.panel.bars[c.ei]?.closeTime ?? Infinity);
            if (now > input.periodEnd || !Number.isFinite(now))
                break;
            if (Math.floor(now / 86400000) !== day) {
                day = Math.floor(now / 86400000);
                dayStartEquity = lastEquity;
            }
            // First settle ONLY previously submitted orders. Deterministic symbol priority.
            for (const c of cursors) {
                const b = c.panel.executionBarsTRY[c.ti];
                if (!b || b.closeTime !== now)
                    continue;
                c.lastTry = c.ti++;
                if (c.pending && now > c.pending.expires) {
                    c.pending = null;
                    expiredOrders++;
                }
                const traded = b.volume > 0 && b.quoteVolume > 0 && b.close > 0;
                const p = c.position;
                if (p && traded) {
                    p.mark = b.close;
                    p.markAtMs = now;
                    p.peak = Math.max(p.peak, b.close);
                    p.mfe = Math.max(p.mfe, (b.high / p.entryPrice - 1) * 100);
                    p.mae = Math.min(p.mae, (b.low / p.entryPrice - 1) * 100);
                    if (p.exit && now > p.exit.atMs) {
                        const price = b.close * (1 - slip);
                        // Floor to 8 decimals to match PR04 accounting; no overfilled quantity.
                        const quantity = Math.min(p.remaining, p.exit.quantity, Math.floor(b.quoteVolume * participation / price * 1e8) / 1e8);
                        if (quantity > 0) {
                            const proceeds = quantity * price, exitFee = proceeds * fee;
                            cash += proceeds - exitFee;
                            p.remaining = Math.max(0, Number((p.remaining - quantity).toFixed(8)));
                            p.proceeds += proceeds;
                            p.rawProceeds += quantity * b.close;
                            p.exitFee += exitFee;
                            p.fills++;
                            p.exit.quantity = Math.max(0, Number((p.exit.quantity - quantity).toFixed(8)));
                            if (p.session)
                                applyExitFill({ positionId: p.session.positionId,
                                    fill: { price, quantity, fee: exitFee, feeAsset: "QUOTE", atMs: now }, decisionKind: p.exit.kind,
                                    partialLegId: p.exit.quantity <= 0 ? p.exit.leg : null, openOrderRemainingQuantity: p.exit.quantity });
                            if (p.remaining <= 0) {
                                const netPnlTry = p.proceeds - p.notional - p.entryFee - p.exitFee;
                                const grossReturnPct = (p.rawProceeds / p.quantity / p.rawEntry - 1) * 100;
                                const netReturnPct = netPnlTry / p.notional * 100;
                                const base = { symbol: c.panel.symbol, baseAsset: c.panel.baseAsset, executionSymbol: c.panel.executionSymbol,
                                    variantId: input.variant.id, side: "LONG" as const, signalAtMs: p.intent.signalAtMs, entryAtMs: p.entryAtMs,
                                    exitAtMs: now, entryPrice: p.entryPrice, exitPrice: p.proceeds / p.quantity,
                                    signalTryPrice: Number(p.intent.metadata.tryPrice), grossReturnPct, netReturnPct, costPct: grossReturnPct - netReturnPct,
                                    exitReason: p.exit.reason, mfePct: p.mfe, maePct: p.mae,
                                    split: (p.entryAtMs >= input.freshPartialStart ? "FRESH_PARTIAL" : "VAL") as TrySpotTradeRecord["split"],
                                    notionalTry: p.notional, quantity: p.quantity, feeTry: p.entryFee + p.exitFee, netPnlTry,
                                    fillGrossReturnPct: (p.proceeds / p.notional - 1) * 100, exitFillCount: p.fills };
                                trades.push({ ...base, lossAttribution: attributeEntryLosses(base) });
                                if (p.session)
                                    releasePr04ReplayState(p.session.positionId);
                                if (isLocalEntry(p.intent)) c.cooldownUntil = now + LOCAL_ENTRY_RISK.cooldownMs;
                                c.position = null;
                            }
                            else if (p.exit.quantity <= 0)
                                p.exit = null;
                        }
                    }
                }
                if (!c.position && c.pending && traded && now > c.pending.intent.availableAtMs) {
                    const order = c.pending;
                    const guarded = isLocalEntry(order.intent);
                    const plan = guarded && riskEntryAllowed() ? planLocalEntry({ intent: order.intent, mark: b.close, nowMs: now,
                        maxNotionalTry: order.notional, riskBudgetTry: Math.min(Number(order.intent.metadata.riskBudgetTry), markedEquity() * LOCAL_ENTRY_RISK.riskFraction, markedEquity() * LOCAL_ENTRY_RISK.totalRiskFraction - modeledOpenRisk(c)),
                        feePerSidePct: fee * 100, slippageBpsPerSide: slip * 10000 }) : null;
                    if (guarded && !plan) { c.pending = null; riskRejectedEntries++; }
                    // Full-size entry only; insufficient volume leaves the order pending until TTL.
                    if (c.pending && b.quoteVolume * participation >= (plan?.notionalTry ?? order.notional)) {
                        const entryPrice = b.close * (1 + slip), quantity = plan?.quantity ?? Math.floor(order.notional / entryPrice * 1e8) / 1e8;
                        const notional = quantity * entryPrice, entryFee = notional * fee;
                        if (quantity > 0 && cash >= notional + entryFee && order.intent.invalidationPrice! < entryPrice) {
                            cash -= notional + entryFee;
                            const pos: Position = { intent: order.intent, entryAtMs: now, entryPrice, rawEntry: b.close, quantity, remaining: quantity,
                                notional, entryFee, exitFee: 0, proceeds: 0, rawProceeds: 0, fills: 0, mfe: 0, mae: 0, mark: b.close, markAtMs: now, peak: b.close, exit: null };
                            if (input.variant.exitMode.startsWith("pr04")) {
                                const invalidation = entryIntentToInvalidation(order.intent);
                                const manifest = buildMatchedEntryManifest({ entrySignalId: `${runId}:${order.intent.signalId}`, strategyId: "MOMENTUM_CONTINUATION",
                                    entryPolicyVersion: TRY_REPLAY_VERSION, entryAtMs: now, fills: [{ price: entryPrice, quantity, fee: entryFee, atMs: now }],
                                    riskReference: buildRiskReference({ entryPrice, initialStopPrice: invalidation.invalidationThreshold, initialQuantity: quantity, entryFee, includesFeesInBreakEven: true, computedAtMs: now }),
                                    invalidation, featureEvidenceIds: [], dataSource: "KRIPTO_DEEP_DATASET", replayWindow: { fromMs: now, toMs: input.periodEnd }, symbol: c.panel.executionSymbol });
                                pos.session = createPr04ExitReplaySession({ manifest, policyId: "STRUCTURAL_STOP_TRAIL", side: "LONG" });
                                sessions.push(pos.session.positionId);
                            }
                            c.position = pos;
                        }
                        else
                            rejectedCash++;
                        c.pending = null;
                    }
                }
                const pos = c.position;
                if (pos && now > pos.entryAtMs) {
                    const maxHold = isLocalEntry(pos.intent) ? LOCAL_ENTRY_RISK.maxHoldHours * HOUR : input.variant.exitMode === "fixed_8h" ? 8 * HOUR : input.variant.researchOnly ? 7 * 24 * HOUR : 48 * HOUR;
                    if (now >= pos.entryAtMs + maxHold)
                        requestExit(pos, now, "TIME_CAP");
                    if (traded && !pos.exit && pos.session) {
                        const result = stepPr04ExitReplayTick(pos.session, { tickIndex: c.ti, observation: { eventId: `${c.panel.symbol}:${now}`, eventAtMs: now, availableAtMs: now,
                                markPrice: b.close, bid: null, ask: null, high: b.high, low: b.low, closed: true, stale: false, dataGap: false } });
                        const order = pos.session.openExitOrder;
                        if (result.decisionKind !== "NONE" && order)
                            requestExit(pos, now, result.decisionKind, result.decisionKind, order.requestedQuantity, order.partialLegId);
                    }
                    if (traded && input.variant.researchOnly && !isLocalEntry(pos.intent) && !pos.exit) {
                        const distance = Number(pos.intent.metadata.stopDistance);
                        const stop = Math.max(pos.intent.invalidationPrice!, pos.peak * (1 - distance));
                        if (b.close <= stop)
                            requestExit(pos, now, "RESEARCH_STOP", "STRUCTURAL_STOP");
                    }
                }
            }
            // Then produce decisions using ONLY closed observations available by now.
            const rank = cursors.some(c => c.panel.bars[c.ei]?.closeTime === now) ? panels.map(p => { const i = lastBefore(p.bars, now, b => b.closeTime); return { symbol: p.symbol, score: i >= 168 ? p.bars[i].close / p.bars[i - 168].close - 1 : -Infinity }; })
                .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)) : [];
            for (const c of cursors) {
                const bar = c.panel.bars[c.ei];
                if (!bar || bar.closeTime !== now)
                    continue;
                const idx = c.ei++;
                if (c.position && isLocalEntry(c.position.intent) && idx >= 168) {
                    const mean = c.panel.bars.slice(idx - 168, idx).reduce((sum, b) => sum + b.close, 0) / 168;
                    if (bar.close < mean) requestExit(c.position, now, "LOCAL_TREND_LOST");
                }
                if (c.position && !isLocalEntry(c.position.intent) && input.variant.researchOnly && idx >= 240 && (idx + 1) % 24 === 0) {
                    const avg = c.panel.bars.slice(idx - 240, idx).reduce((sum, b) => sum + b.close, 0) / 240;
                    if (bar.close < avg)
                        requestExit(c.position, now, "TREND_TO_CASH");
                }
                if (c.position || c.pending || now < c.cooldownUntil || idx < 48 || (!input.variant.researchOnly && idx % 4 !== 0))
                    continue;
                const tb = c.panel.executionBarsTRY[c.lastTry];
                if (!tb || tb.closeTime > now || now - tb.closeTime > 5 * 60000)
                    continue;
                const bi = lastBefore(input.btcPanel.bars, now, b => b.closeTime);
                const snapshot: MarketSnapshot = { nowMs: now, baseAsset: c.panel.baseAsset, externalSymbol: c.panel.symbol, executionSymbol: c.panel.executionSymbol,
                    externalBarIdx: idx, externalClose: bar.close, tryBarIdx: c.lastTry, tryPrice: tb.close, tryVolume: tb.volume, tryAvailableAtMs: tb.closeTime,
                    executionEstimate: { feePerSidePct: fee * 100, slippageBpsPerSide: slip * 10000 },
                    entryDiagnostics,
                    btcExternalReturn4hPct: bi >= 4 ? (input.btcPanel.bars[bi].close / input.btcPanel.bars[bi - 4].close - 1) * 100 : null,
                    relativeStrengthRank: rank.findIndex(r => r.symbol === c.panel.symbol) + 1 };
                const intent = evaluateUnifiedEntryDecision({ variant: input.variant, panel: c.panel, barIdx: idx, snapshot, nowMs: now });
                if (!intent || intent.side !== "LONG" || intent.invalidationCurrency !== "TRY")
                    continue;
                let notional = budget;
                if (isLocalEntry(intent)) {
                    const account = markedEquity();
                    if (!riskEntryAllowed()) { riskBlockedSignals++; continue; }
                    const riskBudgetTry = Math.min(account * LOCAL_ENTRY_RISK.riskFraction, account * LOCAL_ENTRY_RISK.totalRiskFraction - modeledOpenRisk());
                    const plan = planLocalEntry({ intent, mark: snapshot.tryPrice, nowMs: now, maxNotionalTry: budget, riskBudgetTry, feePerSidePct: fee * 100, slippageBpsPerSide: slip * 10000 });
                    if (!plan) { riskRejectedEntries++; continue; }
                    notional = plan.notionalTry;
                    intent.metadata.riskBudgetTry = riskBudgetTry;
                    intent.metadata.plannedStopRiskTry = plan.modeledStopRiskTry;
                } else if (input.variant.researchOnly) {
                    const recent = c.panel.executionBarsTRY.slice(Math.max(0, c.lastTry - 59), c.lastTry + 1);
                    if (recent.length < 60 || recent.filter(b => b.volume > 0).length < 54 || recent.reduce((s, b) => s + b.quoteVolume, 0) * participation < budget)
                        continue;
                    const risk = 1 - intent.invalidationPrice! / snapshot.tryPrice;
                    notional = Math.min(budget, markedEquity() * .005 / risk);
                    if (!(notional >= 100))
                        continue;
                }
                if (cursors.filter(x => x.position || x.pending).length >= maxPositions || cash - reserved() < notional * (1 + fee)) {
                    rejectedCash++;
                    continue;
                }
                c.pending = { intent, notional, expires: now + (isLocalEntry(intent) ? LOCAL_ENTRY_RISK.entryTtlMs : 15 * 60000) };
            }
            lastEquity = markedEquity();
            peak = Math.max(peak, lastEquity);
            maxDd = Math.max(maxDd, (peak - lastEquity) / peak * 100);
            if (now >= nextSample || (now + 1) % 86400000 === 0) {
                equity.push({ atMs: now, cashTry: cash, equityTry: lastEquity, openPositions: cursors.filter(c => c.position).length });
                nextSample = now + HOUR;
            }
            if (Date.now() >= nextProgress) {
                input.onProgress?.({ atMs: now, trades: trades.length, elapsedMs: Date.now() - started, rssMb: Math.round(process.memoryUsage().rss / 1048576) });
                nextProgress = Date.now() + 5000;
            }
        }
        const openPositions = cursors.flatMap(c => c.position ? [{ symbol: c.panel.executionSymbol, entryAtMs: c.position.entryAtMs, quantity: c.position.remaining,
                mark: c.position.mark, markAtMs: c.position.markAtMs, exitPending: !!c.position.exit,
                unrealizedPnlTry: c.position.remaining * (c.position.mark - c.position.entryPrice) }] : []);
        equity.push({ atMs: input.periodEnd, cashTry: cash, equityTry: lastEquity, openPositions: openPositions.length });
        return { trades, stats: tradeStatistics(trades, maxDd), equity, openPositions, entryDiagnostics,
            portfolio: { initialCashTry: initialCash, cashTry: cash, equityTry: lastEquity, netPnlTry: lastEquity - initialCash, maxDrawdownPct: maxDd, rejectedCash, expiredOrders, riskRejectedEntries, riskBlockedSignals },
            config: { version: TRY_REPLAY_VERSION, variant: input.variant, feePerSidePct: fee * 100, slippageBpsPerSide: slip * 10000, participationRate: participation,
                executionRiskPolicy: input.variant.entryCandidate.startsWith("local_") ? LOCAL_ENTRY_RISK : null,
                initialCashTry: initialCash, notionalTry: budget, maxPositions, executionModel: "NEXT_TRADED_MINUTE_CLOSE_WITH_VOLUME_CAP", feeSource: "UNVERIFIED_ACCOUNT_ASSUMPTION", equityModel: "LAST_TRADED_CLOSE_MTM" },
            elapsedMs: Date.now() - started };
    }
    finally {
        sessions.forEach(releasePr04ReplayState);
    }
}
