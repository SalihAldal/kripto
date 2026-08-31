export type ExecutionPort = {
  kind: "PAPER" | "LIVE";
  submit(input: unknown): Promise<unknown> | unknown;
};

export class PaperExecutionAdapter implements ExecutionPort {
  readonly kind = "PAPER" as const;
  submitLiveBinanceOrder(): never {
    throw new Error("PAPER_ADAPTER_NO_LIVE_ENDPOINT");
  }
  submit(input: unknown) {
    return input;
  }
}

export class BinanceLiveExecutionAdapter implements ExecutionPort {
  readonly kind = "LIVE" as const;
  submit(): never {
    throw new Error("LIVE_ADAPTER_HARD_LOCKED");
  }
}

export function resolveExecutionAdapter(mode: string): ExecutionPort {
  if (mode === "live") return new BinanceLiveExecutionAdapter();
  return new PaperExecutionAdapter();
}
