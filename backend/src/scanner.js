// backend/src/scanner.js
import pLimit from "p-limit";
import { fetchAllContracts, fetchMexcFairPrice, fetchDailyCloses } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";

/**
 * ===== 구글시트 계산 상수 (절대 변경 금지) =====
 */
const TOP_N = 30;
const TREND_BAND_PCT = 0.3;     // ✅ 구글시트와 동일
const TURN_NEAR_PCT = 0.15;     // ✅ 구글시트와 동일
const USE_RSI_FILTER = true;    // ✅ 구글시트와 동일
const RSI_THRESHOLD = 50;

/**
 * ===== 표시 유지시간(요구사항) =====
 */
const TTL_CONFIRM_MS = 3 * 60 * 1000; // 3분
const TTL_NEAR_MS = 1 * 60 * 1000;    // 1분

/**
 * 상태 저장 (구글시트 SYM_TREND|sym 역할)
 */
const trendStore = new Map(); // uiSymbol -> "UP" | "DOWN" | "NEUTRAL" | "NONE"

/**
 * 신호 유지 저장소
 * - 심볼이 CONFIRM/NEAR가 한 번이라도 뜨면 TTL 동안 유지해서 출력
 */
const signalStore = new Map(); // uiSymbol -> { row, lastSeenMs, type }

/** ===== 구글시트 calcMA_ 동일 ===== */
function calcMA_(closes, period) {
  const arr = closes.slice(-period);
  return arr.reduce((a, b) => a + b, 0) / period;
}

/** ===== 구글시트 calcRSI_ 동일 ===== */
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

/** ===== 구글시트 trendFromPriceMa_ 동일 ===== */
function trendFromPriceMa_(price, ma30, prevTrend) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return "NONE";

  const upper = ma30 * (1 + TREND_BAND_PCT / 100);
  const lower = ma30 * (1 - TREND_BAND_PCT / 100);

  if (price >= lower && price <= upper) return prevTrend || "NEUTRAL";
  if (price > upper) return "UP";
  if (price < lower) return "DOWN";
  return prevTrend || "NEUTRAL";
}

/** ===== 구글시트 turnType_ 동일 ===== */
function turnType_(price, ma30, prevTrend, curTrend) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return null;

  const upper = ma30 * (1 + TREND_BAND_PCT / 100);
  const lower = ma30 * (1 - TREND_BAND_PCT / 100);

  // 전환확정
  if ((prevTrend === "UP" && curTrend === "DOWN") || (prevTrend === "DOWN" && curTrend === "UP")) {
    return "CONFIRM";
  }

  // 전환근접
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

/** ===== 구글시트 directionText_ 동일 ===== */
function directionText_(prevTrend, curTrend) {
  if (prevTrend === "UP" && curTrend === "DOWN") return "상승 → 하락 🔻";
  if (prevTrend === "DOWN" && curTrend === "UP") return "하락 → 상승 🔺";
  if (curTrend === "UP") return "상승 후보 ⬆";
  if (curTrend === "DOWN") return "하락 후보 ⬇";
  return "중립";
}

/** ===== 구글시트 typeText_ 동일 ===== */
function typeText_(type) {
  if (type === "CONFIRM") return "전환확정";
  if (type === "NEAR") return "전환근접";
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

function ttlForType(type) {
  return type === "CONFIRM" ? TTL_CONFIRM_MS : TTL_NEAR_MS;
}

/**
 * 심볼 1개 계산 (구글시트 turn_scanTop30 내부 계산과 동일)
 */
async function computeSnapForSymbol(uiSymbol, apiSymbol) {
  const price = await fetchMexcFairPrice(apiSymbol);    // fairPrice
  const closes = await fetchDailyCloses(apiSymbol, 31); // Day1 closes
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
 * TOP30 생성 (구글시트 renderTop30_ 동일) + "새 신호 맨위" + "TTL 유지"
 */
function buildTop30FromSnapsAndStore(snaps) {
  const now = Date.now();

  // (1) 이번 스캔에서 실제로 신호가 발생한 것만 store 갱신
  for (const s of snaps) {
    if (!s || s.err) continue;
    if (s.type !== "CONFIRM" && s.type !== "NEAR") continue;
    if (USE_RSI_FILTER && s.passRsi !== "Y") continue;

    // 점수(구글시트 동일)
    const scoreBase = (s.type === "CONFIRM") ? 1000000 : 0;
    const score = scoreBase + Math.abs(Number(s.devPct) || 0) * 1000;

    const row = {
      rank: 0, // 나중에 매김
      symbol: s.sym,
      direction: directionText_(s.prevTrend, s.curTrend),
      type: typeText_(s.type),
      bandPct: TREND_BAND_PCT,
      price: s.price,
      ma30: s.ma30,
      rsi14: s.rsi14,
      deviationPct: s.devPct,
      updated: new Date(s.updated).toLocaleString("ko-KR"),
      _typeRaw: s.type,
      _score: score,
      _seenMs: now
    };

    signalStore.set(s.sym, { row, lastSeenMs: now, type: s.type });
  }

  // (2) TTL 내에 있는 신호만 후보로
  const candidates = [];
  for (const [sym, v] of signalStore.entries()) {
    const ttl = ttlForType(v.type);
    if (now - v.lastSeenMs > ttl) {
      signalStore.delete(sym);
      continue;
    }

    // updated 표시도 최근으로
    const r = { ...v.row };
    r.updated = new Date(v.lastSeenMs).toLocaleString("ko-KR");
    r._seenMs = v.lastSeenMs;

    candidates.push(r);
  }

  // (3) 정렬: "새 신호가 맨 위" (최근 seen 우선) → 그 다음 CONFIRM 우선 → 그 다음 score
  candidates.sort((a, b) => {
    if (b._seenMs !== a._seenMs) return b._seenMs - a._seenMs;
    if (a._typeRaw !== b._typeRaw) return (a._typeRaw === "CONFIRM") ? -1 : 1;
    return (b._score || 0) - (a._score || 0);
  });

  const top = candidates.slice(0, TOP_N);

  // rank 다시 매김
  return top.map((r, idx) => {
    const out = { ...r };
    out.rank = idx + 1;
    delete out._typeRaw;
    delete out._score;
    delete out._seenMs;
    return out;
  });
}

/**
 * 전체 스캔
 * - 계약 전체에서 _USDT만
 * - 에러 난 심볼이 있어도 전체가 500으로 죽지 않게 방어
 */
export async function runTop30Scan({
  maxSymbols = Number(process.env.MAX_SYMBOLS || 80),
  concurrency = Number(process.env.CONCURRENCY || 1)
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
          // ✅ 중요: 에러는 로그만 남기고 null로 버림 (전체 500 방지)
          console.error("[SNAP ERROR]", uiSymbol, e?.message || e);
          return null;
        }
      })
    )
  );

  return buildTop30FromSnapsAndStore(snaps.filter(Boolean));
}
