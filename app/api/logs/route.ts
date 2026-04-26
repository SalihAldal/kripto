import { NextRequest } from "next/server";
import { apiOk, enforceRateLimit } from "@/lib/api";
import { listLogs } from "@/services/log.service";
import { listSystemLogs } from "@/src/server/repositories/log.repository";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const [memory, db] = await Promise.all([
    Promise.resolve(listLogs(120)),
    listSystemLogs({
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 200),
      actionType: request.nextUrl.searchParams.get("actionType") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      symbol: request.nextUrl.searchParams.get("symbol") ?? undefined,
      hasError: request.nextUrl.searchParams.get("hasError") === "1",
    }).catch(() => []),
  ]);
  const fromDb = db.map((row) => ({
    id: row.id,
    level: row.level,
    message: `[${row.source}] ${row.message}`,
    timestamp: row.createdAt.toISOString(),
    context: row.context,
  }));
  const symbolFilter = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const stageFilter = request.nextUrl.searchParams.get("stage")?.trim().toLowerCase() ?? "";
  const merged = [...memory, ...fromDb]
    .filter((row) => {
      if (!symbolFilter) return true;
      return row.message.toUpperCase().includes(symbolFilter);
    })
    .filter((row) => {
      if (!stageFilter) return true;
      return row.message.toLowerCase().includes(stageFilter);
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, Number(request.nextUrl.searchParams.get("limit") ?? 200));

  return apiOk(merged);
}
