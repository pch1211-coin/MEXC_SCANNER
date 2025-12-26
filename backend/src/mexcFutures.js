// backend/src/mexcFutures.js

const MEXC_PROXY_BASE =
  process.env.MEXC_PROXY_BASE || "https://mexc-proxy.pch1211.workers.dev/proxy";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, { retries = 3, backoffMs = 800 } = {}) {
  let lastText = "";

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    // 정상
    if (res.ok) {
      return res.json();
    }

    // 에러 본문(HTML 차단 페이지 등)도 같이 수집
    lastText = await res.text().catch(() => "");

    // 429 / 5xx 는 재시도
    if (res.status === 429 || res.status >= 500) {
      if (i === retries) break;
      await sleep(backoffMs * Math.pow(2, i)); // 800ms, 1600ms, 3200ms...
      continue;
    }

    // 그 외는 즉시 실패
    throw new Error(`HTTP ${res.status} ${lastText.slice(0, 200)}`);
  }

  throw new Error(`HTTP 429/5xx ${lastText.slice(0, 200)}`);
}

/**
 * 전체 선물 계약 목록
 */
export async function fetchAllContracts() {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/detail`;
  const j = await fetchJsonWithRetry(url);
  return j?.data || [];
}

/**
 * 현재 fairPrice
 */
export async function fetchMexcFairPrice(symbol) {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/fair_price/${encodeURIComponent(symbol)}`;
  const j = await fetchJsonWithRetry(url);

  const fair = Number(j?.data?.fairPrice ?? j?.data?.fair_price);
  if (!Number.isFinite(fair)) {
    throw new Error(`fairPrice invalid for ${symbol}`);
  }
  return fair;
}

/**
 * 일봉 종가 (중요: interval=Day1)
 */
export async function fetchDailyCloses(symbol, limit = 31) {
  const url =
    `${MEXC_PROXY_BASE}/api/v1/contract/kline/${encodeURIComponent(symbol)}` +
    `?interval=Day1&limit=${Number(limit)}`;

  const j = await fetchJsonWithRetry(url);

  // (A) data가 배열인 형태: [{close:...}, ...]
  if (Array.isArray(j?.data)) {
    const closes = j.data
      .map((k) => Number(k?.close))
      .filter((v) => Number.isFinite(v));
    if (closes.length < Math.min(15, Number(limit))) {
      throw new Error(`not enough candles for ${symbol}: ${closes.length}`);
    }
    return closes;
  }

  // (B) data.close가 배열인 형태: { close:[...] }
  if (j?.data?.close && Array.isArray(j.data.close)) {
    const closes = j.data.close.map(Number).filter((v) => Number.isFinite(v));
    if (closes.length < Math.min(15, Number(limit))) {
      throw new Error(`not enough candles for ${symbol}: ${closes.length}`);
    }
    return closes;
  }

  throw new Error(`kline parse fail for ${symbol}`);
}
