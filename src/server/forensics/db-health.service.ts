import { prisma } from "@/src/server/db/prisma";

export class PaperDbUnavailableError extends Error {
  code = "PAPER_DB_UNAVAILABLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "PaperDbUnavailableError";
  }
}

export async function validatePaperDbHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.autoRoundJob.count({ take: 1 }).catch(() => 0);
    return { ok: true as const };
  } catch (error) {
    throw new PaperDbUnavailableError((error as Error).message || "Database unavailable");
  }
}
