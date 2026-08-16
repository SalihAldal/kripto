import { logger } from "@/lib/logger";
import {
  withCancellableBoundedAwait,
  type CancellableWorkOptions,
} from "@/src/server/execution/cancellable-work.service";
import { CooperativeAsyncTimeoutError } from "@/src/server/execution/cooperative-async.types";

export const DEFAULT_PRISMA_BOUND_MS = 15_000;

export class BoundedPrismaError extends Error {
  readonly code = "BOUNDED_PRISMA_TIMEOUT" as const;

  constructor(message: string) {
    super(message);
    this.name = "BoundedPrismaError";
  }
}

export async function withBoundedPrisma<T>(
  label: string,
  work: () => Promise<T>,
  timeoutMs = DEFAULT_PRISMA_BOUND_MS,
  options?: Pick<CancellableWorkOptions, "signal" | "telemetry" | "meta">,
): Promise<T> {
  try {
    return await withCancellableBoundedAwait(
      label,
      async (signal) => {
        if (signal.aborted) throw signal.reason;
        return work();
      },
      timeoutMs,
      options,
    );
  } catch (error) {
    if (error instanceof CooperativeAsyncTimeoutError) {
      logger.warn({ label, timeoutMs }, "Bounded Prisma operation timed out");
      throw new BoundedPrismaError(error.message);
    }
    throw error;
  }
}
