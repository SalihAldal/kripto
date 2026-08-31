import { apiOk } from "@/lib/api";
import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { getDailyEdgeReport, getEdgeAnalytics } from "@/src/server/shadow-outcome/reports";

export async function GET() {
  const engine = getShadowOutcomeEngine();
  const rows = engine.getTracked();
  const movers = engine.getMoverEvents();
  return apiOk({
    owner: "shadow-outcome-engine",
    ordersDisabled: engine.ordersDisabled,
    telemetry: engine.getTelemetry(),
    daily: getDailyEdgeReport({ rows, movers }),
    analytics: getEdgeAnalytics(rows, movers),
  });
}
