import pLimit from "p-limit";
import { fetchAllContracts, fetchMexcFairPrice, fetchDailyCloses } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";

/**
 * === 기본값(기존과 동일하게 유지) ===
 * TOP_N만 "기본 30" + "쿼리/환경변수로 변경 가능"하게 만듦
 */
const DEFAULT_TOP_N = Number(process.env.TOP_N || 30); // ✅ 30/50/100 가능
const TREND_BAND_PCT = 0.5;
const TURN_NEAR_PCT = 0.3;
const USE_RSI_FILTER = true;
const RSI_THRESHOLD = 50;

/**
 * ✅ 변동성(Dev%) 필터 강화용 추가
 * - Dev% 절대값이 이 값보다 작은 코인은 후보에서 제외
 * - 기본 0.0이면 기존과 완전히 동일
 */
const MIN_ABS_DEV_PCT = Number(process.env.MIN_ABS_DEV_PCT || 0.0); // 예: 0.8, 1.2 등

/**
 * 상태 저장 (기존 유지)
 */
const trendStore = new Map(); // uiSymbol -> "UP" | "DOWN" | "NEUTRAL" | "NONE"

/** === 구글시트 calcMA_ 동일 === */
function calcMA_(closes, period) {
  const arr = closes.slice(-period);
  return arr.reduce((a, b) => a + b, 0) / period;
}

/** === 구글시트 calcRSI_ 동일 === */
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

/** === 구글시트 trendFromPriceMa_ 동일 === */
function trendFromPriceMa_(price, ma30, prevTrend) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return "NONE";

  const upper = ma30 * (1 + TREND_BAND_PCT / 100);
  const lower = ma30 * (1 - TREND_BAND_PCT / 100);

  if (price >= lower && price <= upper) return prevTrend || "NEUTRAL";
  if (price > upper) return "UP";
  if (price < lower) return "DOWN";
  return prevTrend || "NEUTRAL";
}

/** === 구글시트 turnType_ 동일 === */
function turnType_(price, ma30, prevTrend, curTrend) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return null;

  const upper = ma30 * (1 + TREND_BAND_PCT / 100);
  const lower = ma30 * (1 - TREND_BAND_PCT / 100);

  if ((prevTrend === "UP" && curTrend === "DOWN") || (prevTrend === "DOWN" && curTrend === "UP")) {
    return "CONFIRM";
  }

  const distPct = (a, b) => Math.abs(a - b) / a * 100;

  if (prevTrend === "UP") {
    if (distPct(price, lower) <= TURN_NEAR_PCT) return "NEAR";
  } else if (prevTrend === "DOWN") {
    if (distPct(price, upper) <= TURN_NEAR_PCT) return "NEAR";
  } else {
    if (Math.min(distPct(price, lower), distPct(price, upper)) <= TURN_NEAR_PCT) return "NEAR";
  }

  return null;
}

/** === 구글시트 directionText_ 동일 === */
function directionText_(prevTrend, curTrend) {
  if (prevTrend === "UP" && curTrend === "DOWN") return "상승 → 하락 🔻";
  if (prevTrend === "DOWN" && curTrend === "UP") return "하락 → 상승 🔺";
  if (curTrend === "UP") return "상승 후보 ⬆";
  if (curTrend === "DOWN") return "하락 후보 ⬇";
  return "중립";
}

/** === 구글시트 typeText_ 동일 === */
function typeText_(type) {
  if (type === "CONFIRM") return "전환확정";
  if (type === "NEAR") return "전환근접";
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * === 심볼 하나 계산(기존 유지) ===
 */
async function computeSnapForSymbol(uiSymbol, apiSymbol) {
  const price = await fetchMexcFairPrice(apiSymbol);
  const closes = await fetchDailyCloses(apiSymbol, 31);
  const ma30 = calcMA_(closes, 30);
  const rsi14 = calcRSI_(closes, 14);

  const prevTrend = String(trendStore.get(uiSymbol) || "");
  const curTrend = trendFromPriceMa_(price, ma30, prevTrend);
  const type = turnType_(price, ma30, prevTrend, curTrend);

  // RSI 50 필터 (기존 동일)
  let passRsi = true;
  if (USE_RSI_FILTER && Number.isFinite(rsi14)) {
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

/**
 * ✅ TOPN 구성 (기존 로직 유지 + "최소 변동성 컷"만 추가 + TOP_N 가변)
 */
function buildTopNFromSnaps(snaps, topN = DEFAULT_TOP_N) {
  const candidates = [];

  for (const s of snaps) {
    if (!s || s.err) continue;

    // 기존: 전환확정/근접만
    if (s.type !== "CONFIRM" && s.type !== "NEAR") continue;

    // 기존: RSI 필터
    if (USE_RSI_FILTER && s.passRsi !== "Y") continue;

    // ✅ 추가: 변동성(Dev%) 절대값 컷
    const absDev = Math.abs(Number(s.devPct) || 0);
    if (MIN_ABS_DEV_PCT > 0 && absDev < MIN_ABS_DEV_PCT) continue;

    // 기존 점수: CONFIRM 가중 + abs(devPct)
    const scoreBase = (s.type === "CONFIRM") ? 1000000 : 0;
    const score = scoreBase + absDev * 1000;

    candidates.push({ ...s, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, Math.max(1, Number(topN) || DEFAULT_TOP_N));

  return top.map((s, idx) => ({
    rank: idx + 1,
    symbol: s.sym,
    direction: directionText_(s.prevTrend, s.curTrend),
    type: typeText_(s.type),
    bandPct: TREND_BAND_PCT,
    price: s.price,
    ma30: s.ma30,
    rsi14: s.rsi14,
    deviationPct: s.devPct,
    updated: new Date(s.updated).toLocaleString("ko-KR")
  }));
}

/**
 * === 전체 스캔 (기존 유지 + topN 인자 추가) ===
 */
export async function runTop30Scan({
  maxSymbols = Number(process.env.MAX_SYMBOLS || 80),
  concurrency = Number(process.env.CONCURRENCY || 2),
  topN = DEFAULT_TOP_N
} = {}) {
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
          return await computeSnapForSymbol(uiSymbol, apiSymbol);
        } catch (e) {
          return { sym: uiSymbol, err: String(e?.message || e), updated: nowIso() };
        }
      })
    )
  );

  return buildTopNFromSnaps(snaps, topN);
}
