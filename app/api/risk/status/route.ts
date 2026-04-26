import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRiskStatus } from "@/src/server/risk";

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    const data = await getRiskStatus();
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
