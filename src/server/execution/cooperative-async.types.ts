export class CooperativeAsyncTimeoutError extends Error {
  readonly code = "ASYNC_TIMEOUT" as const;

  constructor(message: string) {
    super(message);
    this.name = "CooperativeAsyncTimeoutError";
  }
}

export class CooperativeAsyncCancelledError extends Error {
  readonly code = "ASYNC_CANCELLED" as const;

  constructor(message: string) {
    super(message);
    this.name = "CooperativeAsyncCancelledError";
  }
}

export type AsyncTelemetryEvent = {
  at: string;
  kind:
    | "promise_start"
    | "promise_complete"
    | "promise_timeout"
    | "promise_cancel"
    | "promise_fail"
    | "worker_start"
    | "worker_complete"
    | "worker_stall"
    | "worker_timeout"
    | "stage_timeout"
    | "heartbeat"
    | "budget"
    | "recovery";
  label: string;
  message: string;
  awaitMs?: number;
  meta?: Record<string, unknown>;
};

export type AsyncRuntimeTelemetry = {
  promiseStarted: number;
  promiseCompleted: number;
  promiseTimedOut: number;
  promiseCancelled: number;
  promiseFailed: number;
  workerStarted: number;
  workerCompleted: number;
  workerStalled: number;
  workerTimedOut: number;
  stageTimeouts: number;
  maxAwaitMs: number;
  events: AsyncTelemetryEvent[];
};

export function createAsyncTelemetry(): AsyncRuntimeTelemetry {
  return {
    promiseStarted: 0,
    promiseCompleted: 0,
    promiseTimedOut: 0,
    promiseCancelled: 0,
    promiseFailed: 0,
    workerStarted: 0,
    workerCompleted: 0,
    workerStalled: 0,
    workerTimedOut: 0,
    stageTimeouts: 0,
    maxAwaitMs: 0,
    events: [],
  };
}
