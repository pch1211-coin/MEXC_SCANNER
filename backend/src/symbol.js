// backend/src/symbol.js

// API: BTC_USDT  -> UI: BTCUSDT
export function apiToUiSymbol(apiSymbol) {
  const s = String(apiSymbol || "").toUpperCase().trim();
  return s.replace("_", "");
}
