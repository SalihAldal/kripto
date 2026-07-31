import { DOMAIN_EVENTS, INFRASTRUCTURE_EVENTS } from "@/src/server/event-platform/event-platform.types";
import { upsertModulePlugin } from "@/src/server/event-platform/event-platform.repository";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import type { PlatformModuleType } from "@prisma/client";

const DEFAULT_PLUGINS: Array<{
  moduleType: PlatformModuleType;
  displayName: string;
  subscribedEvents: string[];
  publishedEvents: string[];
}> = [
  { moduleType: "SCANNER", displayName: "Scanner Plugin", subscribedEvents: [], publishedEvents: [DOMAIN_EVENTS.SCANNER_COMPLETED, DOMAIN_EVENTS.SCANNER_FAILED] },
  { moduleType: "DECISION", displayName: "Decision Plugin", subscribedEvents: [DOMAIN_EVENTS.SCANNER_COMPLETED], publishedEvents: [DOMAIN_EVENTS.DECISION_CREATED, DOMAIN_EVENTS.DECISION_REJECTED] },
  { moduleType: "RISK", displayName: "Risk Plugin", subscribedEvents: [DOMAIN_EVENTS.DECISION_CREATED], publishedEvents: [DOMAIN_EVENTS.RISK_APPROVED, DOMAIN_EVENTS.RISK_REJECTED] },
  { moduleType: "EXECUTION", displayName: "Execution Plugin", subscribedEvents: [DOMAIN_EVENTS.RISK_APPROVED], publishedEvents: [DOMAIN_EVENTS.EXECUTION_REQUESTED, DOMAIN_EVENTS.EXECUTION_COMPLETED, DOMAIN_EVENTS.EXECUTION_FAILED] },
  { moduleType: "PORTFOLIO", displayName: "Portfolio Plugin", subscribedEvents: [DOMAIN_EVENTS.EXECUTION_COMPLETED], publishedEvents: [DOMAIN_EVENTS.PORTFOLIO_UPDATED] },
  { moduleType: "LEARNING", displayName: "Learning Plugin", subscribedEvents: [DOMAIN_EVENTS.REPLAY_COMPLETED], publishedEvents: [DOMAIN_EVENTS.LEARNING_COMPLETED] },
  { moduleType: "RESEARCH", displayName: "Research Plugin", subscribedEvents: [], publishedEvents: [DOMAIN_EVENTS.RESEARCH_COMPLETED] },
  { moduleType: "META_AI", displayName: "Meta AI Plugin", subscribedEvents: [DOMAIN_EVENTS.FUSION_UPDATED], publishedEvents: [DOMAIN_EVENTS.META_ANALYSIS_COMPLETED] },
  { moduleType: "FUSION", displayName: "Fusion Plugin", subscribedEvents: [DOMAIN_EVENTS.NEWS_RECEIVED, DOMAIN_EVENTS.WHALE_DETECTED], publishedEvents: [DOMAIN_EVENTS.FUSION_UPDATED] },
  { moduleType: "EXCHANGE", displayName: "Exchange Plugin", subscribedEvents: [INFRASTRUCTURE_EVENTS.RECONNECT], publishedEvents: [INFRASTRUCTURE_EVENTS.HEALTH_CHANGED] },
  { moduleType: "EVENT_PLATFORM", displayName: "Event Platform Plugin", subscribedEvents: Object.values(DOMAIN_EVENTS), publishedEvents: Object.values(INFRASTRUCTURE_EVENTS) },
];

export async function bootstrapModulePlugins() {
  const results = [];
  for (const plugin of DEFAULT_PLUGINS) {
    const row = await upsertModulePlugin({
      ...plugin,
      consumerId: `${plugin.moduleType.toLowerCase()}-consumer`,
    });
    results.push(row);
    emitPlatformEvent(PLATFORM_EVENT.PLUGIN_REGISTERED, { moduleType: plugin.moduleType });
  }
  return results;
}

export async function registerModulePlugin(input: {
  moduleType: PlatformModuleType;
  displayName: string;
  subscribedEvents: string[];
  publishedEvents: string[];
  consumerId?: string;
}) {
  const row = await upsertModulePlugin(input);
  emitPlatformEvent(PLATFORM_EVENT.PLUGIN_REGISTERED, { moduleType: input.moduleType });
  return row;
}

export async function listRegisteredPlugins() {
  const { prisma } = await import("@/src/server/db/prisma");
  return prisma.modulePluginRegistration.findMany({ orderBy: { moduleType: "asc" } });
}
