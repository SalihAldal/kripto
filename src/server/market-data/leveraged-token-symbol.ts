// Known leveraged-product identifiers, not a substring test: JUP, SYRUP and SUPER
// are ordinary asset names. Exchange eligibility/filters remain separate checks.
const UNDERLYINGS = ["BTC", "ETH", "BNB", "XRP", "EOS", "TRX", "LINK", "ADA", "XTZ", "DOT", "YFI", "UNI", "AAVE", "SUSHI", "BCH", "LTC", "FIL", "SXP", "1INCH"];
const PRODUCTS = new Set(UNDERLYINGS.flatMap(base => ["UP", "DOWN", "BULL", "BEAR"].map(suffix => base + suffix)));
export function isKnownLeveragedToken(symbolOrBase: string) {
  const normalized = symbolOrBase.toUpperCase().replace(/_/g, "");
  if (PRODUCTS.has(normalized)) return true;
  return PRODUCTS.has(normalized.replace(/(?:USDT|TRY|BUSD|USDC)$/, ""));
}
