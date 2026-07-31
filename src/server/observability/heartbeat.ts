type HeartbeatRecord = {
  service: string;
  status: "UP" | "DOWN" | "DEGRADED";
  updatedAt: string;
  message?: string;
  details?: Record<string, unknown>;
};

const heartbeats = new Map<string, HeartbeatRecord>();

export function markHeartbeat(input: {
  service: string;
  status?: "UP" | "DOWN" | "DEGRADED";
  message?: string;
  details?: Record<string, unknown>;
}) {
  const row: HeartbeatRecord = {
    service: input.service,
    status: input.status ?? "UP",
    message: input.message,
    details: input.details,
    updatedAt: new Date().toISOString(),
  };
  heartbeats.set(input.service, row);
  return row;
}

export function listHeartbeats() {
  return Array.from(heartbeats.values()).sort((a, b) => a.service.localeCompare(b.service));
}

export function getHeartbeat(service: string) {
  return heartbeats.get(service) ?? null;
}
