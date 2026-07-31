import { DOMAIN_EVENTS, INFRASTRUCTURE_EVENTS } from "@/src/server/event-platform/event-platform.types";
import { upsertEventSchema } from "@/src/server/event-platform/event-platform.repository";

const BASE_SCHEMA = {
  type: "object",
  required: ["eventId", "eventType", "payload"],
  properties: {
    eventId: { type: "string" },
    eventType: { type: "string" },
    payload: { type: "object" },
  },
};

export async function bootstrapEventSchemas() {
  const allTypes = [...Object.values(DOMAIN_EVENTS), ...Object.values(INFRASTRUCTURE_EVENTS)];
  for (const eventType of allTypes) {
    await upsertEventSchema(eventType, { ...BASE_SCHEMA, title: eventType });
  }
  return { registered: allTypes.length };
}

export async function validateEventSchema(eventType: string, payload: Record<string, unknown>, version = 1) {
  const { prisma } = await import("@/src/server/db/prisma");
  const schema = await prisma.eventSchema.findUnique({ where: { eventType } });
  if (!schema) return { valid: true, errors: [] as string[] };

  const errors: string[] = [];
  if (!payload || typeof payload !== "object") errors.push("Payload must be an object");
  if (schema.version > version && !schema.backwardCompat) errors.push(`Schema version ${schema.version} requires upgrade from ${version}`);
  return { valid: errors.length === 0, errors, schemaVersion: schema.version };
}

export async function migrateSchema(eventType: string, newSchema: Record<string, unknown>, version: number) {
  return upsertEventSchema(eventType, newSchema, version);
}
