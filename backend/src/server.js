import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();

// (원래대로 두고 싶으면 너 기존 CORS 설정 그대로 유지해도 됨)
app.use(cors());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/top30", async (req, res) => {
  try {
    const interval = String(req.query.interval || process.env.INTERVAL || "Min15");
    const limit = Number(req.query.limit || process.env.LIMIT || 200);

    const maxSymbols = Number(req.query.maxSymbols || process.env.MAX_SYMBOLS || 250);
    const concurrency = Number(req.query.concurrency || process.env.CONCURRENCY || 6);

    // ✅ 추가: top=30/50/100 (기본 30)
    const topN = Number(req.query.top || process.env.TOP_N || 30);

    const cfg = {
      TREND_BAND_PCT: Number(process.env.TREND_BAND_PCT || 0.3),
      RSI50_FILTER: String(process.env.RSI50_FILTER || "true"),
      ONLY_USDT: String(process.env.ONLY_USDT || "true"),
      SORT_BY: String(process.env.SORT_BY || "band"),
    };

    const data = await runTop30Scan({ interval, limit, maxSymbols, concurrency, cfg, topN });

    res.json({
      ok: true,
      interval,
      limit,
      top: topN,
      maxSymbols,
      updated: new Date().toISOString(),
      data
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
