import { randomUUID } from "node:crypto";
import type { SystemLog, SystemLogLevel } from "@/lib/types";

const runtimeLogs: SystemLog[] = [];

export function pushLog(level: SystemLogLevel, message: string): SystemLog {
  const entry: SystemLog = {
    id: randomUUID(),
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  runtimeLogs.unshift(entry);
  if (runtimeLogs.length > 300) {
    runtimeLogs.pop();
  }
  return entry;
}

export function listLogs(limit = 100) {
  return runtimeLogs.slice(0, limit);
}
