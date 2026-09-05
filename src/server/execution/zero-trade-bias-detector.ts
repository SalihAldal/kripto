export type ZeroTradeBiasInput = {
  strongPositiveFixtures: number;
  totalMarketSequences: number;
  discovered: number;
  watching: number;
  hot: number;
  microAnalyzed: number;
  microConfirmed: number;
  executionReady: number;
  entryEnter: number;
  entryWait: number;
  entryReject: number;
  riskAllowed: number;
  riskRejected: number;
  executionAllowed: number;
  executionRejected: number;
  paperOpened: number;
  paperClosed: number;
  firstBlockerDistribution: Record<string, number>;
};

export type ZeroTradeBiasResult = {
  status: "PASS" | "FAIL";
  firstLossStage: "DISCOVERY" | "HOT" | "MICRO" | "ENTRY" | "RISK" | "EXECUTION" | "PERSISTENCE" | "UNKNOWN";
  unknownBlockerCount: number;
  duplicateBlockerCount: number;
  diagnostics: Record<string, number>;
};

export function evaluateZeroTradeBias(input: ZeroTradeBiasInput): ZeroTradeBiasResult {
  const blockers = input.firstBlockerDistribution ?? {};
  const unknownBlockerCount = Object.entries(blockers)
    .filter(([key]) => key.toUpperCase().includes("UNKNOWN"))
    .reduce((acc, [, value]) => acc + Math.max(0, Number(value ?? 0)), 0);
  const duplicateBlockerCount = Object.values(blockers).reduce(
    (acc, value) => acc + Math.max(0, Number(value ?? 0) - 1),
    0,
  );

  const firstLossStage: ZeroTradeBiasResult["firstLossStage"] =
    input.discovered <= 0
      ? "DISCOVERY"
      : input.hot <= 0
        ? "HOT"
        : input.microConfirmed <= 0
          ? "MICRO"
          : input.entryEnter <= 0
            ? "ENTRY"
            : input.riskAllowed <= 0
              ? "RISK"
              : input.executionAllowed <= 0
                ? "EXECUTION"
                : input.paperOpened <= 0
                  ? "PERSISTENCE"
                  : "UNKNOWN";

  const shouldFail = input.strongPositiveFixtures > 0 && input.paperOpened === 0;
  return {
    status: shouldFail ? "FAIL" : "PASS",
    firstLossStage,
    unknownBlockerCount,
    duplicateBlockerCount,
    diagnostics: {
      totalMarketSequences: input.totalMarketSequences,
      discovered: input.discovered,
      watching: input.watching,
      hot: input.hot,
      microAnalyzed: input.microAnalyzed,
      microConfirmed: input.microConfirmed,
      executionReady: input.executionReady,
      entryEnter: input.entryEnter,
      entryWait: input.entryWait,
      entryReject: input.entryReject,
      riskAllowed: input.riskAllowed,
      riskRejected: input.riskRejected,
      executionAllowed: input.executionAllowed,
      executionRejected: input.executionRejected,
      paperOpened: input.paperOpened,
      paperClosed: input.paperClosed,
    },
  };
}
