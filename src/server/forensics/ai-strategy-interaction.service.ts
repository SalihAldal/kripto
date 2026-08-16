import { createHash } from "node:crypto";
import type {
  AiStrategyInteractionReport,
  AiStrategyInteractionRow,
  ForensicSessionContext,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

const MIN_SAMPLE = 5;

export function buildAiStrategyInteractionReport(input: {
  session: ForensicSessionContext;
  strategyByTradeId: Record<string, string>;
  regimeByTradeId: Record<string, string>;
}): AiStrategyInteractionReport {
  const aiBySymbol = new Map(
    (input.session.consensus ?? []).map((row) => [String(row.symbol ?? "").toUpperCase(), row.finalDecision ?? "UNKNOWN"]),
  );
  for (const row of input.session.decisions) {
    if (row.stage === "execution") {
      try {
        const detail = JSON.parse(row.reasonDetail) as { aiFinalDecision?: string };
        if (detail.aiFinalDecision) {
          aiBySymbol.set(row.symbol.toUpperCase(), detail.aiFinalDecision);
        }
      } catch {
        // ignore non-json
      }
    }
  }

  const grouped = new Map<string, AiStrategyInteractionRow>();
  for (const pnl of input.session.pnlEntries) {
    const strategy = input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN";
    const regime = input.regimeByTradeId[pnl.tradeId] ?? "UNKNOWN";
    const aiVerdict = String(aiBySymbol.get(pnl.symbol.toUpperCase()) ?? "UNKNOWN").toUpperCase();
    const key = `${strategy}::${regime}::${aiVerdict}`;
    const row =
      grouped.get(key) ??
      ({
        strategy,
        regime,
        aiVerdict,
        tradeCount: 0,
        winRate: 0,
        netPnL: 0,
        expectancy: 0,
        sampleLabel: "NOT_ENOUGH_DATA",
      } satisfies AiStrategyInteractionRow);
    row.tradeCount += 1;
    row.netPnL = round(row.netPnL + pnl.netPnL);
    if (pnl.netPnL > 0) row.winRate = round((row.winRate * (row.tradeCount - 1) + 1) / row.tradeCount);
    else row.winRate = round((row.winRate * (row.tradeCount - 1)) / row.tradeCount);
    row.expectancy = row.tradeCount > 0 ? round(row.netPnL / row.tradeCount) : 0;
    row.sampleLabel = row.tradeCount >= MIN_SAMPLE ? "SUFFICIENT" : "NOT_ENOUGH_DATA";
    grouped.set(key, row);
  }

  const rows = Array.from(grouped.values());
  const approveRows = rows.filter((row) => row.aiVerdict === "BUY" || row.aiVerdict === "APPROVE");
  const approveExpectancy =
    approveRows.length > 0
      ? approveRows.reduce((acc, row) => acc + row.expectancy, 0) / approveRows.length
      : null;

  const report: AiStrategyInteractionReport = {
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      approvePositiveExpectancy: approveExpectancy === null ? null : approveExpectancy > 0,
      vetoRemovedGoodTrades: null,
      evidenceQuality: input.session.pnlEntries.length >= 20 ? "COMPLETE" : input.session.pnlEntries.length >= 5 ? "PARTIAL" : "INSUFFICIENT",
    },
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({ rows, summary: report.summary });
  return report;
}
