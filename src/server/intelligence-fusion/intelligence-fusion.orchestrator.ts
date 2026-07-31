import { runFusionPipeline } from "@/src/server/intelligence-fusion/fusion-pipeline.service";
import { generateCanonicalObject } from "@/src/server/intelligence-fusion/canonical-object.service";
import { resolveFusionConflicts } from "@/src/server/intelligence-fusion/conflict-resolution.service";
import { fuseConfidence } from "@/src/server/intelligence-fusion/confidence-fusion.service";
import { updateSourceReliability } from "@/src/server/intelligence-fusion/source-reliability.service";
import { collectEvidenceForFusion } from "@/src/server/intelligence-fusion/evidence-engine.service";
import { buildFusionNarrative } from "@/src/server/intelligence-fusion/narrative-fusion.service";
import { recordTimelineForLatest } from "@/src/server/intelligence-fusion/fusion-timeline.service";
import { scoreQualityForFusion } from "@/src/server/intelligence-fusion/fusion-quality.service";
import { integrateKnowledgeGraph } from "@/src/server/intelligence-fusion/knowledge-graph.service";
import { validateAndPublish } from "@/src/server/intelligence-fusion/fusion-validation.service";
import { replayFusionTimeline } from "@/src/server/intelligence-fusion/fusion-replay.service";
import type { IntelligenceFusionJobPayload } from "@/src/server/intelligence-fusion/intelligence-fusion.types";

async function runFullFusionPipeline(payload: Extract<IntelligenceFusionJobPayload, { type: "FUSION_PIPELINE" }>) {
  const { fusionId, sources, sourceCount } = await runFusionPipeline({
    assetClass: payload.assetClass,
    symbol: payload.symbol,
  });
  const confidence = await fuseConfidence(
    (await import("@/src/server/intelligence-fusion/canonical-object.service")).buildCanonicalScores(sources),
    sources,
  );
  const { intelligence, scores } = await generateCanonicalObject(fusionId, sources, {
    assetClass: payload.assetClass,
    symbol: payload.symbol,
    confidence,
  });

  await runPostFusionJobs(fusionId);
  return { fusionId, intelligenceId: intelligence.id, sourceCount, scores, confidence };
}

export async function runIntelligenceFusionJob(payload: IntelligenceFusionJobPayload) {
  switch (payload.type) {
    case "FUSION_PIPELINE":
      return runFullFusionPipeline(payload);
    case "CONFLICT_RESOLVE":
      return resolveFusionConflicts(payload.fusionId);
    case "SOURCE_RELIABILITY":
      return updateSourceReliability();
    case "NARRATIVE_BUILD":
      return buildFusionNarrative(payload.fusionId);
    case "EVIDENCE_COLLECT":
      return collectEvidenceForFusion(payload.fusionId);
    case "FUSION_REPLAY":
      return replayFusionTimeline(payload.timelineKey, payload.limit);
    case "QUALITY_SCORE":
      return scoreQualityForFusion(payload.fusionId);
    case "KNOWLEDGE_INTEGRATE":
      return integrateKnowledgeGraph(payload.fusionId);
    case "VALIDATE_PUBLISH":
      return validateAndPublish(payload.fusionId);
    default:
      return { skipped: true };
  }
}

export async function runPostFusionJobs(fusionId: string) {
  await resolveFusionConflicts(fusionId);
  await collectEvidenceForFusion(fusionId);
  await scoreQualityForFusion(fusionId);
  await buildFusionNarrative(fusionId);
  await integrateKnowledgeGraph(fusionId);
  const result = await validateAndPublish(fusionId);
  if (result.published && result.intelligence) {
    await recordTimelineForLatest();
  }
  return result;
}
