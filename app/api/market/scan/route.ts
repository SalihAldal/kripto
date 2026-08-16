import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOk, enforceRateLimit } from "@/lib/api";
import { env } from "@/lib/config";
import { ensureScannerWorkerStarted, getScannerWorkerSnapshot, runScannerPipeline, toScannerApiRows } from "@/src/server/scanner";
import type { ScannerPipelineResult } from "@/src/types/scanner";

const EMPTY_SCAN_RESULT: ScannerPipelineResult = {
  scannedAt: new Date(0).toISOString(),
  totalSymbols: 0,
  qualifiedSymbols: 0,
  aiEvaluatedSymbols: 0,
  candidates: [],
};

const SNAPSHOT_STALE_MS = 45_000;
const MANUAL_SCAN_MIN_INTERVAL_MS = 20_000;
const UI_SCAN_MAX_WAIT_MS = 25_000;
let inFlightScan: Promise<ScannerPipelineResult> | null = null;
let lastManualScanAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadFreshScan(withAi: boolean) {
  if (inFlightScan) {
    const attached = await awaitWithTimeout(inFlightScan, UI_SCAN_MAX_WAIT_MS);
    if (attached) return attached;
    const snapshot = getScannerWorkerSnapshot();
    if (snapshot.detailed && snapshot.detailed.candidates.length > 0) return snapshot.detailed;
    return EMPTY_SCAN_RESULT;
  }
  inFlightScan = runScannerPipeline(undefined, {
    includeAi: withAi,
    persist: false,
    persistRejected: false,
    runtime: {
      attachIfRunning: true,
      attachMaxWaitMs: UI_SCAN_MAX_WAIT_MS,
      preferLastResultOnAttachTimeout: true,
      maxCycleSec: Math.min(90, env.AUTO_ROUND_SCANNER_MAX_CYCLE_SEC ?? 90),
    },
  });
  try {
    const result = (await awaitWithTimeout(inFlightScan, UI_SCAN_MAX_WAIT_MS)) ?? EMPTY_SCAN_RESULT;
    if (result.totalSymbols > 0) lastManualScanAt = Date.now();
    return result;
  } finally {
    inFlightScan = null;
  }
}

export async function GET(request: NextRequest) {
  try {
    ensureScannerWorkerStarted();
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const detailed = request.nextUrl.searchParams.get("detailed") === "1";
    const withAi = request.nextUrl.searchParams.get("withAi") !== "0";
    const snapshot = getScannerWorkerSnapshot();
    const snapshotAgeMs = snapshot.updatedAt ? Date.now() - new Date(snapshot.updatedAt).getTime() : Number.POSITIVE_INFINITY;
    const stale = !snapshot.updatedAt || snapshotAgeMs > SNAPSHOT_STALE_MS;
    const workerMode = env.SCANNER_WORKER_ENABLED;
    const recentlyScanned = Date.now() - lastManualScanAt < MANUAL_SCAN_MIN_INTERVAL_MS;
    if ((snapshot.rows.length === 0 || stale) && !detailed) {
      if (workerMode && snapshot.rows.length > 0) {
        // Worker mode: prefer stale snapshot instead of hammering exchange on every UI refresh.
        return apiOk(snapshot.rows);
      }
      if (recentlyScanned && snapshot.rows.length > 0) {
        return apiOk(snapshot.rows);
      }
      const fresh = await loadFreshScan(withAi);
      return apiOk(toScannerApiRows(fresh));
    }
    if (detailed && (!snapshot.detailed || stale)) {
      if (workerMode && snapshot.detailed) return apiOk(snapshot.detailed);
      if (recentlyScanned && snapshot.detailed) return apiOk(snapshot.detailed);
      const freshDetailed = await loadFreshScan(withAi);
      return apiOk(freshDetailed ?? EMPTY_SCAN_RESULT);
    }
    if (detailed) return apiOk(snapshot.detailed ?? EMPTY_SCAN_RESULT);
    return apiOk(snapshot.rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
