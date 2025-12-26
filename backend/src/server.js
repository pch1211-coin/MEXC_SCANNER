import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();
app.use(cors()); // ✅ 브라우저 호출 허용(프론트에서 fetch 에러 방지)

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/top30", async (req, res) => {
  try {
    // ✅ 쿼리 > ENV > 기본값 순
    const interval = String(req.query.interval || process.env.INTERVAL || "Min15");
    const limit = Number(req.query.limit || process.env.LIMIT || 200);

    const maxSymbols = Number(req.query.maxSymbols || process.env.MAX_SYMBOLS || 250);
    const concurrency = Number(req.query.concurrency || process.env.CONCURRENCY || 6);

    // ✅ 구글시트 상수들을 ENV로도 조절 가능하게 (계산방식은 동일)
    const cfg = {
      TREND_BAND_PCT: Number(req.query.bandPct || process.env.TREND_BAND_PCT || 0.5),
      TURN_NEAR_PCT: Number(req.query.nearPct || process.env.TURN_NEAR_PCT || 0.3),
      USE_RSI_FILTER: String(req.query.rsiFilter || process.env.RSI50_FILTER || "true") === "true",
      RSI_THRESHOLD: Number(req.query.rsiTh || process.env.RSI_THRESHOLD || 50),
      ONLY_USDT: String(req.query.onlyUsdt || process.env.ONLY_USDT || "true") === "true"
    };

    const data = await runTop30Scan({ interval, limit, maxSymbols, concurrency, cfg });

    res.json({
      ok: true,
      interval,
      limit,
      updated: new Date().toISOString(),
      data
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
