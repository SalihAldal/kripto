import { getNextSequence } from "@/src/server/event-platform/event-platform.repository";

export async function assignOrderedSequence(partitionKey: string): Promise<bigint> {
  return getNextSequence(partitionKey);
}

export function buildPartitionKey(type: "aggregate" | "trade" | "symbol" | "portfolio", id: string): string {
  return `${type}:${id}`;
}
