/** Equal-notional reported-return PF. Legacy backfills contain gross returns. */
export function patternEconomics(returns: number[], modes: string[], netCostsVerified = false) {
  const values = returns.filter(Number.isFinite);
  const gains = values.reduce((n,v) => n + Math.max(v,0),0);
  const losses = values.reduce((n,v) => n + Math.max(-v,0),0);
  const expectancy = values.length ? (gains-losses)/values.length : 0;
  const profitFactor = losses > 0 ? gains/losses : undefined;
  const mixedModes = new Set(modes.map(m => m.toLowerCase())).size !== 1;
  const status: "WINNING" | "LOSING" | "NEUTRAL" = netCostsVerified && !mixedModes && values.length >= 30 && expectancy > 0 && profitFactor !== undefined && profitFactor > 1.05
    ? "WINNING" : expectancy < 0 ? "LOSING" : "NEUTRAL";
  return { expectancy, profitFactor, status, mixedModes, sampleSize: values.length,
    winRate: values.length ? values.filter(v => v>0).length/values.length*100 : 0,
    profitFactorStatus: profitFactor === undefined ? "NO_LOSS_DENOMINATOR" : "FINITE",
    economicValidation: netCostsVerified ? "NET_COST_BASIS_VERIFIED" : "COST_BASIS_UNVERIFIED",
    profitFactorBasis: netCostsVerified ? "EQUAL_NOTIONAL_NET_RETURN_PERCENT" : "EQUAL_NOTIONAL_REPORTED_RETURN_PERCENT" };
}
