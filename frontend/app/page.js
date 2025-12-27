"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   Sound helpers (추천 설정)
   ========================= */
function beep(freq = 880, ms = 140) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.06;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ms);
  } catch {}
}

// 🔔 NEAR: 짧게 1번
function beepNear() {
  beep(700, 140);
}

// 🔔🔔 CONFIRM: 짧게 2번
function beepConfirm() {
  beep(1200, 140);
  setTimeout(() => beep(1200, 140), 220);
}

/* =========================
   UI helpers
   ========================= */
const DEFAULT_REFRESH_MS = 5000;

function fmt(n, digits = 6) {
  if (n === null || n === undefined) return "";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toFixed(digits).replace(/\.?0+$/, "");
}
function absVal(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.abs(x) : 0;
}
function Th({ children }) {
  return (
    <th style={{
      textAlign: "left", padding: "10px",
      fontSize: 12, opacity: .85,
      borderBottom: "1px solid rgba(0,0,0,.08)",
      position: "sticky", top: 0,
      background: "rgba(0,0,0,.04)"
    }}>{children}</th>
  );
}
function Td({ children, style }) {
  return (
    <td style={{
      padding: "10px",
      borderBottom: "1px solid rgba(0,0,0,.06)",
      fontSize: 13, ...style
    }}>{children}</td>
  );
}

/* =========================
   Login (backend auth)
   ========================= */
function LoginGate({ onLogin }) {
  const [k, setK] = useState("");
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div style={{
        width: 360, maxWidth: "92vw",
        background: "#111", color: "#fff",
        borderRadius: 12, padding: 16
      }}>
        <h3 style={{ marginTop: 0 }}>MEXC Scanner 로그인</h3>
        <input
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="API Key 입력"
          style={{ width: "100%", padding: 10, borderRadius: 10, marginBottom: 10 }}
        />
        <button
          onClick={() => onLogin(k.trim())}
          disabled={!k.trim()}
          style={{ width: "100%", padding: 10, borderRadius: 10, fontWeight: 800 }}
        >
          로그인
        </button>
      </div>
    </div>
  );
}

/* =========================
   Page
   ========================= */
export default function Page() {
  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("");
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  const [filterType, setFilterType] = useState("ALL");
  const [sortKey, setSortKey] = useState("RANK");
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  // 🔔 알림 관련
  const audioUnlockedRef = useRef(false);
  const prevMapRef = useRef(new Map()); // symbol -> last type

  async function load() {
    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });
      const j = await r.json();

      if (!r.ok || !j.ok) {
        setMeta({ ok: false, updated: "", error: j.error || "error" });
        if (r.status === 401) setApiKey("");
        return;
      }

      // KST 표시
      const updatedKst = j.updated
        ? new Date(j.updated).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
        : "";

      setMeta({ ok: true, updated: updatedKst, error: "" });
      setRole(j.role || "");

      const nextRows = Array.isArray(j.data) ? j.data : [];

      // 🔔 새 신호 감지 (로직 변경 없음)
      if (audioUnlockedRef.current) {
        const prev = prevMapRef.current;
        let playNear = false;
        let playConfirm = false;

        for (const row of nextRows) {
          const sym = row.symbol;
          const type = row.type;
          const prevType = prev.get(sym);

          if (!prevType && type === "전환근접") playNear = true;
          if (!prevType && type === "전환확정") playConfirm = true;
          if (prevType === "전환근접" && type === "전환확정") playConfirm = true;
        }

        const nm = new Map();
        nextRows.forEach(r => nm.set(r.symbol, r.type));
        prevMapRef.current = nm;

        if (playConfirm) beepConfirm();
        else if (playNear) beepNear();
      }

      setRows(nextRows);
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [apiKey, refreshMs]);

  const filtered = useMemo(() => {
    let out = [...rows];
    if (filterType === "CONFIRM") out = out.filter(r => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter(r => r.type === "전환근접");

    if (sortKey === "ABS_DEV") out.sort((a,b)=>absVal(b.deviationPct)-absVal(a.deviationPct));
    else if (sortKey === "UPDATED") out.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
    else out.sort((a,b)=>Number(a.rank)-Number(b.rank));
    return out;
  }, [rows, filterType, sortKey]);

  if (!apiKey) {
    return <LoginGate onLogin={setApiKey} />;
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>MEXC Futures DASH</h2>

      <button
        onClick={() => { audioUnlockedRef.current = true; }}
        style={{ padding: "6px 10px", borderRadius: 10, marginBottom: 10 }}
      >
        🔊 알림 소리 켜기
      </button>

      <div>updated: <b>{meta.updated || "-"}</b></div>

      <table style={{ width: "100%", marginTop: 12 }}>
        <thead>
          <tr>
            <Th>Rank</Th><Th>Symbol</Th><Th>Type</Th>
            <Th>Price</Th><Th>MA30</Th><Th>RSI14</Th><Th>Dev%</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(r => (
            <tr key={r.symbol} style={{
              background:
                r.type === "전환확정" ? "rgba(255,77,77,.25)" :
                r.type === "전환근접" ? "rgba(255,242,204,.9)" : "transparent"
            }}>
              <Td>{r.rank}</Td>
              <Td><b>{r.symbol}</b></Td>
              <Td>{r.type}</Td>
              <Td>{fmt(r.price,8)}</Td>
              <Td>{fmt(r.ma30,8)}</Td>
              <Td>{fmt(r.rsi14,2)}</Td>
              <Td>{fmt(r.deviationPct,4)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
