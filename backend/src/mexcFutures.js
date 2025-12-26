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

      // 간단 레이트리밋/서버에러 대응
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

/**
 * 선물 계약(심볼) 목록
 */
export async function fetchAllContracts() {
  const url = `${BASE}/api/v1/contract/detail`;
  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 700 });
  return json?.data ?? [];
}

/**
 * 선물 캔들
 * GET /api/v1/contract/kline/{symbol}?interval=Min15&limit=200
 */
export async function fetchKlines({ apiSymbol, interval, limit }) {
  const u = new URL(`${BASE}/api/v1/contract/kline/${apiSymbol}`);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));

  const json = await fetchJsonWithRetry(u.toString(), { retries: 3, backoffMs: 900 });
  const data = json?.data;

  // Case A: data = [[t,o,h,l,c,v], ...]
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data.map((arr) => ({
      time: Number(arr[0]),
      open: Number(arr[1]),
      high: Number(arr[2]),
      low: Number(arr[3]),
      close: Number(arr[4]),
      vol: Number(arr[5] ?? 0),
    }));
  }

  // Case B: data = { time:[], open:[], ... }
  if (data && Array.isArray(data.time)) {
    const n = data.time.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        time: Number(data.time[i]),
        open: Number(data.open?.[i]),
        high: Number(data.high?.[i]),
        low: Number(data.low?.[i]),
        close: Number(data.close?.[i]),
        vol: Number(data.vol?.[i] ?? data.volume?.[i] ?? 0),
      });
    }
    return out;
  }

  return [];
}
