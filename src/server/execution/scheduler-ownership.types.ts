export type SchedulerOwnershipState =
  | "NOT_RUNNING"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

export type SchedulerLease = {
  jobId: string;
  ownerId: string;
  createdAt: string;
  lastHeartbeatAt: string;
  version: number;
  generation: number;
  state: SchedulerOwnershipState;
};

export type SchedulerLoopContext = {
  ownerId: string;
  generation: number;
  signal: AbortSignal;
};

export type AtomicSpawnResult = {
  action: "spawned" | "attached" | "rejected";
  jobId: string;
  ownerId: string;
  generation: number;
  reason?: string;
};

export type SchedulerRegistrySnapshot = {
  processOwnerId: string;
  loopCount: number;
  ownerCount: number;
  loops: Array<{ jobId: string; ownerId: string; generation: number }>;
  leases: Array<{ jobId: string; state: SchedulerOwnershipState; generation: number; ownerId: string }>;
};
