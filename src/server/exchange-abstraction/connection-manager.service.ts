import type { ExchangePluginType } from "@prisma/client";
import { getExchangePlugin } from "@/src/server/exchange-abstraction/plugin-registry.service";
import { emitExchangeEvent, EXCHANGE_EVENT } from "@/src/server/exchange-abstraction/exchange-abstraction.events";

type ConnectionState = {
  pluginType: ExchangePluginType;
  restConnected: boolean;
  wsConnected: boolean;
  connectedAt?: string;
  lastHeartbeat?: string;
  reconnectAttempts: number;
  latencyMs: number;
};

const connections = new Map<ExchangePluginType, ConnectionState>();

export async function connectExchange(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  const start = Date.now();
  const result = await adapter.connect();
  const latencyMs = Date.now() - start;

  connections.set(pluginType, {
    pluginType,
    restConnected: result.connected,
    wsConnected: result.mode.includes("WS"),
    connectedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    reconnectAttempts: 0,
    latencyMs,
  });

  emitExchangeEvent(EXCHANGE_EVENT.CONNECTED, { pluginType, latencyMs });
  return { ...result, latencyMs };
}

export async function disconnectExchange(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  await adapter.disconnect();
  connections.delete(pluginType);
  emitExchangeEvent(EXCHANGE_EVENT.DISCONNECTED, { pluginType });
  return { disconnected: true };
}

export async function heartbeatExchange(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  const start = Date.now();
  const health = await adapter.health().catch(() => null);
  const latencyMs = Date.now() - start;

  const existing = connections.get(pluginType);
  connections.set(pluginType, {
    pluginType,
    restConnected: health?.restConnected ?? existing?.restConnected ?? false,
    wsConnected: health?.wsConnected ?? existing?.wsConnected ?? false,
    connectedAt: existing?.connectedAt,
    lastHeartbeat: new Date().toISOString(),
    reconnectAttempts: existing?.reconnectAttempts ?? 0,
    latencyMs,
  });

  return { pluginType, latencyMs, health };
}

export async function reconnectExchange(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const existing = connections.get(pluginType);
  await disconnectExchange(pluginType).catch(() => null);
  const result = await connectExchange(pluginType);
  connections.set(pluginType, {
    pluginType,
    restConnected: result.connected,
    wsConnected: true,
    connectedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    reconnectAttempts: (existing?.reconnectAttempts ?? 0) + 1,
    latencyMs: result.latencyMs,
  });
  emitExchangeEvent(EXCHANGE_EVENT.RECONNECTED, { pluginType, attempts: (existing?.reconnectAttempts ?? 0) + 1 });
  return result;
}

export function getConnectionStatus(pluginType?: ExchangePluginType) {
  if (pluginType) return connections.get(pluginType) ?? { pluginType, restConnected: false, wsConnected: false, reconnectAttempts: 0, latencyMs: 0 };
  return Array.from(connections.values());
}

export async function monitorConnections(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const status = await heartbeatExchange(pluginType);
  if (!status.health?.restConnected) {
    return reconnectExchange(pluginType);
  }
  return status;
}
