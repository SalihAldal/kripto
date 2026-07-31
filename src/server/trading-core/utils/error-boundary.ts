import { logger } from "@/lib/logger";

export async function isolate<T>(
  name: string,
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.warn({ module: name, error: (error as Error).message }, "Trading core isolated operation failed");
    return fallback;
  }
}
