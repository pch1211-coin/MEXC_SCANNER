import pLimit from "p-limit";
import { fetchAllContracts, fetchMexcFairPrice, fetchDailyCloses } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";

/**
 * === 기본 상수 ===
 * (구글시트 로직 기반)
 */
const TOP_N = 30;
const DEFAULT_TREND_BAND_PCT = 0.5;
const TURN_NEAR_PCT = 0.3;
const RSI_THRESHOLD = 50;

// 상태 저장 (Render 재시작/슬립이면 초기화될 수 있음)
const trendStore = new Map(); // uiSymbol -> "UP" | "DOWN" | "NEUTRAL" | "NONE"

function calcMA_(closes, period) {
  const arr = closes.slice(-period);
  return arr.reduce((a, b) => a + b, 0) / period;
}

function calcRSI_(closes, period = 14) {
  const arr = closes.slice(-(period + 1));
  if (arr.length < period + 1) return NaN;

  let gains = 0, losses = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    if (diff >= 0) gains += diff;
    else losses += (-diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function trendFromPriceMa_(price, ma30, prevTrend, trendBandPct) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return "NONE";

  const upper = ma30 * (1 + trendBandPct / 100);
  const lower = ma30 * (1 - trendBandPct / 100);

  if (price >= lower && price <= upper) return prevTrend || "NEUTRAL";
  if (price > upper) return "UP";
  if (price < lower) return "DOWN";
  return prevTrend || "NEUTRAL";
}

function turnType_(price, ma30, prevTrend, curTrend, trendBandPct) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return null;

  const upper = ma30 * (1 + trendBandPct / 100);
  const lower = ma30 * (1 - trendBandPct / 100);

  if ((prevTrend === "UP" && curTrend === "DOWN") || (prevTrend === "DOWN" && curTrend === "UP")) {
    return "CONFIRM";
  }

  const distPct = (a, b) => (Math.abs(a - b) / a) * 100;

  if (prevTrend === "UP") {
    if (distPct(price, lower) <= TURN_NEAR_PCT) return "NEAR";
  } else if (prevTrend === "DOWN") {
    if (distPct(price, upper) <= TURN_NEAR_PCT) return "NEAR";
  } else {
    if (Math.min(distPct(price, lower), distPct(price, upper)) <= TURN_NEAR_PCT) return "NEAR";
  }

  return null;
}

function directionText_(prevTrend, curTrend) {
  if (prevTrend === "UP" && curTrend === "DOWN") return "상승 → 하락 🔻";
  if (prevTrend === "DOWN" && curTrend === "UP") return "하락 → 상승 🔺";
  if (curTrend === "UP") return "상승 후보 ⬆";
  if (curTrend === "DOWN") return "하락 후보 ⬇";
  return "중립";
}

function typeText_(type) {
  if (type === "CONFIRM") return "전환확정";
  if (type === "NEAR") return "전환근접";
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

async function computeSnapForSymbol(uiSymbol, apiSymbol, trendBandPct, useRsiFilter) {
  const price = await fetchMexcFairPrice(apiSymbol);
  const closes = await fetchDailyCloses(apiSymbol, 31);

  const ma30 = calcMA_(closes, 30);
  const rsi14 = calcRSI_(closes, 14);

  const prevTrend = String(trendStore.get(uiSymbol) || "");
  const curTrend = trendFromPriceMa_(price, ma30, prevTrend, trendBandPct);
  const type = turnType_(price, ma30, prevTrend, curTrend, trendBandPct);

  let passRsi = true;
  if (useRsiFilter && Number.isFinite(rsi14)) {
    if (curTrend === "UP") passRsi = (rsi14 >= RSI_THRESHOLD);
    else if (curTrend === "DOWN") passRsi = (rsi14 <= RSI_THRESHOLD);
  }

  const devPct = (ma30 && Number.isFinite(ma30)) ? ((price - ma30) / ma30) * 100 : NaN;

  if (curTrend !== "NONE") trendStore.set(uiSymbol, curTrend);

  return {
    sym: uiSymbol,
    price,
    ma30,
    rsi14,
    devPct,
    prevTrend: prevTrend || "",
    curTrend,
    type: type || "",
    passRsi: passRsi ? "Y" : "N",
    updated: nowIso()
  };
}

function buildTop30FromSnaps(snaps, trendBandPct, useRsiFilter) {
  const candidates = [];

  for (const s of snaps) {
    if (!s || s.err) continue;
    if (s.type !== "CONFIRM" && s.type !== "NEAR") continue;
    if (useRsiFilter && s.passRsi !== "Y") continue;

    const scoreBase = (s.type === "CONFIRM") ? 1000000 : 0;
    const score = scoreBase + Math.abs(Number(s.devPct) || 0) * 1000;
    candidates.push({ ...s, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, TOP_N);

  return top.map((s, idx) => ({
    rank: idx + 1,
    symbol: s.sym,
    direction: directionText_(s.prevTrend, s.curTrend),
    type: typeText_(s.type),
    bandPct: trendBandPct,
    price: s.price,
    ma30: s.ma30,
    rsi14: s.rsi14,
    deviationPct: s.devPct,
    updated: new Date(s.updated).toLocaleString("ko-KR")
  }));
}

/**
 * ✅ 전체 스캔
 * - maxSymbols = 50 (server.js에서 강제로 넘겨줌)
 * - concurrency 낮게
 */
export async function runTop30Scan({
  interval = "Min15",
  limit = 200,
  maxSymbols = Number(process.env.MAX_SYMBOLS || 50),
  concurrency = Number(process.env.CONCURRENCY || 2),
  cfg = {}
} = {}) {
  const trendBandPct = Number(cfg.TREND_BAND_PCT ?? DEFAULT_TREND_BAND_PCT);
  const useRsiFilter = String(cfg.RSI50_FILTER ?? "true") !== "false";

  const contracts = await fetchAllContracts();

  const apiSymbols = (contracts ?? [])
    .map((c) => c?.symbol)
    .filter((s) => typeof s === "string" && s.endsWith("_USDT"))
    .slice(0, maxSymbols);

  const limiter = pLimit(concurrency);

  const snaps = await Promise.all(
    apiSymbols.map((apiSymbol) =>
      limiter(async () => {
        const uiSymbol = apiToUiSymbol(apiSymbol);
        try {
          return await computeSnapForSymbol(uiSymbol, apiSymbol, trendBandPct, useRsiFilter);
        } catch (e) {
          return { sym: uiSymbol, err: String(e?.message || e), updated: nowIso() };
        }
      })
    )
  );

  return buildTop30FromSnaps(snaps, trendBandPct, useRsiFilter);
}
