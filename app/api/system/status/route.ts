import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";
import { getRiskStatus } from "@/src/server/risk";
import { listHeartbeats } from "@/src/server/observability/heartbeat";
import { ensureOpenPositionMonitors } from "@/src/server/execution/execution-orchestrator.service";
import { getSafeModeState } from "@/src/server/recovery/failsafe-recovery.service";

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const { user } = await getRuntimeExecutionContext();
    await ensureOpenPositionMonitors(user.id).catch(() => null);
    const [history, risk] = await Promise.all([
      listTradeHistory({ userId: user.id, limit: 120 }),
      getRiskStatus(user.id),
    ]);
    const safeMode = await getSafeModeState(user.id).catch(() => null);
    const openTrades = history.filter((x) => x.position?.status === "OPEN");
    const closedTrades = history.filter((x) => x.position?.status === "CLOSED");
    const totalPnl = risk.daily.netPnl24h;
    const paused = risk.paused.paused;

    return apiOkFromRequest(request, {
      status: paused ? "PAUSED" : "OPERATIONAL",
      paused,
      pauseReason: risk.paused.reason ?? null,
      pauseUntil: risk.paused.until ?? null,
      aiModels: 3,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      riskGuard: "ACTIVE",
      emergencyBrakeEnabled: risk.config?.emergencyBrakeEnabled ?? true,
      autoTradeEnabled: !paused,
      totalPnl: Number(totalPnl.toFixed(2)),
      dailyLossAbs: risk.daily.lossAmountAbs,
      consecutiveLosses: risk.consecutiveLosses,
      heartbeat: listHeartbeats(),
      safeMode,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
