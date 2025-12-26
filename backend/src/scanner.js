import pLimit from "p-limit";
import { fetchAllContracts, fetchMexcFairPrice, fetchDailyCloses } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";

/**
 * === 구글시트 상수 그대로 ===
 */
const TOP_N = 30;
const TREND_BAND_PCT = 0.5;
const TURN_NEAR_PCT = 0.5;
const USE_RSI_FILTER = true;
const RSI_THRESHOLD = 50;

/**
 * 상태 저장: SYM_TREND|${sym} 와 동일한 역할
 * (Render 재시작/슬립이면 초기화될 수 있음 — 계산방식은 동일)
 */
const trendStore = new Map(); // uiSymbol -> "UP" | "DOWN" | "NEUTRAL" | "NONE"

/** === 구글시트 calcMA_ 동일 === */
function calcMA_(closes, period) {
  const arr = closes.slice(-period);
  return arr.reduce((a, b) => a + b, 0) / period;
}

/** === 구글시트 calcRSI_ 동일 (Wilder 스무딩 아님: 마지막 15개만 평균) === */
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
 * === 핵심: 심볼 하나 계산(구글시트 turn_scanTop30 내부 계산과 동일) ===
 */
async function computeSnapForSymbol(uiSymbol, apiSymbol) {
  const price = await fetchMexcFairPrice(apiSymbol);          // fairPrice
  const closes = await fetchDailyCloses(apiSymbol, 31);       // Day1 closes
  const ma30 = calcMA_(closes, 30);
  const rsi14 = calcRSI_(closes, 14);

  const prevTrend = String(trendStore.get(uiSymbol) || "");
  const curTrend = trendFromPriceMa_(price, ma30, prevTrend);
  const type = turnType_(price, ma30, prevTrend, curTrend);

  // RSI 50 필터 (구글시트 동일)
  let passRsi = true;
  if (USE_RSI_FILTER && Number.isFinite(rsi14)) {
    if (curTrend === "UP") passRsi = (rsi14 >= RSI_THRESHOLD);
    else if (curTrend === "DOWN") passRsi = (rsi14 <= RSI_THRESHOLD);
  }

  const devPct = (ma30 && Number.isFinite(ma30)) ? ((price - ma30) / ma30) * 100 : NaN;

  // 다음 비교용 trend 저장 (구글시트 동일)
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
 * === TOP30 구성(구글시트 renderTop30_ 동일) ===
 */
function buildTop30FromSnaps(snaps) {
  const candidates = [];

  for (const s of snaps) {
    if (!s || s.err) continue;

    if (s.type !== "CONFIRM" && s.type !== "NEAR") continue;
    if (USE_RSI_FILTER && s.passRsi !== "Y") continue;

    const scoreBase = (s.type === "CONFIRM") ? 1000000 : 0;
    const score = scoreBase + Math.abs(Number(s.devPct) || 0) * 1000;

    candidates.push({ ...s, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, TOP_N);

  // API 응답 형태(웹 테이블용)
  return top.map((s, idx) => ({
    rank: idx + 1,
    symbol: s.sym,
    direction: directionText_(s.prevTrend, s.curTrend),
    type: typeText_(s.type),
    bandPct: TREND_BAND_PCT,          // 구글시트 출력: TREND_BAND_PCT 그대로
    price: s.price,
    ma30: s.ma30,
    rsi14: s.rsi14,
    deviationPct: s.devPct,
    updated: new Date(s.updated).toLocaleString("ko-KR")
  }));
}

/**
 * === 전체 스캔 ===
 * - WATCHLIST 대신: 선물 계약 전체에서 _USDT만 사용
 * - maxSymbols로 속도 조절
 */
export async function runTop30Scan({
  maxSymbols = Number(process.env.MAX_SYMBOLS || 80),
  concurrency = Number(process.env.CONCURRENCY || 2)
} = {}) {
  const contracts = await fetchAllContracts();

  // USDT 계약만
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

  return buildTop30FromSnaps(snaps);
}
