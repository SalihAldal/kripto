export const RESEARCH_SANDBOX = {
  isolated: true,
  affectsPaperTrading: false,
  affectsLiveTrading: false,
  affectsShadowMode: false,
  affectsProductionDb: false,
  writeScope: "quant_research_only",
} as const;

export function assertResearchIsolation() {
  return { ...RESEARCH_SANDBOX, verifiedAt: new Date().toISOString() };
}

export function researchDbOnly<T>(operation: () => Promise<T>) {
  assertResearchIsolation();
  return operation();
}
