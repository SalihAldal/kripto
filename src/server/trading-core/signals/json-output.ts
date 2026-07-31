import type { ExecutionResult, SignalDecision } from "@/src/server/trading-core/core/types";

export type SignalEngineJsonOutput = {
  ok: true;
  signal: SignalDecision;
  execution: ExecutionResult | null;
};

export function toSignalJson(signal: SignalDecision, execution: ExecutionResult | null): SignalEngineJsonOutput {
  return {
    ok: true,
    signal,
    execution,
  };
}
