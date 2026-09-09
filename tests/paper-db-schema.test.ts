import { expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(async () => [{ ok: 1 }]), autoRoundJob: { count: vi.fn(async () => { throw new Error("AutoRoundJob table missing"); }) } }));
vi.mock("@/src/server/db/prisma", () => ({ prisma: db }));
import { validatePaperDbHealth } from "@/src/server/forensics/db-health.service";
it("does not declare paper DB healthy when the application schema is missing", async () => {
  await expect(validatePaperDbHealth()).rejects.toMatchObject({ code: "PAPER_DB_UNAVAILABLE", message: "AutoRoundJob table missing" });
});
