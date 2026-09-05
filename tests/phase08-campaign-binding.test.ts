import { describe, expect, it } from "vitest";
import { buildCampaignId } from "@/src/server/forensics/campaign-identity.service";
import { resolveSettlementStatus } from "@/src/server/shadow-outcome/finalizer.service";
import { detectMoverEvents } from "@/src/server/shadow-outcome/mover-truth";
import { validateCheckpointSchema } from "@/src/server/forensics/checkpoint-schema.service";

const T0 = 1_700_000_000_000;

function ramp(from: number, to: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = T0 + i * 60_000;
    const price = from + ((to - from) * i) / Math.max(1, n - 1);
    return { t, price, high: price, low: price };
  });
}

describe("phase08 campaign binding and telemetry guards", () => {
  it("builds immutable campaignId from job identity", () => {
    expect(buildCampaignId({ jobId: "job-123" })).toBe("cmp:job-123");
    expect(buildCampaignId({ campaignId: "cmp:fixed" })).toBe("cmp:fixed");
  });

  it("settlement returns NO_MEASUREMENT_DATA for zero eligible candidates", () => {
    const status = resolveSettlementStatus({
      eligibleCandidates: 0,
      m60Pending: 0,
      invalid: 0,
      historyUnavailable: 0,
    });
    expect(status).toBe("NO_MEASUREMENT_DATA");
  });

  it("mover thresholds are percent-scaled (1 means +1%)", () => {
    const points = ramp(100, 101.2, 8);
    const events = detectMoverEvents({ symbol: "TRYTEST", points, now: points[points.length - 1]!.t });
    expect(events.some((row) => row.moveClass === 1)).toBe(true);
    expect(events.some((row) => row.moveClass === 2)).toBe(false);
  });

  it("checkpoint schema fails when mandatory fields are missing", () => {
    const check = validateCheckpointSchema({ runId: "r1", roundId: "1" });
    expect(check.ok).toBe(false);
    expect(check.code).toBe("CHECKPOINT_SCHEMA_INCOMPLETE");
    expect(check.missing.length).toBeGreaterThan(0);
  });
});
