import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sql: vi.fn().mockResolvedValue(0), disconnect: vi.fn().mockResolvedValue(undefined), migrate: vi.fn(), urls: [] as string[] }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.migrate }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  constructor(options: { datasources: { db: { url: string } } }) { mocks.urls.push(options.datasources.db.url); }
  $executeRawUnsafe = mocks.sql;
  $disconnect = mocks.disconnect;
} }));
import { createFix02DisposablePostgres, requireFix02DatabaseUrl } from "./helpers/fix02-disposable-postgres";
const original = { admin: process.env.FIX02_PG_ADMIN_URL, url: process.env.DATABASE_URL, test: process.env.FIX02_TEST_DATABASE_URL };
afterEach(() => {
  for (const [key, value] of Object.entries({ FIX02_PG_ADMIN_URL: original.admin, DATABASE_URL: original.url, FIX02_TEST_DATABASE_URL: original.test })) {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  vi.clearAllMocks(); mocks.urls.length = 0;
});
describe("disposable PostgreSQL target isolation", () => {
  it("preserves explicit connection settings, targets only the generated DB and restores env", async () => {
    process.env.FIX02_PG_ADMIN_URL = "postgresql://test_user:test_password@localhost:5438/postgres?sslmode=disable";
    process.env.DATABASE_URL = "previous";
    const db = await createFix02DisposablePostgres();
    const target = new URL(db.databaseUrl);
    expect(target.username).toBe("test_user"); expect(target.port).toBe("5438"); expect(target.searchParams.get("sslmode")).toBe("disable");
    expect(target.pathname).toBe(`/${db.dbName}`);
    expect(requireFix02DatabaseUrl()).toBe(db.databaseUrl);
    expect(mocks.migrate.mock.calls[0][1].slice(-2)).toEqual(["migrate", "deploy"]);
    await db.cleanup();
    expect(mocks.sql.mock.calls.map(c => c[0])).toEqual([`CREATE DATABASE "${db.dbName}";`, `DROP DATABASE IF EXISTS "${db.dbName}" WITH (FORCE);`]);
    expect(process.env.DATABASE_URL).toBe("previous");
  });
  it("does not accept a production DB with a disposable-looking query parameter", () => {
    process.env.FIX02_TEST_DATABASE_URL = "postgresql://u:p@localhost/kinetic?tag=kripto_fix02_fake";
    expect(requireFix02DatabaseUrl).toThrow("FIX02_FAIL_CLOSED");
  });
  it("drops a created test DB on migration failure without replacing the application URL", async () => {
    process.env.DATABASE_URL = "previous";
    mocks.migrate.mockImplementationOnce(() => { throw new Error("migration failed"); });
    await expect(createFix02DisposablePostgres()).rejects.toThrow("migration failed");
    expect(mocks.sql.mock.calls[1][0]).toMatch(/^DROP DATABASE IF EXISTS "kripto_fix02_/);
    expect(process.env.DATABASE_URL).toBe("previous");
  });
});
