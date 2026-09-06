import { execSync } from "node:child_process";
import crypto from "node:crypto";

const FORBIDDEN_DB_NAMES = new Set(["kinetic", "postgres", "template0", "template1"]);
const DEFAULT_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const DEFAULT_CONTAINER = "kripto-main-postgres-1";

export type Fix02DisposablePostgres = {
  dbName: string;
  databaseUrl: string;
  host: string;
  port: number;
  cleanup: () => Promise<void>;
};

function parseHostPort(adminUrl: string) {
  const match = adminUrl.match(/@([^:/]+):(\d+)\//);
  return {
    host: match?.[1] ?? "127.0.0.1",
    port: Number(match?.[2] ?? 5432),
  };
}

function assertFailClosedTarget(dbName: string, databaseUrl: string) {
  if (FORBIDDEN_DB_NAMES.has(dbName)) {
    throw new Error(`FIX02_FAIL_CLOSED: forbidden database name ${dbName}`);
  }
  if (!dbName.startsWith("kripto_fix02_")) {
    throw new Error(`FIX02_FAIL_CLOSED: database must use kripto_fix02_ prefix (${dbName})`);
  }
  if (databaseUrl.includes("/kinetic")) {
    throw new Error("FIX02_FAIL_CLOSED: production kinetic database target blocked");
  }
}

function runDockerPsql(sql: string, db = "postgres") {
  execSync(`docker exec ${DEFAULT_CONTAINER} psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`, {
    stdio: "pipe",
  });
}

function runMigrate(databaseUrl: string) {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}

export function resetPrismaClientForFix02Tests() {
  const g = globalThis as typeof globalThis & { __prisma__?: unknown };
  delete g.__prisma__;
}

export async function createFix02DisposablePostgres(): Promise<Fix02DisposablePostgres> {
  const adminUrl = process.env.FIX02_PG_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const { host, port } = parseHostPort(adminUrl);
  const dbName = `kripto_fix02_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const databaseUrl = `postgresql://postgres:postgres@${host}:${port}/${dbName}`;
  assertFailClosedTarget(dbName, databaseUrl);

  try {
    runDockerPsql(`CREATE DATABASE "${dbName}";`);
  } catch (error) {
    throw new Error(`FIX02_POSTGRES_UNAVAILABLE:${(error as Error).message}`);
  }

  runMigrate(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.FIX02_TEST_DATABASE_URL = databaseUrl;
  resetPrismaClientForFix02Tests();

  return {
    dbName,
    databaseUrl,
    host,
    port,
    cleanup: async () => {
      try {
        runDockerPsql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      } catch {
        // best-effort cleanup for disposable test DB only
      }
    },
  };
}

export function requireFix02DatabaseUrl() {
  const url = process.env.FIX02_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (!url.includes("kripto_fix02_")) {
    throw new Error("FIX02_FAIL_CLOSED: integration test requires disposable kripto_fix02_* database URL");
  }
  return url;
}
