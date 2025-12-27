import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();

// ✅ CORS: 프론트 도메인 + x-api-key 허용
app.use(
  cors({
    origin: "https://mexc-scanner-frontend.onrender.com",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

// ✅ preflight(OPTIONS)도 확실히 처리
app.options("*", cors());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/top30", async (req, res) => {
  try {
    const interval = String(req.query.interval || process.env.INTERVAL || "Min15");
    const limit = Number(req.query.limit || process.env.LIMIT || 200);
    const maxSymbols = Number(process.env.MAX_SYMBOLS || 250);
    const concurrency = Number(process.env.CONCURRENCY || 6);

    const cfg = {
      TREND_BAND_PCT: Number(process.env.TREND_BAND_PCT || 0.3),
      RSI50_FILTER: String(process.env.RSI50_FILTER || "true"),
      ONLY_USDT: String(process.env.ONLY_USDT || "true"),
      SORT_BY: String(process.env.SORT_BY || "band"),
    };

    const data = await runTop30Scan({ interval, limit, maxSymbols, concurrency, cfg });
    res.json({ ok: true, interval, limit, updated: new Date().toISOString(), data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
