import { randomUUID } from "node:crypto";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { ExecutionIntent, MarketTick, ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { StopManager } from "@/src/server/trading-core/executors/stop-manager";
import type {
  ManagedPosition,
  OpenPositionRequest,
  PositionManagerConfig,
  PositionOpenResult,
  PositionUpdateResult,
} from "@/src/server/trading-core/executors/position-types";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";

function getPositionManagerConfig(): PositionManagerConfig {
  return {
    maxOpenPositions: tradingConfig.getGlobal("maxOpenPositions"),
    allowHedge: false,
    allowDuplicateSymbol: false,
    defaultStopLossPercent: tradingConfig.getGlobal("stopLossPercent"),
    defaultTakeProfitPercent: tradingConfig.getGlobal("takeProfitPercent"),
    trailingEnabled: true,
    trailingActivationPercent: tradingConfig.getGlobal("trailingActivationPercent"),
    trailingDistancePercent: tradingConfig.getGlobal("trailingDistancePercent"),
    autoBreakevenEnabled: true,
    breakevenActivationPercent: tradingConfig.getGlobal("autoBreakevenActivationPercent"),
    partialTakeProfitEnabled: true,
    partialTakeProfitPercent: tradingConfig.getGlobal("partialTakeProfitPercent"),
    partialTakeProfitQuantityPercent: tradingConfig.getGlobal("partialTakeProfitQuantityPercent"),
  };
}

function readNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export class PositionManager implements TradingModule {
  readonly name = "position-manager";
  get enabled() {
    return tradingCoreFlags.enabled;
  }
  private readonly positions = new Map<string, ManagedPosition>();
  private readonly stopManager = new StopManager();
  private lastUpdateAt = 0;
  private lastClosed: PositionUpdateResult["closed"] | null = null;

  constructor(private readonly config?: PositionManagerConfig) {}

  canOpen(symbol: string, side?: "BUY" | "SELL", botId = "default") {
    const normalized = symbol.toUpperCase();
    const config = this.currentConfig();
    const open = this.snapshot().filter((position) => position.symbol === normalized);
    if (!config.allowDuplicateSymbol && open.some((position) => position.side === side || !side)) {
      return { allowed: false, reason: "Duplicate position blocked for symbol" };
    }
    if (!config.allowHedge && side && open.some((position) => position.side !== side)) {
      return { allowed: false, reason: "Hedge conflict blocked for symbol" };
    }
    if (open.some((position) => position.botId !== botId && position.side !== side)) {
      return { allowed: false, reason: "Multi-bot symbol conflict blocked" };
    }
    if (this.snapshot().length >= config.maxOpenPositions) {
      return { allowed: false, reason: "Max open positions reached" };
    }
    return { allowed: true };
  }

  open(intent: ExecutionIntent) {
    const entryPrice = readNumber(intent.metadata?.entryPrice, readNumber(intent.metadata?.price, 1));
    const quantity = readNumber(intent.metadata?.quantity, readNumber(intent.metadata?.adjustedQuantity, 1));
    return this.openPosition({
      candidateId: intent.candidateId,
      executionIntentId: intent.executionIntentId,
      executionReference: intent.idempotencyKey,
      botId: String(intent.metadata?.botId ?? "default"),
      symbol: intent.symbol,
      side: intent.side,
      quantity,
      entryPrice,
      stopLoss: readNumber(intent.metadata?.stopLossPrice, 0) || undefined,
      takeProfit: readNumber(intent.metadata?.takeProfitPrice, 0) || undefined,
      score: intent.score,
      confidence: intent.confidence,
      metadata: intent.metadata,
    });
  }

  openPosition(request: OpenPositionRequest): PositionOpenResult {
    const symbol = request.symbol.toUpperCase();
    const botId = request.botId ?? "default";
    const config = this.currentConfig();
    const check = this.canOpen(symbol, request.side, botId);
    if (!check.allowed) return check;
    const stopLoss = request.stopLoss ?? this.defaultStopLoss(request.side, request.entryPrice);
    const takeProfit = request.takeProfit ?? this.defaultTakeProfit(request.side, request.entryPrice);
    const position: ManagedPosition = {
      id: randomUUID(),
      candidateId: request.candidateId,
      executionIntentId: request.executionIntentId,
      executionReference: request.executionReference,
      botId,
      symbol,
      side: request.side,
      status: "OPEN",
      quantity: request.quantity,
      remainingQuantity: request.quantity,
      entryPrice: request.entryPrice,
      currentPrice: request.entryPrice,
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stopLoss,
      takeProfit,
      autoBreakevenEnabled: config.autoBreakevenEnabled,
      trailingStop: {
        enabled: config.trailingEnabled,
        activationPercent: config.trailingActivationPercent,
        distancePercent: config.trailingDistancePercent,
      },
      partialTakeProfits: config.partialTakeProfitEnabled
        ? [
            {
              id: "tp-1",
              price: this.partialTakeProfitPrice(request.side, request.entryPrice),
              quantityPercent: config.partialTakeProfitQuantityPercent,
              filled: false,
            },
          ]
        : [],
      realizedPnl: 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      score: request.score,
      confidence: request.confidence,
      metadata: request.metadata,
    };
    this.positions.set(position.id, position);
    tradingDomainLogger.tradeExecution({
      symbol: position.symbol,
      side: position.side,
      status: "POSITION_OPENED",
      context: { positionId: position.id, botId: position.botId, quantity: position.quantity },
    });
    return { allowed: true, position };
  }

  close(symbol: string) {
    const normalized = symbol.toUpperCase();
    const position = this.snapshot().find((item) => item.symbol === normalized || item.id === symbol);
    if (!position) return false;
    return this.positions.delete(position.id);
  }

  handleMarketTick(tick: MarketTick) {
    const updates: PositionUpdateResult[] = [];
    for (const position of this.snapshot().filter((item) => item.symbol === tick.symbol.toUpperCase())) {
      const update = this.stopManager.update(position, tick.price);
      updates.push(update);
      this.lastUpdateAt = Date.now();
      if (update.position.status === "CLOSED") {
        this.positions.delete(update.position.id);
        this.lastClosed = update.closed ?? null;
        tradingDomainLogger.pnlChange({
          symbol: update.position.symbol,
          positionId: update.position.id,
          pnl: update.position.realizedPnl,
          pnlPercent: update.position.unrealizedPnlPercent,
          level: update.position.realizedPnl < 0 ? "WARN" : "INFO",
        });
      } else {
        this.positions.set(update.position.id, update.position);
        tradingDomainLogger.pnlChange({
          symbol: update.position.symbol,
          positionId: update.position.id,
          pnl: update.position.unrealizedPnl,
          pnlPercent: update.position.unrealizedPnlPercent,
        });
      }
    }
    tradingFailsafeGuard.inspectPositions(this.snapshot());
    return updates;
  }

  updateDynamicStop(positionId: string, stopLoss: number) {
    const position = this.positions.get(positionId);
    if (!position || !Number.isFinite(stopLoss) || stopLoss <= 0) return false;
    this.positions.set(positionId, { ...position, stopLoss, updatedAt: new Date().toISOString() });
    return true;
  }

  snapshot() {
    return Array.from(this.positions.values()).filter((position) => position.status !== "CLOSED");
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: this.enabled ? "healthy" : "disabled",
      details: {
        openPositions: this.snapshot().length,
        symbols: this.snapshot().map((position) => position.symbol),
        lastUpdateAt: this.lastUpdateAt ? new Date(this.lastUpdateAt).toISOString() : null,
        lastClosed: this.lastClosed,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private defaultStopLoss(side: "BUY" | "SELL", entryPrice: number) {
    const factor = this.currentConfig().defaultStopLossPercent / 100;
    return Number((side === "BUY" ? entryPrice * (1 - factor) : entryPrice * (1 + factor)).toFixed(8));
  }

  private defaultTakeProfit(side: "BUY" | "SELL", entryPrice: number) {
    const factor = this.currentConfig().defaultTakeProfitPercent / 100;
    return Number((side === "BUY" ? entryPrice * (1 + factor) : entryPrice * (1 - factor)).toFixed(8));
  }

  private partialTakeProfitPrice(side: "BUY" | "SELL", entryPrice: number) {
    const factor = this.currentConfig().partialTakeProfitPercent / 100;
    return Number((side === "BUY" ? entryPrice * (1 + factor) : entryPrice * (1 - factor)).toFixed(8));
  }

  private currentConfig() {
    return this.config ?? getPositionManagerConfig();
  }
}

export type { ManagedPosition };
