import { describe, expect, it } from "vitest";
import { isTransientPrismaConnectivityError } from "@/src/server/db/transient-prisma-error";

describe("transient prisma connectivity", () => {
  it("classifies P2024 pool timeout as transient", () => {
    expect(isTransientPrismaConnectivityError({ code: "P2024", message: "Timed out fetching a new connection from the connection pool" })).toBe(true);
  });

  it("classifies connection pool timeout message as transient", () => {
    expect(isTransientPrismaConnectivityError(new Error("connection pool timeout"))).toBe(true);
  });

  it("does not classify business logic errors as transient", () => {
    expect(isTransientPrismaConnectivityError(new Error("Unique constraint failed"))).toBe(false);
  });
});
