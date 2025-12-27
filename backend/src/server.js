import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();
app.use(cors());

// ✅ 비용절감 고정값 (원하면 환경변수로도 조절 가능)
const FIX_MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 50); // ✅ 50개만
const FIX_CONCURRENCY = Number(process.env.CONCURRENCY || 2);  // ✅ 동시요청 낮게 (Workers 부담↓)
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30000); // ✅ 30초 캐시

// ✅ 스캔 캐시 & 중복스캔 방지
let cache = {
  ts: 0,
  payload: null
};
let inflightPromise = null;

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/top30", async (req, res) => {
  try {
    // ✅ 30초 캐시: 아직 유효하면 그대로 반환
    const now = Date.now();
    if (cache.payload && now - cache.ts < CACHE_TTL_MS) {
      return res.json(cache.payload);
    }

    // ✅ 동시에 여러 요청이 와도 스캔은 1번만
    if (!inflightPromise) {
      inflightPromise = (async () => {
        const interval = String(req.query.interval || process.env.INTERVAL || "Min15");
        const limit = Number(req.query.limit || process.env.LIMIT || 200);

        const cfg = {
          TREND_BAND_PCT: Number(process.env.TREND_BAND_PCT || 0.3),
          RSI50_FILTER: String(process.env.RSI50_FILTER || "true"),
          ONLY_USDT: String(process.env.ONLY_USDT || "true"),
          SORT_BY: String(process.env.SORT_BY || "band"),
        };

        // ✅ 핵심: 심볼 수 50개 고정 / concurrency 낮춤
        const data = await runTop30Scan({
          interval,
          limit,
          maxSymbols: FIX_MAX_SYMBOLS,
          concurrency: FIX_CONCURRENCY,
          cfg
        });

        const payload = {
          ok: true,
          interval,
          limit,
          maxSymbols: FIX_MAX_SYMBOLS,
          concurrency: FIX_CONCURRENCY,
          cachedForMs: CACHE_TTL_MS,
          updated: new Date().toISOString(),
          data
        };

        cache = { ts: Date.now(), payload };
        return payload;
      })().finally(() => {
        inflightPromise = null;
      });
    }

    const payload = await inflightPromise;
    return res.json(payload);

  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
