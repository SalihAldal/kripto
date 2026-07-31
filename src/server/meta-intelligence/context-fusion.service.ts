import { getLatestContext, updateMetaContextFusion } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";

export async function fuseContext(contextId?: string) {
  const ctx = contextId
    ? await import("@/src/server/db/prisma").then(({ prisma }) => prisma.metaContext.findUnique({ where: { id: contextId } }))
    : await getLatestContext();
  if (!ctx) return { fused: false };

  const graph = {
    nodes: [
      { id: "technical", type: "SIGNAL", weight: 0.7, source: "scanner" },
      { id: "fundamental", type: "SIGNAL", weight: 0.5, source: "news" },
      { id: "onchain", type: "SIGNAL", weight: 0.8, source: "onChain" },
      { id: "whale", type: "SIGNAL", weight: 0.75, source: "whale" },
      { id: "macro", type: "SIGNAL", weight: 0.6, source: "news" },
      { id: "risk", type: "CONSTRAINT", weight: 0.9, source: "risk" },
      { id: "portfolio", type: "CONSTRAINT", weight: 0.85, source: "portfolio" },
      { id: "regime", type: "REGIME", weight: 1, value: ctx.marketRegime },
    ],
    edges: [
      { from: "technical", to: "regime", relation: "INFLUENCES" },
      { from: "whale", to: "onchain", relation: "CORRELATES" },
      { from: "news", to: "macro", relation: "DRIVES" },
      { from: "risk", to: "portfolio", relation: "CONSTRAINS" },
      { from: "fundamental", to: "regime", relation: "INFLUENCES" },
    ],
    fusedAt: new Date().toISOString(),
  };

  const dataConfidence = Math.min(100, (ctx.dataConfidence + 10));
  const overallConfidence = Math.min(100, (ctx.overallConfidence + dataConfidence) / 2);

  await updateMetaContextFusion(ctx.id, graph, { overallConfidence, dataConfidence });

  emitMetaEvent(META_EVENT.CONTEXT_BUILT, { contextId: ctx.id, fused: true });
  return { contextId: ctx.id, graph, overallConfidence };
}
