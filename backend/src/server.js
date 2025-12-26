import pLimit from "p-limit";
import { fetchAllContracts, fetchKlines } from "./mexcFutures.js";
import { apiToUiSymbol } from "./symbol.js";
import { sma, rsiWilder, pctChange, bandScorePct } from "./calc.js";

const stateStore = new Map(); // symbol -> { lastSide: "UP"|"DOWN" }

function nowIso() {
  return new Date().toISOString();
}

/**
 * 기본 계산(동작용)
 * - Fair Price: 최신 close
 * - MA30: SMA(30) of close
 * - RSI14: Wilder RSI
 * - Deviation: (Price - MA30) / MA30 * 100
 * - Direction/Type: deviation 부호가 바뀌면 "전환확정"으로 표시(기본)
 *   (원본 전환 로직과 다를 수 있음 → 원본 코드 주면 그대로 교체)
 */
function computeRowFromCandles({ uiSymbol, candles, prevState, cfg }) {
  const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
  if (closes.length < 40) return null;

  const price = closes[closes.length - 1]; // Fair Price 기본
  const ma30 = sma(closes, 30);
  const rsi14 = rsiWilder(closes, 14);
  const deviationPct = pctChange(price, ma30);

  const bandPctCfg = Number(cfg.TREND_BAND_PCT ?? 0.3); // "0.3" => 밴드 %폭
  const bandPct = bandScorePct(price, ma30, bandPctCfg);

  // side: deviation 기준 UP/DOWN
  const side = deviationPct >= 0 ? "UP" : "DOWN";
  const lastSide = prevState?.lastSide ?? null;

  let direction = "";
  let type = "";

  // 기본 전환 표시(확정): UP<->DOWN 바뀌면
  if (lastSide && lastSide !== side) {
    direction = lastSide === "UP" ? "UP->DOWN" : "DOWN->UP";
    type = "전환확정";
  } else {
    // 근접(기본): deviation이 0에 가까우면
    if (Math.abs(deviationPct ?? 999) < 0.15) {
      type = "전환근접";
      direction = side === "UP" ? "DOWN->UP" : "UP->DOWN";
    }
  }

  // RSI 50 필터(기본 ON): 조건이 안 맞으면 신호 제거
  if (String(cfg.RSI50_FILTER) === "true" && rsi14 != null) {
    // UP 신호는 RSI>=50, DOWN 신호는 RSI<=50 쪽만 남기는 기본 필터
    if (type) {
      if (direction === "DOWN->UP" && rsi14 < 50) {
        direction = "";
        type = "";
      }
      if (direction === "UP->DOWN" && rsi14 > 50) {
        direction = "";
        type = "";
      }
    }
  }

  const newState = { lastSide: side };

  return {
    symbol: uiSymbol,
    direction,
    type,
    bandPct: Number.isFinite(bandPct) ? bandPct : 0,
    price: Number(price.toFixed(8)),
    ma30: ma30 == null ? 0 : Number(ma30.toFixed(8)),
    rsi14: rsi14 == null ? 0 : Number(rsi14.toFixed(4)),
    deviationPct: deviationPct == null ? 0 : Number(deviationPct.toFixed(6)),
    updated: nowIso(),
    newState,
  };
}

export async function runTop30Scan({
  interval = "Min15",
  limit = 200,
  maxSymbols = 250,
  concurrency = 6,
  cfg = {
    TREND_BAND_PCT: 0.3,
    RSI50_FILTER: true,
    ONLY_USDT: true,
    SORT_BY: "band",
  },
}) {
  const contracts = await fetchAllContracts();

  let list = contracts
    .filter((c) => typeof c?.symbol === "string")
    .map((c) => c.symbol);

  if (String(cfg.ONLY_USDT) === "true") {
    list = list.filter((s) => s.endsWith("_USDT"));
  }

  list = list.slice(0, maxSymbols);

  const limiter = pLimit(concurrency);

  const rows = await Promise.all(
    list.map((apiSymbol) =>
      limiter(async () => {
        const uiSymbol = apiToUiSymbol(apiSymbol);
        const candles = await fetchKlines({ apiSymbol, interval, limit });

        if (!candles || candles.length < 40) return null;

        const prevState = stateStore.get(uiSymbol) ?? null;

        const row = computeRowFromCandles({ uiSymbol, candles, prevState, cfg });
        if (!row) return null;

        stateStore.set(uiSymbol, row.newState ?? prevState ?? {});
        return row;
      })
    )
  );

  const valid = rows.filter(Boolean);

  // 정렬(기본 band 높은 순 or absDev 큰 순)
  const sortBy = String(cfg.SORT_BY || "band");
  if (sortBy === "absDev") {
    valid.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
  } else {
    valid.sort((a, b) => (b.bandPct ?? 0) - (a.bandPct ?? 0));
  }

  return valid.slice(0, 30).map((r, i) => ({ rank: i + 1, ...r }));
}
