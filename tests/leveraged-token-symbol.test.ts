import { expect, it } from "vitest";
import { isKnownLeveragedToken } from "@/src/server/market-data/leveraged-token-symbol";
import { filterTradeableUniverse } from "@/src/server/market-data/spine/universe";
it("retains ordinary names containing UP and excludes known leveraged products", () => {
  for (const symbol of ["JUP", "JUPTRY", "JUPUSDT", "SUPERTRY", "SYRUPUSDT", "PUMPTRY"]) expect(isKnownLeveragedToken(symbol)).toBe(false);
  for (const symbol of ["BTCUP", "BTCUPUSDT", "ETHDOWNTRY", "ETHDOWN_TRY"]) expect(isKnownLeveragedToken(symbol)).toBe(true);
  const symbols = ["JUP", "SUPER", "SYRUP", "BTCUP"].map(baseAsset => ({ symbol: `${baseAsset}TRY`, baseAsset, quoteAsset: "TRY", status: "TRADING" }));
  expect(filterTradeableUniverse(symbols, { quoteAssets: ["TRY"] }).map(s => s.baseAsset)).toEqual(["JUP", "SUPER", "SYRUP"]);
});
