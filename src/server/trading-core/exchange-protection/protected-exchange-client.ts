import { retry } from "@/src/server/trading-core/utils/retry";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { ApiWeightTracker } from "@/src/server/trading-core/exchange-protection/api-weight-tracker";
import { PriorityRequestQueue } from "@/src/server/trading-core/exchange-protection/priority-request-queue";
import type {
  ExchangeProtectionSnapshot,
  ProtectedExchangeRequest,
} from "@/src/server/trading-core/exchange-protection/exchange-protection.types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryableStatus(status: number) {
  return status === 408 || status === 418 || status === 429 || status >= 500;
}

export class ProtectedExchangeClient {
  private readonly weights = new ApiWeightTracker();
  private readonly errors: string[] = [];
  private websocketFallbacks = 0;
  private readonly queue = new PriorityRequestQueue(
    Number(process.env.TRADING_EXCHANGE_QUEUE_CONCURRENCY ?? 2),
    (request) => this.execute(request),
  );

  requestJson<T>(request: ProtectedExchangeRequest): Promise<T> {
    return this.queue.enqueue<T>(request);
  }

  snapshot(): ExchangeProtectionSnapshot {
    return {
      weight: this.weights.snapshot(),
      queue: this.queue.snapshot(),
      recentErrors: [...this.errors],
      websocketFallbacks: this.websocketFallbacks,
      updatedAt: new Date().toISOString(),
    };
  }

  private async execute<T>(request: ProtectedExchangeRequest): Promise<T> {
    const orderCount = request.kind === "ORDER" || request.kind === "CANCEL" ? 1 : 0;
    const delay = this.weights.delayFor(request.weight);
    if (delay > 0) await wait(delay);

    return retry(
      async () => {
        if (!this.weights.canConsume(request.weight, orderCount)) {
          throw new Error("Exchange API weight limit protection delayed request");
        }
        this.weights.record(request.weight, orderCount);
        const response = await fetch(request.url, request.init);
        this.readBinanceHeaders(response);
        if (!response.ok) {
          if (response.status === 418 || response.status === 429) this.weights.block(30_000);
          if (request.useWebSocketFallback && request.kind === "MARKET_DATA") {
            this.websocketFallbacks += 1;
            tradingLogger.warn({
              category: "API",
              source: "trading-core.exchange-protection",
              message: "WebSocket fallback suggested for market data request",
              status: "SKIPPED",
              errorCode: `HTTP_${response.status}`,
              context: { url: request.url, exchange: request.exchange },
            });
          }
          throw new Error(`Exchange request failed: HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      },
      {
        retries: 3,
        minDelayMs: 300,
        maxDelayMs: 5000,
        factor: 2,
        jitter: true,
        shouldRetry: (error) => {
          const message = (error as Error).message;
          const status = Number(message.match(/HTTP (\d+)/)?.[1] ?? 0);
          return !status || retryableStatus(status);
        },
      },
    ).catch((error) => {
      this.rememberError((error as Error).message);
      tradingLogger.error({
        category: "API",
        source: "trading-core.exchange-protection",
        message: "Protected exchange request failed",
        status: "FAILED",
        errorCode: "EXCHANGE_API_ERROR",
        errorDetail: (error as Error).message,
        context: { request: { exchange: request.exchange, method: request.method, kind: request.kind, priority: request.priority } },
      });
      throw error;
    });
  }

  private readBinanceHeaders(response: Response) {
    const usedWeight = Number(response.headers.get("x-mbx-used-weight-1m") ?? response.headers.get("x-mbx-used-weight") ?? 0);
    const orderCount = Number(response.headers.get("x-mbx-order-count-1m") ?? 0);
    if (Number.isFinite(usedWeight) && usedWeight > 0) {
      const snapshot = this.weights.snapshot();
      if (usedWeight > snapshot.maxWeight1m * 0.9 || orderCount > snapshot.maxOrderCount1m * 0.9) this.weights.block(5000);
    }
  }

  private rememberError(message: string) {
    this.errors.unshift(`${new Date().toISOString()} ${message}`);
    if (this.errors.length > 30) this.errors.length = 30;
  }
}

const globalClient = globalThis as typeof globalThis & { __protectedExchangeClient?: ProtectedExchangeClient };
export const protectedExchangeClient = globalClient.__protectedExchangeClient ?? new ProtectedExchangeClient();
globalClient.__protectedExchangeClient = protectedExchangeClient;
