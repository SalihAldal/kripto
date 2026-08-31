import { env } from "@/lib/config";

/** Paper metric-pump lane priority gate — must match isPaperApprovedLane paper branch. */
export const PAPER_TOP_GAINER_PRIORITY_THRESHOLD = 50;

/** Live metric-pump lane priority gate. */
export const LIVE_TOP_GAINER_PRIORITY_THRESHOLD = 70;

export function isPaperExecutionContext(usePaperProfile?: boolean): boolean {
  return Boolean(usePaperProfile) || env.EXECUTION_MODE === "paper";
}

export function resolveTopGainerPumpPriorityThreshold(usePaperProfile?: boolean): number {
  const paper =
    usePaperProfile !== undefined ? usePaperProfile : isPaperExecutionContext();
  return paper ? PAPER_TOP_GAINER_PRIORITY_THRESHOLD : LIVE_TOP_GAINER_PRIORITY_THRESHOLD;
}

export function isTopGainerPumpSignal(
  meta: Record<string, unknown>,
  usePaperProfile?: boolean,
): boolean {
  const priorityThreshold = resolveTopGainerPumpPriorityThreshold(usePaperProfile);
  return (
    Boolean(meta.topGainerDiscovery ?? false) ||
    Boolean(meta.pumpEarlyConfirmed ?? false) ||
    Boolean(meta.pumpContinuationMode ?? false) ||
    Boolean(meta.pumpIntradaySpike ?? false) ||
    Number(meta.topGainerPriorityScore ?? 0) >= priorityThreshold
  );
}
