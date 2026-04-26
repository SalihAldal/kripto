import { logger } from "@/lib/logger";
import { addSystemLog } from "@/src/server/repositories/log.repository";

export async function logTradeLifecycle(input: {
  executionId: string;
  stage: string;
  symbol?: string;
  status: "STARTED" | "SUCCESS" | "FAILED" | "SKIPPED";
  message: string;
  context?: Record<string, unknown>;
}) {
  logger.info(
    {
      executionId: input.executionId,
      stage: input.stage,
      symbol: input.symbol,
      status: input.status,
      context: input.context,
    },
    `Trade lifecycle: ${input.message}`,
  );

  await addSystemLog({
    level: input.status === "FAILED" ? "ERROR" : input.status === "SKIPPED" ? "WARN" : "INFO",
    source: "trade-lifecycle",
    message: `${input.stage} - ${input.message}`,
    context: {
      executionId: input.executionId,
      symbol: input.symbol,
      status: input.status,
      ...input.context,
    },
  }).catch(() => null);
}
