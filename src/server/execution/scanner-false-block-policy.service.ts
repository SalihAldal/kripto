export type ScannerBlockClass =
  | "TRUE_MARKET_QUALITY"
  | "MISSING_DATA"
  | "STALE_DATA"
  | "DEFAULT_VALUE"
  | "DUPLICATE_DOWNSTREAM_SIGNAL"
  | "UNKNOWN";

export type ScannerPolicyDecision = {
  action: "REJECT" | "DEFER";
  classes: ScannerBlockClass[];
  reasonCodes: string[];
};

function isMissingLike(text: string) {
  return /missing|unknown|unavailable|not available|degraded/i.test(text);
}

function isStaleLike(text: string) {
  return /stale|gecik|old snapshot|lag/i.test(text);
}

function isDefaultLike(text: string) {
  return /default|fallback|0\.00x < 1\.05x/i.test(text);
}

function isDuplicateLike(text: string) {
  return /confidence .*<|scanner .*<|scanner confidence .*<|composite score under threshold/i.test(text);
}

function isTrueQualityLike(text: string) {
  return /kalite skoru|ema trend|hacim yetersiz|pump risk|volatility|risk .* >|dump tespiti|sahte hour-only/i.test(text);
}

export function classifyScannerReason(reason: string): ScannerBlockClass {
  if (isMissingLike(reason)) return "MISSING_DATA";
  if (isStaleLike(reason)) return "STALE_DATA";
  if (isDefaultLike(reason)) return "DEFAULT_VALUE";
  if (isDuplicateLike(reason)) return "DUPLICATE_DOWNSTREAM_SIGNAL";
  if (isTrueQualityLike(reason)) return "TRUE_MARKET_QUALITY";
  return "UNKNOWN";
}

export function evaluateScannerPolicy(input: {
  blockers: string[];
  hasShortTelemetry: boolean;
  hasVolumeTelemetry: boolean;
  staleShortTelemetry: boolean;
}) {
  const classes = input.blockers.map(classifyScannerReason);
  const reasonCodes: string[] = [];
  if (!input.hasShortTelemetry) reasonCodes.push("SHORT_TELEMETRY_MISSING");
  if (input.staleShortTelemetry) reasonCodes.push("SHORT_TELEMETRY_STALE");
  if (!input.hasVolumeTelemetry) reasonCodes.push("VOLUME_TELEMETRY_MISSING");
  const onlyDataOrDuplicate =
    classes.length > 0 &&
    classes.every((c) =>
      c === "MISSING_DATA" ||
      c === "STALE_DATA" ||
      c === "DEFAULT_VALUE" ||
      c === "DUPLICATE_DOWNSTREAM_SIGNAL" ||
      c === "UNKNOWN",
    );
  return {
    action: onlyDataOrDuplicate ? "DEFER" : "REJECT",
    classes,
    reasonCodes,
  } satisfies ScannerPolicyDecision;
}

export function classifyAiNoResponseScope(input: {
  rejectReason: string;
  hasHealthyProvider: boolean;
  providerFailureCount: number;
}) {
  const reason = input.rejectReason.toUpperCase();
  if (reason.includes("AI_PROVIDER_DEGRADED")) return "CANDIDATE_LOCAL_FAILURE";
  if (!reason.includes("AI_NO_RESPONSE")) return "NONE";
  if (input.hasHealthyProvider) return "CANDIDATE_LOCAL_FAILURE";
  if (input.providerFailureCount >= 2) return "ROUND_GLOBAL_FAILURE";
  return "CANDIDATE_LOCAL_FAILURE";
}

