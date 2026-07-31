import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import type { ProtectionState, ProtectionViolation } from "@/src/server/trading-core/protection/protection-types";

const MAX_VIOLATIONS = 200;

export class FailsafeStateStore {
  private state: ProtectionState = {
    emergencyStop: tradingCoreFlags.emergencyStop,
    closeOnlyMode: tradingCoreFlags.closeOnlyMode,
    dailyLossPercent: 0,
    maxDrawdownPercent: 0,
    peakEquity: 0,
    currentEquity: 0,
    duplicateOrderBlocks: 0,
    apiSpamBlocks: 0,
    websocketDisconnects: 0,
    stuckPositions: 0,
    abnormalVolatilityEvents: 0,
    violations: [],
    updatedAt: new Date().toISOString(),
  };

  snapshot(): ProtectionState {
    return {
      ...this.state,
      emergencyStop: tradingCoreFlags.emergencyStop || this.state.emergencyStop,
      closeOnlyMode: tradingCoreFlags.closeOnlyMode || this.state.closeOnlyMode,
      violations: [...this.state.violations],
    };
  }

  addViolation(violation: Omit<ProtectionViolation, "createdAt">) {
    const item = { ...violation, createdAt: new Date().toISOString() };
    this.state.violations.unshift(item);
    if (this.state.violations.length > MAX_VIOLATIONS) this.state.violations.length = MAX_VIOLATIONS;
    if (item.type === "DUPLICATE_ORDER") this.state.duplicateOrderBlocks += 1;
    if (item.type === "API_SPAM") this.state.apiSpamBlocks += 1;
    if (item.type === "WEBSOCKET_DISCONNECT") this.state.websocketDisconnects += 1;
    if (item.type === "STUCK_POSITION") this.state.stuckPositions += 1;
    if (item.type === "ABNORMAL_VOLATILITY") this.state.abnormalVolatilityEvents += 1;
    this.touch();
    return item;
  }

  updateEquity(currentEquity: number, dailyStartEquity?: number) {
    if (!Number.isFinite(currentEquity) || currentEquity <= 0) return this.snapshot();
    const peak = Math.max(this.state.peakEquity || currentEquity, currentEquity);
    const drawdown = peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0;
    const dailyLoss =
      dailyStartEquity && dailyStartEquity > 0 && currentEquity < dailyStartEquity
        ? ((dailyStartEquity - currentEquity) / dailyStartEquity) * 100
        : this.state.dailyLossPercent;
    this.state = {
      ...this.state,
      peakEquity: peak,
      currentEquity,
      maxDrawdownPercent: Number(Math.max(this.state.maxDrawdownPercent, drawdown).toFixed(4)),
      dailyLossPercent: Number(Math.max(this.state.dailyLossPercent, dailyLoss).toFixed(4)),
      updatedAt: new Date().toISOString(),
    };
    return this.snapshot();
  }

  setEmergencyStop(enabled: boolean) {
    this.state.emergencyStop = enabled;
    this.touch();
  }

  setCloseOnly(enabled: boolean) {
    this.state.closeOnlyMode = enabled;
    this.touch();
  }

  private touch() {
    this.state.updatedAt = new Date().toISOString();
  }
}

const globalStore = globalThis as typeof globalThis & { __tradingFailsafeState?: FailsafeStateStore };
export const tradingFailsafeState = globalStore.__tradingFailsafeState ?? new FailsafeStateStore();
globalStore.__tradingFailsafeState = tradingFailsafeState;
