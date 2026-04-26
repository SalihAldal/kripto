import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";
import { listBacktestHistory, runBacktest } from "@/src/server/simulation/backtest.service";

const runBacktestSchema = z.object({
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  symbols: z.array(z.string().min(5)).min(1).max(20),
  strategy: z.enum(["balanced", "aggressive", "conservative"]).default("balanced"),
  aiEnabled: z.boolean().default(true),
  tpPercents: z.array(z.number().positive()).min(1).max(8),
  slPercents: z.array(z.number().positive()).min(1).max(8),
});

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER", "VIEWER"],
    });
    if (!access.ok) return access.response;
    const history = await listBacktestHistory(access.user.id);
    return apiOkFromRequest(request, { history });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
      requireConfirmation: true,
    });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json());
    const parsed = runBacktestSchema.safeParse(payload);
    if (!parsed.success) {
      return apiError(tr ? "Backtest payload gecersiz." : "Invalid backtest payload.", 400);
    }

    const result = await runBacktest({
      userId: access.user.id,
      ...parsed.data,
    });
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "BacktestRun",
      entityId: result.id,
      newValues: {
        range: result.range,
        symbols: result.symbols,
        strategy: result.strategy,
        aiEnabled: result.aiEnabled,
      },
      metadata: {
        tradeCount: result.metrics.tradeCount,
        totalPnl: result.metrics.totalPnl,
      },
    }).catch(() => null);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
