import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLatestSnapshot, getSnapshotTimeline } from "@/src/server/market-intelligence/market-intelligence.repository";
import { parseReplayQuery } from "@/src/server/market-intelligence/snapshot-replay.service";
import type { SnapshotInterval } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const params = request.nextUrl.searchParams;
    const mode = params.get("mode") ?? "latest";
    const symbol = params.get("symbol") ?? "BTCUSDT";
    const interval = (params.get("interval") ?? "M1") as SnapshotInterval;
    const regime = params.get("regime");

    if (mode === "replay") {
      const date = params.get("date") ?? "2026-07-02";
      const time = params.get("time") ?? "14:35";
      return apiOkFromRequest(request, await parseReplayQuery({ symbol, date, time }));
    }

    if (mode === "timeline") {
      const since = params.get("since") ? new Date(String(params.get("since"))) : undefined;
      const until = params.get("until") ? new Date(String(params.get("until"))) : undefined;
      return apiOkFromRequest(
        request,
        await getSnapshotTimeline({ symbol, interval, since, until, limit: Number(params.get("limit") ?? 500) }),
      );
    }

    if (mode === "health") {
      const row = await getLatestSnapshot(symbol, interval);
      return apiOkFromRequest(request, row?.health ?? null);
    }

    if (mode === "trend") {
      const rows = await prisma.marketTrend.findMany({
        where: { symbol: symbol.toUpperCase() },
        orderBy: { createdAt: "desc" },
        take: Number(params.get("limit") ?? 100),
      });
      return apiOkFromRequest(request, rows);
    }

    if (mode === "momentum") {
      const rows = await prisma.marketMomentum.findMany({
        where: { symbol: symbol.toUpperCase() },
        orderBy: { createdAt: "desc" },
        take: Number(params.get("limit") ?? 100),
      });
      return apiOkFromRequest(request, rows);
    }

    if (mode === "by-regime") {
      const rows = await prisma.marketSnapshot.findMany({
        where: { regime: regime as never, symbol: symbol.toUpperCase() },
        orderBy: { snapshotAt: "desc" },
        take: Number(params.get("limit") ?? 100),
        include: { health: true, trend: true, momentum: true },
      });
      return apiOkFromRequest(request, rows);
    }

    if (mode === "historical") {
      const at = params.get("at") ? new Date(String(params.get("at"))) : undefined;
      const rows = await getSnapshotTimeline({
        symbol,
        interval,
        since: at ? new Date(at.getTime() - 60_000) : undefined,
        until: at ? new Date(at.getTime() + 60_000) : undefined,
        limit: 5,
      });
      return apiOkFromRequest(request, rows[0] ?? null);
    }

    return apiOkFromRequest(request, await getLatestSnapshot(symbol, interval));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
