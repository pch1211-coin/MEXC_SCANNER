import fetch from "node-fetch";

const BASE = "https://contract.mexc.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, { retries = 3, backoffMs = 800 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text}`.slice(0, 200));
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text}`.slice(0, 200));
      }

      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await sleep(backoffMs * (i + 1));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("fetchJson failed");
}

/** 전체 선물 계약 목록 */
export async function fetchAllContracts() {
  const url = `${BASE}/api/v1/contract/detail`;
  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 700 });
  return json?.data ?? [];
}

/** ticker에서 fairPrice 가져오기 (구글시트 fetchMexcTicker_ 동일) */
export async function fetchMexcFairPrice(apiSymbol) {
  const url = `${BASE}/api/v1/contract/ticker?symbol=${encodeURIComponent(apiSymbol)}`;
  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 700 });

  if (!json || json.success !== true || !json.data) {
    throw new Error("API fail: ticker");
  }

  const last = Number(json.data.lastPrice);
  const fair = Number(json.data.fairPrice ?? json.data.fair_price ?? last);
  if (!Number.isFinite(fair)) throw new Error("fairPrice invalid");
  return fair;
}

/** Day1 kline에서 close 배열 가져오기 (구글시트 fetchDailyCloses_ 동일) */
export async function fetchDailyCloses(apiSymbol, needCount) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - 120 * 24 * 60 * 60;

  const url =
    `${BASE}/api/v1/contract/kline/${encodeURIComponent(apiSymbol)}` +
    `?interval=Day1&start=${startSec}&end=${nowSec}`;

  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 900 });

  if (!json || json.success !== true || !json.data || !json.data.close) {
    throw new Error("kline fail");
  }

  const closes = json.data.close.map(Number).filter((v) => Number.isFinite(v));
  if (closes.length < needCount) throw new Error("not enough candles");
  return closes;
}
