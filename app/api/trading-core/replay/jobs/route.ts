import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  enqueueReplayJob,
  startDecisionReplayQueue,
  decisionReplayQueue,
} from "@/src/server/replay/decision-replay-queue";
import {
  ensureDecisionReplayWorkersStarted,
  getDecisionReplayWorkerState,
} from "@/src/server/replay/decision-replay-workers";
import { getReplayJobState } from "@/src/server/replay/decision-replay.repository";
import type { ReplayJobPayload } from "@/src/server/replay/replay.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const [workerState, queueStats, batchState, dailyState] = await Promise.all([
      Promise.resolve(getDecisionReplayWorkerState()),
      Promise.resolve(decisionReplayQueue.stats()),
      getReplayJobState("REPLAY_BATCH"),
      getReplayJobState("REPLAY_DAILY"),
    ]);

    return apiOkFromRequest(request, {
      workers: workerState,
      queue: queueStats,
      jobStates: { batch: batchState, daily: dailyState },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;

    const body = (await request.json()) as ReplayJobPayload & { startWorkers?: boolean };
    if (body.startWorkers) {
      ensureDecisionReplayWorkersStarted();
      startDecisionReplayQueue();
    }

    if (!body.type) {
      return apiErrorFromUnknown(new Error("job type required"));
    }

    const job = await enqueueReplayJob(body);
    return apiOkFromRequest(request, { queued: true, job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
