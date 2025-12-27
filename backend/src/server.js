// backend/src/server.js
import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();

// ---- CORS (프론트에서 x-api-key 헤더 보내기 때문에 허용 필요)
app.use(
  cors({
    origin: true,
    credentials: false,
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

// ---- Health (인증 없이)
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---- Auth Middleware
function requireApiKey(req, res, next) {
  const key = String(req.headers["x-api-key"] || "").trim();

  const adminKey = String(process.env.API_KEY_ADMIN || "").trim();
  const viewKey = String(process.env.API_KEY_VIEW || "").trim();

  if (!key) {
    return res.status(401).json({ ok: false, error: "Missing x-api-key" });
  }

  if (adminKey && key === adminKey) {
    req.userRole = "admin";
    return next();
  }
  if (viewKey && key === viewKey) {
    req.userRole = "view";
    return next();
  }

  return res.status(401).json({ ok: false, error: "Invalid API key" });
}

// ---- Top30 (인증 필요)
app.get("/api/top30", requireApiKey, async (req, res) => {
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

    res.json({
      ok: true,
      role: req.userRole || "view",
      interval,
      limit,
      updated: new Date().toISOString(),
      data,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
