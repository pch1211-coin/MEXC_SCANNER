// backend/src/server.js
import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();
app.use(cors());

function requireApiKey(req, res, next) {
  const key = String(req.headers["x-api-key"] || "").trim();
  const view = String(process.env.API_KEY_VIEW || "").trim();
  const admin = String(process.env.API_KEY_ADMIN || "").trim();

  // 키 미설정이면(오픈) 통과시키고 싶으면 아래 2줄 주석 해제
  // if (!view && !admin) return next();

  if (!key) return res.status(401).json({ ok: false, error: "Missing x-api-key" });
  if (key !== view && key !== admin) return res.status(403).json({ ok: false, error: "Invalid x-api-key" });

  req.authRole = (key === admin) ? "admin" : "view";
  next();
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/top30", requireApiKey, async (req, res) => {
  try {
    const interval = String(req.query.interval || process.env.INTERVAL || "Min15"); // 현재 표시용
    const limit = Number(req.query.limit || process.env.LIMIT || 200);             // 현재 표시용
    const maxSymbols = Number(req.query.maxSymbols || process.env.MAX_SYMBOLS || 80);
    const concurrency = Number(req.query.concurrency || process.env.CONCURRENCY || 1);

    const data = await runTop30Scan({ maxSymbols, concurrency });
    res.json({
      ok: true,
      role: req.authRole || "view",
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
