// backend/src/mexcFutures.js

const MEXC_PROXY_BASE =
  process.env.MEXC_PROXY_BASE || "https://mexc-proxy.pch1211.workers.dev/proxy";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 전체 선물 계약 목록 (contract/detail)
 * Worker 예시: /proxy/api/v1/contract/detail
 */
export async function fetchAllContracts() {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/detail`;
  const j = await fetchJson(url);
  return j?.data || [];
}

/**
 * 현재 fairPrice (contract/fair_price/{symbol})
 * Worker 예시: /proxy/api/v1/contract/fair_price/BTC_USDT
 */
export async function fetchMexcFairPrice(symbol) {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/fair_price/${encodeURIComponent(symbol)}`;
  const j = await fetchJson(url);

  const fair = Number(j?.data?.fairPrice ?? j?.data?.fair_price);
  if (!Number.isFinite(fair)) {
    throw new Error(`fairPrice invalid for ${symbol}`);
  }
  return fair;
}

/**
 * 일봉 종가 (contract/kline/{symbol})
 * 너 Worker에서 찍어본 구조가 이 형태였지:
 * /proxy/api/v1/contract/kline/BTC_USDT?interval=1d&limit=31
 *
 * 응답은 보통 data가 배열이고 각 요소에 close가 있음
 */
export async function fetchDailyCloses(symbol, limit = 31) {
  const url =
    `${MEXC_PROXY_BASE}/api/v1/contract/kline/${encodeURIComponent(symbol)}` +
    `?interval=1d&limit=${Number(limit)}`;

  const j = await fetchJson(url);

  const arr = Array.isArray(j?.data) ? j.data : [];
  const closes = arr.map((k) => Number(k?.close)).filter((v) => Number.isFinite(v));

  if (closes.length < Math.min(15, Number(limit))) {
    throw new Error(`not enough candles for ${symbol}: ${closes.length}`);
  }
  return closes;
}
