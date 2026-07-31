import { verifyEventSignature } from "@/src/server/event-platform/message-broker.service";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";
import type { PlatformModuleType } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

const authorizedModules = new Set<PlatformModuleType>([
  "SCANNER", "DECISION", "RISK", "EXECUTION", "PORTFOLIO", "LEARNING",
  "RESEARCH", "GOVERNANCE", "META_AI", "FUSION", "EXCHANGE", "EVENT_PLATFORM", "INFRASTRUCTURE",
]);

export function authorizeModule(module: PlatformModuleType): boolean {
  return authorizedModules.has(module);
}

export function validateEventIntegrity(event: CanonicalEvent, signature?: string): boolean {
  const secret = process.env.EVENT_SIGNING_SECRET;
  if (!secret || !signature) return true;
  return verifyEventSignature(event, signature, secret);
}

export async function authenticateConsumer(consumerId: string, pluginType: PlatformModuleType): Promise<boolean> {
  const plugin = await prisma.modulePluginRegistration.findUnique({ where: { moduleType: pluginType } });
  if (!plugin?.enabled) return false;
  return !plugin.consumerId || plugin.consumerId === consumerId;
}

export async function validateImmutableStore(eventId: string): Promise<boolean> {
  const existing = await prisma.eventStore.findUnique({ where: { eventId } });
  return Boolean(existing);
}
