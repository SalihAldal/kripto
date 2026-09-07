import { prisma } from "@/src/server/db/prisma";
import { ensurePaperAccountInitialized, readPaperCashBalances } from "@/src/server/simulation/paper-trading.service";
import { summarizeRoundPipelineTelemetry } from "@/src/server/execution/round-pipeline-telemetry.service";

export type PaperCampaignSummary = {
  campaignId: string;
  jobId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  rounds: number;
  discovered: number;
  selected: number;
  handoffValid: number;
  aiBuy: number;
  aiNoTrade: number;
  executionRejected: number;
  riskRejected: number;
  ordersCreated: number;
  fills: number;
  tradesOpened: number;
  tradesClosed: number;
  paperCashBefore: Record<string, number> | null;
  paperCashAfter: Record<string, number> | null;
  paperCashSource: "app_setting" | "unavailable";
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  maxDrawdown: number | null;
  terminalReasons: Record<string, number>;
  funnel: Record<string, number>;
  accountingUnavailableReason: string | null;
};

function parseTerminalOutcome(failReason: string | null | undefined, metadata: unknown) {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const terminalReason = String(meta.terminalReason ?? failReason ?? "").toUpperCase();
  if (terminalReason.includes("AI_REJECTED") || terminalReason.includes("NO_TRADE") || terminalReason.includes("LOW_CONFIDENCE")) {
    return "ai_rejected";
  }
  if (terminalReason.includes("RISK_") || terminalReason.includes("ADMISSION")) return "risk_rejected";
  if (terminalReason.includes("EXECUTION_REJECTED") || terminalReason.includes("ENTRY_QUALITY")) return "execution_rejected";
  if (terminalReason.includes("HANDOFF_")) return "handoff_invalid";
  if (terminalReason.includes("NO_ELIGIBLE")) return "no_eligible_candidate";
  return "other";
}

export async function buildPaperCampaignSummary(input: {
  campaignId: string;
  jobId?: string | null;
  userId: string;
  startedAt?: string | null;
  endedAt?: string | null;
  paperCashBefore?: Record<string, number> | null;
}): Promise<PaperCampaignSummary> {
  const campaignCmpId = input.jobId ? `cmp:${input.jobId}` : null;
  const job = input.jobId
    ? await prisma.autoRoundJob.findUnique({
        where: { id: input.jobId },
        include: { rounds: { orderBy: { roundNo: "asc" } } },
      })
    : null;

  const rounds = job?.rounds ?? [];
  const selectedRounds = rounds.filter((r) => r.symbol);
  const terminalReasons: Record<string, number> = {};
  let aiBuy = 0;
  let aiNoTrade = 0;
  let executionRejected = 0;
  let riskRejected = 0;
  let handoffValid = 0;

  for (const round of selectedRounds) {
    const meta = (round.metadata ?? {}) as Record<string, unknown>;
    const failReason = String(round.failReason ?? meta.terminalReason ?? "unknown");
    const bucket = parseTerminalOutcome(round.failReason, round.metadata);
    terminalReasons[bucket] = (terminalReasons[bucket] ?? 0) + 1;
    if (bucket === "ai_rejected") aiNoTrade += 1;
    if (bucket === "execution_rejected") executionRejected += 1;
    if (bucket === "risk_rejected") riskRejected += 1;
    if (round.symbol && !failReason.includes("HANDOFF_")) handoffValid += 1;
    if (String(meta.aiDecision ?? "").toUpperCase() === "BUY") aiBuy += 1;
    const telemetry = summarizeRoundPipelineTelemetry(job!.id, round.roundNo);
    if (telemetry.stageCounts.handoff_valid) handoffValid += 0;
  }

  const tradeWhere = {
    userId: input.userId,
    OR: [
      { campaignId: input.campaignId },
      ...(campaignCmpId ? [{ campaignId: campaignCmpId }] : []),
    ],
  };

  const [closedTrades, openTrades, orders, executions] = await Promise.all([
    prisma.paperTrade.findMany({ where: { ...tradeWhere, status: "CLOSED" } }),
    prisma.paperTrade.findMany({ where: { ...tradeWhere, status: "OPEN" } }),
    prisma.tradeOrder.findMany({
      where: {
        userId: input.userId,
        metadata: { path: ["campaignId"], equals: input.campaignId },
      },
    }),
    prisma.tradeExecution.findMany({
      where: {
        tradeOrder: {
          userId: input.userId,
          metadata: { path: ["campaignId"], equals: input.campaignId },
        },
      },
    }),
  ]);

  const realizedPnl = closedTrades.reduce((s, r) => s + Number(r.realizedPnl ?? 0), 0);
  const unrealizedPnl = openTrades.reduce((s, r) => s + Number((r.metadata as Record<string, unknown> | null)?.unrealizedPnl ?? 0), 0);
  const fees = executions.reduce((s, r) => s + Number(r.fee ?? 0), 0);

  let paperCashAfter: Record<string, number> | null = input.paperCashBefore ?? null;
  let paperCashSource: PaperCampaignSummary["paperCashSource"] = "unavailable";
  let accountingUnavailableReason: string | null = null;
  try {
    await ensurePaperAccountInitialized(input.userId);
    paperCashAfter = await readPaperCashBalances(input.userId);
    paperCashSource = "app_setting";
  } catch (error) {
    accountingUnavailableReason = error instanceof Error ? error.message : String(error);
  }

  const funnel: Record<string, number> = {
    discovered: rounds.length,
    round_selected: selectedRounds.length,
    handoff_valid: handoffValid,
    ai_buy: aiBuy,
    ai_no_trade: aiNoTrade,
    execution_rejected: executionRejected,
    risk_rejected: riskRejected,
    order_requested: orders.length,
    paper_order_created: orders.filter((o) => o.status !== "CANCELED").length,
    paper_filled: executions.length,
    position_opened: openTrades.length + closedTrades.length,
    position_closed: closedTrades.length,
  };

  return {
    campaignId: input.campaignId,
    jobId: input.jobId ?? null,
    startedAt: input.startedAt ?? job?.startedAt?.toISOString() ?? null,
    endedAt: input.endedAt ?? null,
    rounds: rounds.length,
    discovered: rounds.length,
    selected: selectedRounds.length,
    handoffValid,
    aiBuy,
    aiNoTrade,
    executionRejected,
    riskRejected,
    ordersCreated: orders.length,
    fills: executions.length,
    tradesOpened: openTrades.length + closedTrades.length,
    tradesClosed: closedTrades.length,
    paperCashBefore: input.paperCashBefore ?? null,
    paperCashAfter,
    paperCashSource,
    realizedPnl,
    unrealizedPnl,
    fees,
    maxDrawdown: null,
    terminalReasons,
    funnel,
    accountingUnavailableReason,
  };
}
