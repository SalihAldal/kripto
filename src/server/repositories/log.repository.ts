import type { LogLevel } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function listSystemLogs(input?: {
  level?: LogLevel;
  source?: string;
  limit?: number;
  actionType?: string;
  status?: string;
  symbol?: string;
  hasError?: boolean;
}) {
  const actionType = input?.actionType?.trim();
  const status = input?.status?.trim();
  const symbol = input?.symbol?.trim().toUpperCase();

  return prisma.systemLog.findMany({
    where: {
      level: input?.level,
      source: input?.source,
      AND: [
        actionType
          ? {
              context: {
                path: ["actionType"],
                equals: actionType,
              },
            }
          : {},
        status
          ? {
              context: {
                path: ["status"],
                equals: status,
              },
            }
          : {},
        symbol
          ? {
              context: {
                path: ["symbol"],
                equals: symbol,
              },
            }
          : {},
        input?.hasError
          ? {
              OR: [
                {
                  context: {
                    path: ["errorCode"],
                    not: null,
                  },
                },
                {
                  context: {
                    path: ["errorDetail"],
                    not: null,
                  },
                },
              ],
            }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: input?.limit ?? 200,
  });
}

export async function addSystemLog(data: { level: LogLevel; source: string; message: string; context?: unknown }) {
  return prisma.systemLog.create({
    data: {
      level: data.level,
      source: data.source,
      message: data.message,
      context: data.context as never,
    },
  });
}
