import {
  getModelRegistry,
  getActiveModel,
  parseArtifactJson,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import {
  setCachedInferenceModel,
  getCachedInferenceModelMeta,
} from "@/src/server/decision-engine-v2/decision-engine-v2.cache";
import { buildFallbackArtifact } from "@/src/server/decision-engine-v2/inference.service";

export async function syncInferenceCacheFromRegistry() {
  const model = await getActiveModel();
  if (!model) {
    const artifact = buildFallbackArtifact();
    setCachedInferenceModel({
      modelId: "fallback",
      modelVersion: "bootstrap",
      artifact,
    });
    return { modelId: "fallback", modelVersion: "bootstrap", source: "fallback" };
  }
  const artifact = parseArtifactJson(model.artifactJson) ?? buildFallbackArtifact();
  setCachedInferenceModel({
    modelId: model.id,
    modelVersion: model.version,
    artifact,
  });
  return { modelId: model.id, modelVersion: model.version, source: "registry" };
}

export async function getModelRegistryDashboard() {
  const registry = await getModelRegistry();
  const cache = getCachedInferenceModelMeta();
  return {
    registry,
    cache,
    champion: registry.championModel,
    challenger: registry.challengerModel,
    active: registry.activeModel,
    previous: registry.previousModel,
    rollback: registry.rollbackModel,
  };
}

export async function ensureModelRegistryInitialized() {
  await getModelRegistry();
  const cache = getCachedInferenceModelMeta();
  if (!cache) await syncInferenceCacheFromRegistry();
}
