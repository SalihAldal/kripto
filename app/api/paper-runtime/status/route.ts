import { apiOk } from "@/lib/api";
import { getPaperRuntimeEngine } from "@/src/server/paper-runtime/paper-engine";
import { assertLiveOrderSubmissionAllowed } from "@/src/server/paper-runtime/live-lock";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";

export async function GET() {
  const engine = getPaperRuntimeEngine();
  const lock = assertLiveOrderSubmissionAllowed();
  return apiOk({
    owner: "paper-runtime",
    adapter: resolveExecutionAdapter("paper").kind,
    liveLock: lock,
    performance: engine.performance(),
    open: engine.getOpen().length,
    closed: engine.getClosed().length,
    rejections: engine.getRejections(),
    ordersDisabledOnLive: engine.ordersDisabledOnLive,
  });
}
