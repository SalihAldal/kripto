const start = Date.parse("2026-06-15T00:00:00Z");
const end = Date.parse("2026-07-15T00:00:00Z");
const sym = "BTCUSDT";
const base = "https://fapi.binance.com";

async function probe(name: string, url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const arr = Array.isArray(j) ? j : [j];
    const first = arr[0];
    const last = arr[arr.length - 1];
    console.log(
      name,
      "status",
      r.status,
      "count",
      arr.length,
      "first",
      JSON.stringify(first)?.slice(0, 150),
      "last",
      JSON.stringify(last)?.slice(0, 150),
    );
  } catch (e) {
    console.log(name, "ERR", e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  await probe("fundingRate", `${base}/fapi/v1/fundingRate?symbol=${sym}&startTime=${start}&endTime=${end}&limit=500`);
  await probe("oiHist5m", `${base}/futures/data/openInterestHist?symbol=${sym}&period=5m&startTime=${start}&endTime=${end}&limit=500`);
  await probe("globalLS", `${base}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&startTime=${start}&endTime=${end}&limit=500`);
  await probe("topLS", `${base}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=5m&startTime=${start}&endTime=${end}&limit=500`);
  await probe("markKlines", `${base}/fapi/v1/markPriceKlines?symbol=${sym}&interval=1h&startTime=${start}&endTime=${end}&limit=500`);
  await probe("indexKlines", `${base}/fapi/v1/indexPriceKlines?pair=BTCUSDT&interval=1h&startTime=${start}&endTime=${end}&limit=500`);
  await probe("premiumIndex", `${base}/fapi/v1/premiumIndex?symbol=${sym}`);
  await probe("forceOrders", `${base}/fapi/v1/allForceOrders?symbol=${sym}&startTime=${start}&endTime=${end}&limit=100`);
  await probe("aggTrades", `https://api.binance.com/api/v3/aggTrades?symbol=${sym}&startTime=${start}&endTime=${start + 3_600_000}&limit=100`);
  await probe("futuresKlines", `${base}/fapi/v1/klines?symbol=${sym}&interval=1h&startTime=${start}&endTime=${end}&limit=100`);
  await probe("oiLimit500", `${base}/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=500`);
  await probe("lsLimit500", `${base}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=500`);
  const recent = Date.now() - 30 * 86_400_000;
  await probe("oiRecent", `${base}/futures/data/openInterestHist?symbol=${sym}&period=5m&startTime=${recent}&limit=500`);
  const jul1 = Date.parse("2026-07-01T00:00:00Z");
  const jul15 = Date.parse("2026-07-15T00:00:00Z");
  await probe("oiJul", `${base}/futures/data/openInterestHist?symbol=${sym}&period=5m&startTime=${jul1}&endTime=${jul15}&limit=500`);
  await probe("takerRatio", `${base}/futures/data/takerlongshortRatio?symbol=${sym}&period=5m&limit=100`);
  await probe("basisHist", `${base}/fapi/v1/premiumIndexKlines?symbol=${sym}&interval=1h&startTime=${start}&endTime=${end}&limit=500`);
}

main();
