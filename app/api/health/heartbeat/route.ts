import { apiOk } from "@/lib/api";
import { getExchangeProvider } from "@/src/server/exchange";
import { listHeartbeats } from "@/src/server/observability/heartbeat";

export async function GET() {
  const provider = getExchangeProvider();
  return apiOk({
    status: "heartbeat",
    services: listHeartbeats(),
    exchangeEndpoints: provider.getPublicEndpointHealth(),
    timestamp: new Date().toISOString(),
  });
}
