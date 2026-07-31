import { EventEmitter } from "node:events";
import { logger } from "@/lib/logger";

export type TradingCoreEventMap = {
  "module.started": { module: string };
  "module.failed": { module: string; error: string };
  "market.tick": { symbol: string; price: number; eventTime: number };
  "signal.generated": { symbol: string; side: string; score: number };
  "risk.evaluated": { symbol: string; allowed: boolean; level: string };
  "execution.requested": { symbol: string; side: string; idempotencyKey: string };
  "execution.rejected": { symbol: string; reasons: string[] };
};

type EventName = keyof TradingCoreEventMap;
type Handler<T extends EventName> = (payload: TradingCoreEventMap[T]) => void | Promise<void>;

export class TradingCoreEventBus {
  private readonly emitter = new EventEmitter();

  constructor(maxListeners = 100) {
    this.emitter.setMaxListeners(maxListeners);
  }

  on<T extends EventName>(event: T, handler: Handler<T>) {
    const wrapped = (payload: TradingCoreEventMap[T]) => {
      Promise.resolve(handler(payload)).catch((error) => {
        logger.warn({ event, error: (error as Error).message }, "Trading core event handler failed");
      });
    };
    this.emitter.on(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  emit<T extends EventName>(event: T, payload: TradingCoreEventMap[T]) {
    this.emitter.emit(event, payload);
  }

  removeAll() {
    this.emitter.removeAllListeners();
  }
}
