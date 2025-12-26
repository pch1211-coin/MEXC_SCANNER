// backend/src/mexcFutures.js
// Node18+ (Render) 기준

const DEFAULT_PROXY = "https://mexc-proxy.pch1211.workers.dev/proxy";
const MEXC_PROXY_BASE = (process.env.MEXC_PROXY_BASE || DEFAULT_PROXY).replace(/\/$/, "");

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      // 일부 환경에서 차단 줄이기용
      "user-agent": "Mozilla/5.0 (Render; mexc-scanner)",
    },
  });

  const text = await res.text().catch(() => "");

  // ✅ JSON이 아닌 HTML(429/403 페이지)도 그대로 로그에 남기고 에러 처리
  if (!res.ok) {
    console.error("[mexcFutures] HTTP FAIL", res.status, url, text.slice(0, 200));
    throw new Error(`HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[mexcFutures] JSON PARSE FAIL", url, text.slice(0, 200));
    throw new Error("Invalid JSON");
  }
}

/**
 * 전체 선물 계약 목록
 * GET {proxy}/api/v1/contract/detail
 */
export async function fetchAllContracts() {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/detail`;
  const j = await fetchJson(url);

  // 너가 캡처한 응답 구조: { success:true, code:0, data:[...] }
  if (j?.success !== true || !Array.isArray(j?.data)) {
    throw new Error("contract/detail bad response");
  }
  return j.data;
}

/**
 * fairPrice
 * GET {proxy}/api/v1/contract/fair_price/{symbol}
 */
export async function fetchMexcFairPrice(symbol) {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/fair_price/${encodeURIComponent(symbol)}`;
  const j = await fetchJson(url);

  const fair = Number(j?.data?.fairPrice ?? j?.data?.fair_price);
  if (!Number.isFinite(fair)) throw new Error(`fairPrice invalid: ${symbol}`);
  return fair;
}

/**
 * 일봉 종가 31개
 * GET {proxy}/api/v1/contract/kline/{symbol}?interval=1d&limit=31
 */
export async function fetchDailyCloses(symbol, limit = 31) {
  const url =
    `${MEXC_PROXY_BASE}/api/v1/contract/kline/${encodeURIComponent(symbol)}` +
    `?interval=1d&limit=${Number(limit)}`;

  const j = await fetchJson(url);

  // 너가 올린 구조 기준: data가 배열, 각 요소 close 존재
  const arr = Array.isArray(j?.data) ? j.data : [];
  const closes = arr.map((x) => Number(x?.close)).filter((v) => Number.isFinite(v));

  if (closes.length < 15) throw new Error(`not enough candles: ${symbol}`);
  return closes;
}
