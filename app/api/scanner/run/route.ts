import { NextRequest } from "next/server";
import { apiOk, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { ensureScannerWorkerStarted, runScannerPipeline } from "@/src/server/scanner";

export async function POST(request: NextRequest) {
  ensureScannerWorkerStarted();
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!checkApiToken(request)) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await runScannerPipeline();
  return apiOk(result);
}
