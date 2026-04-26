import { randomUUID } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { ExecutionStatusEvent } from "@/src/server/execution/types";

type TradeLifecycleRow = ExecutionStatusEvent & {
  id: string;
  orderId?: string;
  positionId?: string;
};

function toJson(value: unknown) {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function parseContext(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}

function extractIds(context?: Record<string, unknown>) {
  const orderIdRaw =
    context?.orderId ??
    context?.closeOrderId ??
    context?.pendingOrderId ??
    context?.exchangeOrderId;
  const positionIdRaw = context?.positionId;
  return {
    orderId: typeof orderIdRaw === "string" && orderIdRaw.length > 0 ? orderIdRaw : undefined,
    positionId: typeof positionIdRaw === "string" && positionIdRaw.length > 0 ? positionIdRaw : undefined,
  };
}

export async function addTradeLifecycleEvent(event: ExecutionStatusEvent) {
  const context = event.context ?? undefined;
  const ids = extractIds(context);
  const id = randomUUID();

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "TradeLifecycleEvent"
      ("id","executionId","symbol","stage","status","level","message","orderId","positionId","context","createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamp)
    `,
    id,
    event.executionId ?? null,
    event.symbol ?? null,
    event.stage,
    event.status,
    event.level ?? null,
    event.message,
    ids.orderId ?? null,
    ids.positionId ?? null,
    toJson(context),
    new Date(event.createdAt).toISOString(),
  );
}

export async function listTradeLifecycleEvents(input?: {
  limit?: number;
  offset?: number;
  executionId?: string;
  symbol?: string;
  orderId?: string;
}) {
  const limit = Math.max(1, Math.min(300, Number(input?.limit ?? 120)));
  const offset = Math.max(0, Number(input?.offset ?? 0));
  const values: Array<string | number> = [];
  const where: string[] = [];

  if (input?.executionId) {
    values.push(input.executionId);
    where.push(`"executionId" = $${values.length}`);
  }
  if (input?.symbol) {
    values.push(input.symbol.toUpperCase());
    where.push(`UPPER("symbol") = $${values.length}`);
  }
  if (input?.orderId) {
    values.push(input.orderId);
    where.push(`"orderId" = $${values.length}`);
  }

  values.push(limit);
  const limitRef = `$${values.length}`;
  values.push(offset);
  const offsetRef = `$${values.length}`;

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        "id","executionId","symbol","stage","status","level","message","orderId","positionId","context","createdAt"
      FROM "TradeLifecycleEvent"
      ${whereSql}
      ORDER BY "createdAt" DESC
      LIMIT ${limitRef}
      OFFSET ${offsetRef}
    `,
    ...values,
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id ?? ""),
    executionId: row.executionId ? String(row.executionId) : undefined,
    symbol: row.symbol ? String(row.symbol) : undefined,
    stage: String(row.stage ?? ""),
    status: String(row.status ?? "RUNNING") as ExecutionStatusEvent["status"],
    level: row.level ? (String(row.level) as ExecutionStatusEvent["level"]) : undefined,
    message: String(row.message ?? ""),
    orderId: row.orderId ? String(row.orderId) : undefined,
    positionId: row.positionId ? String(row.positionId) : undefined,
    context: parseContext(row.context),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(String(row.createdAt ?? Date.now())).toISOString(),
  })) satisfies TradeLifecycleRow[];
}
