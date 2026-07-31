import { updateKnowledgeGraph } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

export async function integrateKnowledgeGraph(fusionId?: string) {
  const fusion = fusionId
    ? await prisma.intelligenceFusion.findUnique({
        where: { id: fusionId },
        include: { marketIntelligence: true, marketContext: true, narratives: true, conflictMatrix: true },
      })
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true, marketContext: true, narratives: true, conflictMatrix: true },
      });

  if (!fusion?.marketContext) return { integrated: false };

  const nodes: Array<{ id: string; type: string; label: string; weight: number }> = [];
  const edges: Array<{ from: string; to: string; relation: string }> = [];

  if (fusion.marketIntelligence) {
    nodes.push({ id: "intel", type: "MarketIntelligence", label: "Canonical Intelligence", weight: fusion.marketIntelligence.marketScore });
  }

  for (const narrative of fusion.narratives) {
    nodes.push({ id: `nar_${narrative.id}`, type: "Narrative", label: narrative.title, weight: narrative.heatScore });
    edges.push({ from: "intel", to: `nar_${narrative.id}`, relation: "DESCRIBES" });
  }

  if (fusion.conflictMatrix) {
    nodes.push({ id: "conflicts", type: "ConflictMatrix", label: "Signal Conflicts", weight: 100 - fusion.conflictMatrix.conflictCount * 10 });
    edges.push({ from: "intel", to: "conflicts", relation: "HAS_CONFLICTS" });
  }

  const newsData = fusion.marketContext.newsData as { impacts?: unknown[] } | null;
  if (newsData?.impacts?.length) {
    nodes.push({ id: "news", type: "Event", label: "News Events", weight: 60 });
    edges.push({ from: "news", to: "intel", relation: "INFLUENCES" });
  }

  const whaleData = fusion.marketContext.whaleData as { scores?: unknown[] } | null;
  if (whaleData?.scores?.length) {
    nodes.push({ id: "whales", type: "Wallet", label: "Whale Activity", weight: 65 });
    edges.push({ from: "whales", to: "intel", relation: "INFLUENCES" });
  }

  const onChainData = fusion.marketContext.onChainData as { protocols?: unknown[] } | null;
  if (onChainData?.protocols?.length) {
    nodes.push({ id: "protocols", type: "Protocol", label: "On-Chain Protocols", weight: 70 });
    edges.push({ from: "protocols", to: "intel", relation: "INFLUENCES" });
  }

  const graph = { nodes, edges, integratedAt: new Date().toISOString() };
  await updateKnowledgeGraph(fusion.id, graph);
  emitFusionEvent(FUSION_EVENT.KNOWLEDGE_INTEGRATED, { fusionId: fusion.id, nodeCount: nodes.length });
  return { integrated: true, graph };
}
