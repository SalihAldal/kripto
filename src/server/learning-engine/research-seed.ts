import pack from "./data/research-seed-v1.json";
/** Knowledge only. Never insert these aggregate experiments into trade/label tables. */
export function researchSeedRecords(asOfMs = Date.now()) {
  if (!Number.isFinite(asOfMs)) throw new Error("INVALID_SEED_AS_OF");
  const ids = new Set<string>();
  for (const r of pack.records) {
    if (ids.has(r.id) || !/^[a-f0-9]{64}$/.test(r.sourceFileSha256) || !Number.isFinite(Date.parse(r.availableAt))) throw new Error("INVALID_RESEARCH_SEED");
    ids.add(r.id);
  }
  return pack.records.filter(r => Date.parse(r.availableAt) <= asOfMs).map(r => ({
    id: r.id, title: r.title, category: "HISTORICAL_RESEARCH_SEED", tags: r.tags,
    content: `${JSON.stringify(r.fact)}. ${r.limitation}. Advisory research; do not count as trades or promote a model from this record.`,
    metadata: { seedVersion: pack.version, sourceFile: r.sourceFile, sourceFileSha256: r.sourceFileSha256,
      availableAt: r.availableAt, trainingEligible: false, autoApply: false, evidenceType: "AGGREGATE_HISTORICAL_RESEARCH", limitations: r.limitation },
  }));
}
