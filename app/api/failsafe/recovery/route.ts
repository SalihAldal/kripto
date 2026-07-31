import { NextRequest } from "next/server";
import { apiError, apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { runRestartRecovery } from "@/src/server/recovery/failsafe-recovery.service";

export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) return apiError("Unauthorized.", 401);
    const data = await runRestartRecovery();
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
