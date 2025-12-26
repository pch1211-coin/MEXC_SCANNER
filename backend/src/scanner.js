import pLimit from "p-limit";
import { fetchAllContracts, fetchMexcFairPrice, fetchDailyCloses } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";

/**
 * === 구글시트 계산방식 유지 ===
 * - MA30, RSI14, Band, Near, Score 계산은 동일
 * - "표시 유지시간(HOLD)"만 추가
 */
const TOP_N = 30;

// 상태 저장(구글시트 SYM_TREND|sym 역할)
const trendStore = new Map(); // uiSymbol -> "UP" | "DOWN" | "NEUTRAL" | "NONE"

/**
 * ✅ 표시 유지(요청사항)
 * - CONFIRM: 3분
 * - NEAR: 1분
 * - 새 신호(처음 뜸 / 타입이 바뀜)는 맨 위로
 */
const HOLD_CONFIRM_MS = 3 * 60 * 1000; // 3분
const HOLD_NEAR_MS = 1 * 60 * 1000;    // 1분

// uiSymbol -> { snap, seenAt, expiresAt }
const holdStore = new Map();

function ttlMsByType(type) {
  if (type === "CONFIRM") return HOLD_CONFIRM_MS;
  if (type === "NEAR") return HOLD_NEAR_MS;
  return 0;
}

/** === 구글시트 calcMA_ 동일 === */
function calcMA_(closes, period) {
  const arr = closes.slice(-period);
  return arr.reduce((a, b) => a + b, 0) / period;
}

/** === 구글시트 calcRSI_ 동일(최근 15개 평균) === */
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

/** === 구글시트 trendFromPriceMa_ 동일 (bandPct만 cfg로 받음) === */
function trendFromPriceMa_(price, ma30, prevTrend, bandPct) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return "NONE";

  const upper = ma30 * (1 + bandPct / 100);
  const lower = ma30 * (1 - bandPct / 100);

  if (price >= lower && price <= upper) return prevTrend || "NEUTRAL";
  if (price > upper) return "UP";
  if (price < lower) return "DOWN";
  return prevTrend || "NEUTRAL";
}

/** === 구글시트 turnType_ 동일 (bandPct/nearPct만 cfg로 받음) === */
function turnType_(price, ma30, prevTrend, curTrend, bandPct, nearPct) {
  if (!Number.isFinite(price) || !Number.isFinite(ma30) || ma30 === 0) return null;

  const upper = ma30 * (1 + bandPct / 100);
  const lower = ma30 * (1 - bandPct / 100);

  // 전환확정
  if ((prevTrend === "UP" && curTrend === "DOWN") || (prevTrend === "DOWN" && curTrend === "UP")) {
    return "CONFIRM";
  }

  // 전환근접
  const distPct = (a, b) => (Math.abs(a - b) / a) * 100;

  if (prevTrend === "UP") {
    if (distPct(price, lower) <= nearPct) return "NEAR";
  } else if (prevTrend === "DOWN") {
    if (distPct(price, upper) <= nearPct) return "NEAR";
  } else {
    if (Math.min(distPct(price, lower), distPct(price, upper)) <= nearPct) return "NEAR";
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

/**
 * ✅ holdStore 업데이트
 * - 조건을 만족(표시대상)한 경우에만 hold 생성/갱신
 * - "새 신호" 정의:
 *   1) 기존 hold가 없던 종목이 처음 CONFIRM/NEAR로 뜸
 *   2) 기존 hold의 type이 바뀜 (NEAR→CONFIRM, CONFIRM→NEAR 등)
 * - 새 신호면 seenAt을 "지금"으로 갱신해서 맨 위로 오게 함
 * - 새 신호가 아니면 seenAt은 유지(계속 맨 위로 고정되는 현상 방지)
 */
function upsertHold_(uiSymbol, snap, cfg) {
  const type = snap?.type;
  const isTypeOk = (type === "CONFIRM" || type === "NEAR");
  if (!isTypeOk) return;

  // RSI 필터를 쓰는 경우 passRsi 통과한 것만 hold 저장(표시 로직만, 계산은 그대로)
  if (cfg.USE_RSI_FILTER && snap.passRsi !== "Y") return;

  const now = Date.now();
  const ttl = ttlMsByType(type);
  if (!ttl) return;

  const prev = holdStore.get(uiSymbol);

  const isNewSignal =
    !prev || !prev.snap || prev.snap.type !== type;

  const seenAt = isNewSignal ? now : prev.seenAt; // ✅ 새 신호만 맨 위로
  const expiresAt = now + ttl;

  holdStore.set(uiSymbol, {
    snap: { ...snap },
    seenAt,
    expiresAt
  });
}

function cleanupHolds_() {
  const now = Date.now();
  for (const [sym, v] of holdStore.entries()) {
    if (!v || !v.expiresAt || now > v.expiresAt) {
      holdStore.delete(sym);
    }
  }
}

function getHoldMeta_(uiSymbol) {
  const v = holdStore.get(uiSymbol);
  if (!v) return { seenAt: 0, expiresAt: 0 };
  return { seenAt: Number(v.seenAt) || 0, expiresAt: Number(v.expiresAt) || 0 };
}

/**
 * === 심볼 하나 계산(구글시트 계산과 동일) ===
 */
async function computeSnapForSymbol(uiSymbol, apiSymbol, cfg) {
  const price = await fetchMexcFairPrice(apiSymbol); // fairPrice
  const closes = await fetchDailyCloses(apiSymbol, 31); // Day1 closes
  const ma30 = calcMA_(closes, 30);
  const rsi14 = calcRSI_(closes, 14);

  const prevTrend = String(trendStore.get(uiSymbol) || "");
  const curTrend = trendFromPriceMa_(price, ma30, prevTrend, cfg.TREND_BAND_PCT);
  const type = turnType_(price, ma30, prevTrend, curTrend, cfg.TREND_BAND_PCT, cfg.TURN_NEAR_PCT);

  // RSI 50 필터(구글시트 동일)
  let passRsi = true;
  if (cfg.USE_RSI_FILTER && Number.isFinite(rsi14)) {
    if (curTrend === "UP") passRsi = rsi14 >= cfg.RSI_THRESHOLD;
    else if (curTrend === "DOWN") passRsi = rsi14 <= cfg.RSI_THRESHOLD;
  }

  const devPct = Number.isFinite(ma30) && ma30 !== 0 ? ((price - ma30) / ma30) * 100 : NaN;

  // 다음 비교용 trend 저장
  if (curTrend !== "NONE") trendStore.set(uiSymbol, curTrend);

  const snap = {
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

  // ✅ 표시 유지 로직(계산은 그대로, 표시만 유지)
  upsertHold_(uiSymbol, snap, cfg);

  return snap;
}

/**
 * === TOP30 구성(구글시트 renderTop30_ 동일) ===
 * ✅ 추가: 새 신호(holdStore.seenAt 최신) 우선 정렬
 * - 점수(score) 계산은 그대로 유지
 */
function buildTop30FromSnaps(snaps, cfg) {
  // ✅ hold 만료 정리
  cleanupHolds_();

  // ✅ 이번 스캔 결과에 없더라도, hold에 남아있으면 후보에 포함(표시 유지)
  const snapMap = new Map();
  for (const s of snaps) {
    if (s?.sym) snapMap.set(s.sym, s);
  }
  for (const [sym, v] of holdStore.entries()) {
    if (!snapMap.has(sym) && v?.snap) {
      snaps.push(v.snap);
    }
  }

  const candidates = [];

  for (const s of snaps) {
    if (!s || s.err) continue;

    // 전환근접/확정만
    if (s.type !== "CONFIRM" && s.type !== "NEAR") continue;

    // RSI 필터
    if (cfg.USE_RSI_FILTER && s.passRsi !== "Y") continue;

    // 점수: 확정 우선, 그 다음 dev 절대값 큰 순 (구글시트 동일)
    const scoreBase = s.type === "CONFIRM" ? 1000000 : 0;
    const score = scoreBase + Math.abs(Number(s.devPct) || 0) * 1000;

    const { seenAt } = getHoldMeta_(s.sym);

    candidates.push({ ...s, score, _seenAt: seenAt });
  }

  // ✅ 새 신호 우선(최근 seenAt 큰 것)
  // ✅ seenAt 같으면 기존 score 정렬 유지
  candidates.sort((a, b) => {
    const sa = Number(a._seenAt) || 0;
    const sb = Number(b._seenAt) || 0;
    if (sb !== sa) return sb - sa;
    return (Number(b.score) || 0) - (Number(a.score) || 0);
  });

  const top = candidates.slice(0, TOP_N);

  return top.map((s, idx) => ({
    rank: idx + 1,
    symbol: s.sym,
    direction: directionText_(s.prevTrend, s.curTrend),
    type: typeText_(s.type),
    bandPct: cfg.TREND_BAND_PCT,
    price: s.price,
    ma30: s.ma30,
    rsi14: s.rsi14,
    deviationPct: s.devPct,
    updated: new Date(s.updated).toLocaleString("ko-KR")
  }));
}

/**
 * === 전체 스캔 ===
 * - 계약 전체에서 _USDT만 사용(옵션)
 */
export async function runTop30Scan({
  interval = "Min15", // 형태 유지(현재는 Day1로 MA/RSI 계산)
  limit = 200,        // 형태 유지(현재는 Day1로 MA/RSI 계산)
  maxSymbols = Number(process.env.MAX_SYMBOLS || 80),
  concurrency = Number(process.env.CONCURRENCY || 2),
  cfg = {}
} = {}) {
  // cfg 기본값 세팅(계산방식 동일)
  const effectiveCfg = {
    TREND_BAND_PCT: Number.isFinite(cfg.TREND_BAND_PCT) ? cfg.TREND_BAND_PCT : 0.5,
    TURN_NEAR_PCT: Number.isFinite(cfg.TURN_NEAR_PCT) ? cfg.TURN_NEAR_PCT : 0.3,
    USE_RSI_FILTER: typeof cfg.USE_RSI_FILTER === "boolean" ? cfg.USE_RSI_FILTER : true,
    RSI_THRESHOLD: Number.isFinite(cfg.RSI_THRESHOLD) ? cfg.RSI_THRESHOLD : 50,
    ONLY_USDT: typeof cfg.ONLY_USDT === "boolean" ? cfg.ONLY_USDT : true
  };

  // interval/limit은 현재 Day1로 계산하기 때문에 유지용(계산방식 변경 없음)
  void interval;
  void limit;

  const contracts = await fetchAllContracts();

  const apiSymbols = (contracts ?? [])
    .map((c) => c?.symbol)
    .filter((s) => typeof s === "string")
    .filter((s) => (effectiveCfg.ONLY_USDT ? s.endsWith("_USDT") : true))
    .slice(0, maxSymbols);

  const limiter = pLimit(concurrency);

  const snaps = await Promise.all(
    apiSymbols.map((apiSymbol) =>
      limiter(async () => {
        const uiSymbol = apiToUiSymbol(apiSymbol);
        try {
          return await computeSnapForSymbol(uiSymbol, apiSymbol, effectiveCfg);
        } catch (e) {
          return { sym: uiSymbol, err: String(e?.message || e), updated: nowIso() };
        }
      })
    )
  );

  return buildTop30FromSnaps(snaps, effectiveCfg);
}
