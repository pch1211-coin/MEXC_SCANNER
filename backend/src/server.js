import express from "express";
import cors from "cors";
import { runTop30Scan } from "./scanner.js";

const app = express();
app.use(cors());

// ✅ 관리자/읽기전용 키 (Render Env에서 설정)
const API_KEY_ADMIN = process.env.API_KEY_ADMIN || "";
const API_KEY_VIEW = process.env.API_KEY_VIEW || "";

// ✅ 인증 미들웨어: x-api-key로 확인
function auth(req, res, next) {
  // 키를 아예 설정 안 했으면(둘 다 비어있으면) 인증 OFF
  if (!API_KEY_ADMIN && !API_KEY_VIEW) return next();

  const key = String(req.headers["x-api-key"] || "").trim();
  if (!key) return res.status(401).json({ ok: false, error: "Unauthorized: missing x-api-key" });

  if (key === API_KEY_ADMIN) {
    req.userRole = "admin";
    return next();
  }
  if (key === API_KEY_VIEW) {
    req.userRole = "view";
    return next();
  }

  return res.status(401).json({ ok: false, error: "Unauthorized: invalid key" });
}

// ✅ 관리자 전용 미들웨어(3번 요구사항)
function requireAdmin(req, res, next) {
  if (req.userRole === "admin") return next();
  return res.status(403).json({ ok: false, error: "Forbidden: admin only" });
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ✅ TOP30은 인증 필요 (admin/view 모두 접근 가능)
app.get("/api/top30", auth, async (req, res) => {
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
      role: req.userRole || "unknown",
      interval,
      limit,
      updated: new Date().toISOString(),
      data
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * ✅ (3번) 관리자 전용 예시 엔드포인트
 * - 지금은 “권한 확인용”으로만 둠(기존 로직 건드리지 않음)
 * - 나중에 필요하면 admin-only 기능을 여기에 추가하면 됨
 */
app.get("/api/admin/ping", auth, requireAdmin, (req, res) => {
  res.json({ ok: true, role: "admin", msg: "admin access ok" });
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => console.log("server on :", port));
