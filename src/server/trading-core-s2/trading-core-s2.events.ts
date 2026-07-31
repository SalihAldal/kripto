export const TRADING_CORE_S2_EVENT = {
  REGIME_CLASSIFIED: "TradingCoreS2RegimeClassified",
  DISCOVERY_COMPLETED: "TradingCoreS2DiscoveryCompleted",
  MOMENTUM_EVALUATED: "TradingCoreS2MomentumEvaluated",
  STATISTICS_UPDATED: "TradingCoreS2StatisticsUpdated",
} as const;

type EventHandler = (payload: Record<string, unknown>) => void;
const handlers = new Map<string, Set<EventHandler>>();

export function onTradingCoreS2Event(event: string, handler: EventHandler) {
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

export function emitTradingCoreS2Event(event: string, payload: Record<string, unknown>) {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // observer isolation
    }
  }
}
