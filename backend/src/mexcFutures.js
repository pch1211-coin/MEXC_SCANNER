// backend/src/mexcFutures.js

const MEXC_PROXY_BASE =
  process.env.MEXC_PROXY_BASE || "https://mexc-proxy.pch1211.workers.dev/proxy";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, { retries = 3, backoffMs = 800 } = {}) {
  let lastText = "";

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });

    if (res.ok) return res.json();

    lastText = await res.text().catch(() => "");

    if (res.status === 429 || res.status >= 500) {
      if (i === retries) break;
      await sleep(backoffMs * Math.pow(2, i));
      continue;
    }

    throw new Error(`HTTP ${res.status} ${lastText.slice(0, 200)}`);
  }

  throw new Error(`HTTP 429/5xx ${lastText.slice(0, 200)}`);
}

export async function fetchAllContracts() {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/detail`;
  const j = await fetchJsonWithRetry(url);
  return j?.data || [];
}

export async function fetchMexcFairPrice(symbol) {
  const url = `${MEXC_PROXY_BASE}/api/v1/contract/fair_price/${encodeURIComponent(symbol)}`;
  const j = await fetchJsonWithRetry(url);

  const fair = Number(j?.data?.fairPrice ?? j?.data?.fair_price);
  if (!Number.isFinite(fair)) throw new Error(`fairPrice invalid for ${symbol}`);
  return fair;
}

export async function fetchDailyCloses(symbol, limit = 31) {
  const url =
    `${MEXC_PROXY_BASE}/api/v1/contract/kline/${encodeURIComponent(symbol)}` +
    `?interval=Day1&limit=${Number(limit)}`;

  const j = await fetchJsonWithRetry(url);

  // 형태 A: data 배열
  if (Array.isArray(j?.data)) {
    const closes = j.data.map((k) => Number(k?.close)).filter((v) => Number.isFinite(v));
    if (closes.length < Math.min(15, Number(limit))) throw new Error(`not enough candles for ${symbol}: ${closes.length}`);
    return closes;
  }

  // 형태 B: data.close 배열
  if (j?.data?.close && Array.isArray(j.data.close)) {
    const closes = j.data.close.map(Number).filter((v) => Number.isFinite(v));
    if (closes.length < Math.min(15, Number(limit))) throw new Error(`not enough candles for ${symbol}: ${closes.length}`);
    return closes;
  }

  throw new Error(`kline parse fail for ${symbol}`);
}
