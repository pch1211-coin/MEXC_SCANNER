import fetch from "node-fetch";

// MEXC 직접 호출 기본 베이스
const DIRECT_BASE = "https://contract.mexc.com";

/**
 * 1) Render Environment에 MEXC_PROXY_BASE가 있으면 그걸 사용
 * 2) 없으면 DIRECT_BASE 사용
 */
function baseUrl() {
  const p = process.env.MEXC_PROXY_BASE;
  return p && p.startsWith("http") ? p.replace(/\/+$/, "") : DIRECT_BASE;
}

/**
 * 프록시 여부 판단:
 * - base가 contract.mexc.com이면 direct
 * - 그 외(예: workers.dev, 기타 프록시)이면 proxy
 */
function isProxyBase(base) {
  return !base.includes("contract.mexc.com");
}

/**
 * URL 생성:
 * - direct:  https://contract.mexc.com + path
 * - proxy:   https://<proxyBase>/proxy + path
 *
 * 주의: path는 반드시 "/"로 시작해야 함
 */
function buildUrl(path, qs = {}) {
  const base = baseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;

  const full = isProxyBase(base) ? `${base}/proxy${p}` : `${base}${p}`;
  const u = new URL(full);

  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 재시도 fetch(JSON)
 * - 429 / 5xx 는 재시도
 * - 그 외 비정상은 즉시 에러
 */
async function fetchJsonWithRetry(url, { retries = 3, backoffMs = 800 } = {}) {
  let lastErr = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json"
        }
      });

      // 재시도 대상
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text}`.slice(0, 220));
      }

      // 그 외 에러(403 포함)는 즉시 실패 처리
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text}`.slice(0, 220));
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

// ✅ 시작 시 프록시 베이스 로그 (Render Logs에서 확인용)
console.log("[MEXC] BASE =", baseUrl(), "proxy=", isProxyBase(baseUrl()));

/**
 * 계약 목록
 * GET /api/v1/contract/detail
 */
export async function fetchAllContracts() {
  const url = buildUrl("/api/v1/contract/detail");
  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 700 });
  return json?.data ?? [];
}

/**
 * fair price
 * GET /api/v1/contract/ticker?symbol=BTC_USDT
 */
export async function fetchMexcFairPrice(apiSymbol) {
  const url = buildUrl("/api/v1/contract/ticker", { symbol: apiSymbol });
  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 700 });

  if (!json || json.success !== true || !json.data) {
    throw new Error("API fail: ticker");
  }

  const last = Number(json.data.lastPrice);
  const fair = Number(json.data.fairPrice ?? json.data.fair_price ?? last);

  if (!Number.isFinite(fair)) throw new Error("fairPrice invalid");
  return fair;
}

/**
 * 일봉 close 배열
 * GET /api/v1/contract/kline/{symbol}?interval=Day1&start=..&end=..
 */
export async function fetchDailyCloses(apiSymbol, needCount) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - 120 * 24 * 60 * 60;

  // 심볼이 path에 들어가므로 반드시 encode
  const path = `/api/v1/contract/kline/${encodeURIComponent(apiSymbol)}`;
  const url = buildUrl(path, {
    interval: "Day1",
    start: startSec,
    end: nowSec
  });

  const json = await fetchJsonWithRetry(url, { retries: 3, backoffMs: 900 });

  if (!json || json.success !== true || !json.data || !json.data.close) {
    throw new Error("kline fail");
  }

  const closes = json.data.close.map(Number).filter((v) => Number.isFinite(v));
  if (closes.length < needCount) throw new Error("not enough candles");
  return closes;
}
