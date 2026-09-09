import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const DEFAULT_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
export type Fix02DisposablePostgres = { dbName: string; databaseUrl: string; host: string; port: number; cleanup: () => Promise<void> };

function parseAdminUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("FIX02_INVALID_ADMIN_URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("FIX02_INVALID_ADMIN_URL");
  return url;
}
function assertDisposableName(name: string) {
  if (!/^kripto_fix02_[a-z0-9_]+$/.test(name)) throw new Error("FIX02_FAIL_CLOSED: requires a generated disposable database name");
}
async function adminSql(adminUrl: string, sql: string) {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try { await client.$executeRawUnsafe(sql); } finally { await client.$disconnect(); }
}
export function resetPrismaClientForFix02Tests() {
  const g = globalThis as typeof globalThis & { __prisma__?: unknown };
  delete g.__prisma__;
}
export async function createFix02DisposablePostgres(): Promise<Fix02DisposablePostgres> {
  const admin = parseAdminUrl(process.env.FIX02_PG_ADMIN_URL ?? DEFAULT_ADMIN_URL);
  const dbName = `kripto_fix02_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  assertDisposableName(dbName);
  const target = new URL(admin); target.pathname = `/${dbName}`;
  const databaseUrl = target.toString(), adminUrl = admin.toString();
  const drop = () => adminSql(adminUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  try { await adminSql(adminUrl, `CREATE DATABASE "${dbName}";`); }
  catch { throw new Error("FIX02_POSTGRES_UNAVAILABLE: check FIX02_PG_ADMIN_URL and PostgreSQL reachability"); }
  try {
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      stdio: "pipe", env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  } catch (error) {
    await drop().catch(() => undefined);
    throw error;
  }
  const previousUrl = process.env.DATABASE_URL, previousTestUrl = process.env.FIX02_TEST_DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  process.env.FIX02_TEST_DATABASE_URL = databaseUrl;
  resetPrismaClientForFix02Tests();
  return { dbName, databaseUrl, host: admin.hostname, port: Number(admin.port || 5432), cleanup: async () => {
    try { await drop(); } finally {
      if (process.env.DATABASE_URL === databaseUrl) {
        if (previousUrl == null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
      }
      if (process.env.FIX02_TEST_DATABASE_URL === databaseUrl) {
        if (previousTestUrl == null) delete process.env.FIX02_TEST_DATABASE_URL; else process.env.FIX02_TEST_DATABASE_URL = previousTestUrl;
      }
    }
  } };
}
export function requireFix02DatabaseUrl() {
  const value = process.env.FIX02_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const target = parseAdminUrl(value);
  assertDisposableName(decodeURIComponent(target.pathname.slice(1)));
  return value;
}
