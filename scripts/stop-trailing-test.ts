type TestResult = {
  label: string;
  profitPercent: number;
  stopLossTriggered: boolean;
  earlyProtectTriggered: boolean;
  activeStopPrice?: number | null;
};

function percentChange(from: number, to: number) {
  return ((to - from) / Math.max(from, 0.000001)) * 100;
}

function simulateStopAndTrailing(input: {
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  prices: number[];
}) {
  let lastActiveStopPrice: number | null = null;
  let peakProfitPercent = Number.NEGATIVE_INFINITY;
  let protectArmed = false;

  const targetProfitPercent = percentChange(input.entryPrice, input.takeProfitPrice);

  const results: TestResult[] = [];
  for (const price of input.prices) {
    const profitPercent = percentChange(input.entryPrice, price);
    const stopLossTriggered = price <= input.stopLossPrice;

    if (profitPercent >= 4) {
      protectArmed = true;
      const trailingGap = 0.4;
      const candidateStopPercent = Math.max(0.2, profitPercent - trailingGap);
      const candidateStopPrice = input.entryPrice * (1 + candidateStopPercent / 100);
      if (!lastActiveStopPrice || candidateStopPrice > lastActiveStopPrice) {
        lastActiveStopPrice = Number(candidateStopPrice.toFixed(6));
      }
    }

    peakProfitPercent = Math.max(peakProfitPercent, profitPercent);
    const drawdownFromPeak = peakProfitPercent - profitPercent;
    const floorProtect = Math.max(1, targetProfitPercent - 1);
    const earlyProtectTriggered =
      protectArmed && profitPercent <= floorProtect && drawdownFromPeak >= 0.25;

    results.push({
      label: price.toFixed(2),
      profitPercent: Number(profitPercent.toFixed(2)),
      stopLossTriggered,
      earlyProtectTriggered,
      activeStopPrice: lastActiveStopPrice,
    });
  }

  return results;
}

function run() {
  const entry = 100;
  const takeProfit = 105;
  const stopLoss = 99;

  const path = [100, 102, 104.5, 103.9, 100, 99];
  const results = simulateStopAndTrailing({
    entryPrice: entry,
    takeProfitPrice: takeProfit,
    stopLossPrice: stopLoss,
    prices: path,
  });

  console.log("Stop/trailing test (entry=100, TP=105, SL=99)");
  for (const row of results) {
    console.log(
      `price=${row.label} profit=${row.profitPercent}% stopLoss=${row.stopLossTriggered} ` +
        `earlyProtect=${row.earlyProtectTriggered} activeStop=${row.activeStopPrice ?? "-"}`,
    );
  }
}

run();
