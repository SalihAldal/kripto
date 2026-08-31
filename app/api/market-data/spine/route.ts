import { apiOk } from "@/lib/api";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getSharedRestLimiter } from "@/src/server/market-data/spine/shared-rest-limiter";
import { getPublicMarketRestCallsPerMinute, countHotPathPublicMarketRestCalls } from "@/src/server/market-data/spine/rest-call-audit";

export async function GET() {
  const daemon = getMarketDataDaemon();
  const telemetry = daemon.telemetry();
  const limiter = await getSharedRestLimiter().snapshot();
  return apiOk({
    owner: "market-data-daemon",
    running: daemon.running,
    telemetry: {
      ...telemetry,
      restCallsPerMin: getPublicMarketRestCallsPerMinute(),
      hotPathRestCalls: countHotPathPublicMarketRestCalls(Date.now() - 60_000),
      estimatedWeight: limiter.estimatedWeight,
      actualWeight: limiter.actualWeight,
      rateLimited429: limiter.rateLimited429,
      banned418: limiter.banned418,
    },
  });
}
