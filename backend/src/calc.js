export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * RSI 14 (Wilder smoothing)
 * 입력: closes (오래된 -> 최신)
 */
export function rsiWilder(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  let gain = 0;
  let loss = 0;

  // 초기 평균
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  // 스무딩
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function pctChange(a, b) {
  // (a - b) / b * 100
  if (b === 0 || b === null || b === undefined) return null;
  return ((a - b) / b) * 100;
}

/**
 * 트렌드 밴드(기본 구현)
 * - ma 기준으로 ± TREND_BAND_PCT% 밴드
 * - price가 상단밴드에 얼마나 가까운지/하단밴드에 얼마나 가까운지 "근접도"를 %로 표현
 *   (원본과 다를 수 있음: 나중에 원본 수식으로 교체해야 함)
 */
export function bandScorePct(price, ma, bandPct) {
  if (price == null || ma == null) return null;
  const up = ma * (1 + bandPct / 100);
  const dn = ma * (1 - bandPct / 100);
  if (up === dn) return 0;

  // price가 밴드 범위를 벗어나면 100에 가깝게
  if (price >= up) return 100;
  if (price <= dn) return 100;

  // 밴드 안에서는 가장 가까운 경계까지 거리 기준
  const distToUp = Math.abs(up - price);
  const distToDn = Math.abs(price - dn);
  const minDist = Math.min(distToUp, distToDn);

  // 0(중앙) ~ 100(경계)
  const halfRange = (up - dn) / 2;
  const score = (1 - minDist / halfRange) * 100;
  return Math.max(0, Math.min(100, score));
}
