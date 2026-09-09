import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveDatasetRoot } from "@/src/server/trade-decision-core";

describe("oi-try-spot-audited dataset", () => {
  it("dataset exists and manifest passes", () => {
    const root = resolveDatasetRoot();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as { datasetGate: string; days: number };
    expect(manifest.datasetGate).toBe("PASS");
    expect(manifest.days).toBeGreaterThanOrEqual(120);
  });
});
