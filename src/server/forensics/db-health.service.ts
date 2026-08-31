import { prisma } from "@/src/server/db/prisma";
import type { ValidationDbReadiness } from "@/src/server/forensics/forensic.types";

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

const REQUIRED_VALIDATION_TABLES = [
  "AutoRoundJob",
  "AutoRoundRun",
  "ShadowCandidateOutcome",
  "ShadowMoverEvent",
  "PaperTrade",
  "PaperExecution",
  "PaperPortfolio",
  "Position",
  "TradeExecution",
  "TradeOrder",
  "TradeLifecycleEvent",
] as const;

export async function assertValidationDatabaseReady(): Promise<ValidationDbReadiness> {
  const checkedAt = new Date().toISOString();
  const databaseUrlConfigured = Boolean(String(process.env.DATABASE_URL ?? "").trim());
  if (!databaseUrlConfigured) {
    return {
      status: "FAIL",
      reasonCode: "DATABASE_URL_MISSING",
      reasonDetail: "DATABASE_URL is not configured",
      checkedAt,
      databaseUrlConfigured,
      requiredTables: REQUIRED_VALIDATION_TABLES.map((table) => ({ table, exists: false })),
      missingTables: [...REQUIRED_VALIDATION_TABLES],
      migrationTablePresent: false,
      latestMigration: null,
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const tableRows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const existing = new Set(tableRows.map((row) => row.table_name));
    const requiredTables = REQUIRED_VALIDATION_TABLES.map((table) => ({ table, exists: existing.has(table) }));
    const missingTables = requiredTables.filter((row) => !row.exists).map((row) => row.table);
    const migrationTablePresent = existing.has("_prisma_migrations");

    let latestMigration: string | null = null;
    if (migrationTablePresent) {
      const migrationRows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
      );
      latestMigration = migrationRows[0]?.migration_name ?? null;
    }

    if (missingTables.length > 0) {
      return {
        status: "FAIL",
        reasonCode: "DB_REQUIRED_TABLES_MISSING",
        reasonDetail: `Missing required tables: ${missingTables.join(", ")}`,
        checkedAt,
        databaseUrlConfigured,
        requiredTables,
        missingTables,
        migrationTablePresent,
        latestMigration,
      };
    }

    if (!migrationTablePresent) {
      return {
        status: "FAIL",
        reasonCode: "PRISMA_MIGRATIONS_TABLE_MISSING",
        reasonDetail: "Required table _prisma_migrations is missing",
        checkedAt,
        databaseUrlConfigured,
        requiredTables,
        missingTables,
        migrationTablePresent,
        latestMigration,
      };
    }

    return {
      status: "PASS",
      reasonCode: "DB_READY",
      reasonDetail: "Database reachable and required validation tables are present",
      checkedAt,
      databaseUrlConfigured,
      requiredTables,
      missingTables,
      migrationTablePresent,
      latestMigration,
    };
  } catch (error) {
    return {
      status: "FAIL",
      reasonCode: "DB_CONNECTIVITY_ERROR",
      reasonDetail: (error as Error).message,
      checkedAt,
      databaseUrlConfigured,
      requiredTables: REQUIRED_VALIDATION_TABLES.map((table) => ({ table, exists: false })),
      missingTables: [...REQUIRED_VALIDATION_TABLES],
      migrationTablePresent: false,
      latestMigration: null,
    };
  }
}
