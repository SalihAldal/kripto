import { prisma } from "@/src/server/db/prisma";
import { persistKnowledgeEdge, upsertKnowledgeNode } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import { DEFAULT_EXCHANGES, DEFAULT_PROTOCOLS, SUPPORTED_NETWORKS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

export async function buildKnowledgeGraph(limit = 50) {
  let edgesCreated = 0;

  for (const net of SUPPORTED_NETWORKS) {
    await upsertKnowledgeNode({ nodeKey: `chain:${net}`, nodeType: "CHAIN", label: net, network: net, weight: 5 });
  }

  for (const ex of DEFAULT_EXCHANGES) {
    await upsertKnowledgeNode({ nodeKey: `exchange:${ex}`, nodeType: "EXCHANGE", label: ex, weight: 4 });
  }

  for (const p of DEFAULT_PROTOCOLS) {
    const protocolNode = await upsertKnowledgeNode({
      nodeKey: `protocol:${p.protocol}`,
      nodeType: "PROTOCOL",
      label: p.protocol,
      network: p.network,
      weight: 6,
    });
    const tokenNode = await upsertKnowledgeNode({
      nodeKey: `token:${p.asset}`,
      nodeType: "TOKEN",
      label: p.asset,
      network: p.network,
      weight: 5,
    });
    const chainNode = await upsertKnowledgeNode({
      nodeKey: `chain:${p.network}`,
      nodeType: "CHAIN",
      label: p.network,
      network: p.network,
      weight: 5,
    });

    await persistKnowledgeEdge({ fromNodeId: protocolNode.id, toNodeId: tokenNode.id, relation: "HAS_TOKEN", weight: 3, confidence: 90 }).catch(() => null);
    await persistKnowledgeEdge({ fromNodeId: protocolNode.id, toNodeId: chainNode.id, relation: "DEPLOYED_ON", weight: 4, confidence: 95 }).catch(() => null);
    edgesCreated += 2;
  }

  const narratives = ["AI", "RWA", "DeFi", "Layer2", "Restaking"];
  for (const narrative of narratives) {
    const node = await upsertKnowledgeNode({ nodeKey: `narrative:${narrative}`, nodeType: "NARRATIVE", label: narrative, weight: 4 });
    const protocol = DEFAULT_PROTOCOLS[Math.floor(Math.random() * DEFAULT_PROTOCOLS.length)]!;
    const protocolNode = await prisma.knowledgeGraphNode.findUnique({ where: { nodeKey: `protocol:${protocol.protocol}` } });
    if (protocolNode) {
      await persistKnowledgeEdge({ fromNodeId: protocolNode.id, toNodeId: node.id, relation: "BELONGS_TO_NARRATIVE", weight: 2, confidence: 70 }).catch(() => null);
      edgesCreated += 1;
    }
  }

  const whaleWallets = await prisma.whaleWallet.findMany({ take: 5 }).catch(() => []);
  for (const wallet of whaleWallets) {
    const node = await upsertKnowledgeNode({
      nodeKey: `wallet:${wallet.address}`,
      nodeType: "WHALE",
      label: wallet.label ?? wallet.address.slice(0, 10),
      network: wallet.chain as never,
      weight: 3,
    });
    if (wallet.exchange) {
      const exNode = await prisma.knowledgeGraphNode.findUnique({ where: { nodeKey: `exchange:${wallet.exchange}` } });
      if (exNode) {
        await persistKnowledgeEdge({ fromNodeId: node.id, toNodeId: exNode.id, relation: "USES_EXCHANGE", weight: 2, confidence: 75 }).catch(() => null);
        edgesCreated += 1;
      }
    }
  }

  emitOnChainEvent(ONCHAIN_EVENT.KNOWLEDGE_UPDATED, { edgesCreated, limit });
  return { edgesCreated, nodeCount: await prisma.knowledgeGraphNode.count() };
}
