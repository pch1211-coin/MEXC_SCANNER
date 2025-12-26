export function uiToApiSymbol(uiSymbol) {
  // UI: BTCUSDT  -> API: BTC_USDT (USDT-M 가정)
  if (typeof uiSymbol !== "string") return "";
  if (!uiSymbol.endsWith("USDT")) return uiSymbol;
  return uiSymbol.replace("USDT", "_USDT");
}

export function apiToUiSymbol(apiSymbol) {
  // API: BTC_USDT -> UI: BTCUSDT
  if (typeof apiSymbol !== "string") return "";
  return apiSymbol.replace("_", "");
}
