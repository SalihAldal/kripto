import { prisma } from "@/src/server/db/prisma";
import { listOpenPositionsByUser } from "@/src/server/repositories/execution.repository";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

export async function validatePositionSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const openPositions = await listOpenPositionsByUser(input.userId).catch(() => []);
  const symbolPositions = openPositions.filter((row) => row.tradingPair.symbol.toUpperCase() === input.symbol.toUpperCase());

  if (input.side === "BUY") {
    if (!input.allowMultipleOpenPositions && openPositions.length > 0 && symbolPositions.length === 0) {
      reasons.push("Already holding another asset — conflicting position");
    }
    if (symbolPositions.length > 0) {
      reasons.push("Already holding asset — duplicate BUY blocked");
    }
  }

  if (input.side === "SELL" && symbolPositions.length === 0) {
    reasons.push("No open position to sell");
  }

  const pendingOrders = await prisma.tradeOrder.findMany({
    where: {
      userId: input.userId,
      status: { in: ["NEW", "PARTIALLY_FILLED"] },
      tradingPair: { symbol: input.symbol.toUpperCase() },
    },
    take: 10,
  });
  const conflicting = pendingOrders.filter((row) => row.side === input.side);
  if (conflicting.length > 0) {
    reasons.push("Pending conflicting orders exist");
  }

  return {
    stage: "POSITION",
    passed: reasons.length === 0,
    reasons,
    metadata: {
      openPositionCount: openPositions.length,
      symbolPositionCount: symbolPositions.length,
      pendingOrderCount: pendingOrders.length,
    },
  };
}
