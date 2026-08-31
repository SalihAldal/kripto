import { LIVE_ACK_PHRASE } from "@/src/server/paper-runtime/config";

export { LIVE_ACK_PHRASE } from "@/src/server/paper-runtime/config";
export type LiveLockResult = {
  allowed: false | true;
  live: boolean;
  reasons: string[];
};

function read(name: string) {
  return (process.env[name] ?? "").trim();
}

/**
 * EXECUTION_MODE=live alone is never enough.
 * All of: mode live, LIVE_TRADING_ENABLED=true, exact ACK phrase.
 */
export function assertLiveOrderSubmissionAllowed(input?: { executionMode?: string }): LiveLockResult {
  const mode = (input?.executionMode ?? process.env.EXECUTION_MODE ?? "dry-run").toLowerCase();
  if (mode !== "live") {
    return { allowed: false, live: false, reasons: ["MODE_NOT_LIVE"] };
  }
  const reasons: string[] = [];
  if (read("LIVE_TRADING_ENABLED").toLowerCase() !== "true") {
    reasons.push("LIVE_TRADING_ENABLED_NOT_TRUE");
  }
  if (read("LIVE_TRADING_ACK") !== LIVE_ACK_PHRASE) {
    reasons.push("LIVE_ACK_MISSING");
  }
  if (read("LIVE_TRADING_PLATFORM_ENABLED").toLowerCase() === "false") {
    reasons.push("LIVE_TRADING_PLATFORM_DISABLED");
  }
  return { allowed: reasons.length === 0, live: true, reasons };
}

export function rejectAccidentalLive(): LiveLockResult {
  return assertLiveOrderSubmissionAllowed();
}
