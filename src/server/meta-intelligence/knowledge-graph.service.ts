import { upsertMetaKnowledge } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import { prisma } from "@/src/server/db/prisma";

export async function buildMetaKnowledgeGraph(limit = 50) {
  let nodes = 0;

  const regimes = await prisma.marketNarrative.findMany({ where: { active: true }, take: 10 });
  for (const n of regimes) {
    await upsertMetaKnowledge({
      nodeKey: `narrative:${n.narrativeKey}`,
      nodeType: "NARRATIVE",
      label: n.title,
      relations: { regime: n.marketRegime, heat: n.heatScore },
      weight: n.heatScore / 10,
    });
    nodes += 1;
  }

  const decisions = await prisma.executiveDecision.findMany({ orderBy: { decidedAt: "desc" }, take: 10 });
  for (const d of decisions) {
    await upsertMetaKnowledge({
      nodeKey: `decision:${d.id}`,
      nodeType: "STRATEGY",
      label: d.recommendation,
      relations: { confidence: d.overallConfidence, priority: d.priority },
      weight: d.overallConfidence / 10,
    });
    nodes += 1;
  }

  const onChain = await prisma.protocolHealth.findMany({ orderBy: { overallHealth: "desc" }, take: 10 }).catch(() => []);
  for (const p of onChain) {
    await upsertMetaKnowledge({
      nodeKey: `protocol:${p.protocol}`,
      nodeType: "PROTOCOL",
      label: p.protocol,
      relations: { health: p.overallHealth, network: p.network },
      weight: p.overallHealth / 10,
    });
    nodes += 1;
  }

  const memories = await prisma.executiveMemory.findMany({ orderBy: { recordedAt: "desc" }, take: 10 });
  for (const m of memories) {
    await upsertMetaKnowledge({
      nodeKey: `memory:${m.memoryKey}`,
      nodeType: "EVENT",
      label: m.title,
      relations: { type: m.memoryType, tags: m.tags },
      weight: m.confidence / 10,
    });
    nodes += 1;
  }

  emitMetaEvent(META_EVENT.KNOWLEDGE_UPDATED, { nodes });
  return { nodes, limit };
}
