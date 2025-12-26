"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_REFRESH_MS = 5000;

function fmt(n, digits = 6) {
  if (n === null || n === undefined) return "";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  // 너무 긴 소수는 보기 좋게
  return x.toFixed(digits).replace(/\.?0+$/, "");
}

function abs(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.abs(x) : 0;
}

export default function Page() {
  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  // UI 상태
  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("RANK"); // RANK | ABS_DEV | UPDATED
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const r = await fetch(`${BACKEND}/api/top30`, { cache: "no-store" });
      const j = await r.json();
      setMeta({ ok: !!j.ok, updated: j.updated || "", error: j.error || "" });
      setRows(Array.isArray(j.data) ? j.data : []);
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs]);

  const filtered = useMemo(() => {
    let out = [...rows];
    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    if (sortKey === "ABS_DEV") {
      out.sort((a, b) => abs(b.deviationPct) - abs(a.deviationPct));
    } else if (sortKey === "UPDATED") {
      out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    } else {
      out.sort((a, b) => Number(a.rank) - Number(b.rank));
    }

    return out;
  }, [rows, filterType, sortKey]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>MEXC Futures DASH</h2>
        <span style={{ fontSize: 12, opacity: 0.75 }}>
          backend: {BACKEND}
        </span>
      </div>

      <div style={{ marginTop: 8, fontSize: 13 }}>
        상태:{" "}
        <b style={{ color: meta.ok ? "green" : "crimson" }}>
          {meta.ok ? "OK" : "ERROR"}
        </b>
        {loading ? <span style={{ marginLeft: 8, opacity: 0.7 }}>(loading...)</span> : null}
        <div style={{ marginTop: 4, opacity: 0.8 }}>
          updated: <b>{meta.updated || "-"}</b>
          {meta.error ? (
            <div style={{ marginTop: 6, color: "crimson" }}>
              error: {meta.error}
            </div>
          ) : null}
        </div>
      </div>

      {/* 컨트롤 */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          alignItems: "end"
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>필터</div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}
          >
            <option value="ALL">전체</option>
            <option value="CONFIRM">전환확정만</option>
            <option value="NEAR">전환근접만</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>정렬</div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}
          >
            <option value="RANK">Rank 순</option>
            <option value="ABS_DEV">Deviation(절대값) 큰 순</option>
            <option value="UPDATED">최신 갱신 순</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>새로고침(초)</div>
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}
          >
            <option value={3000}>3초</option>
            <option value={5000}>5초</option>
            <option value={10000}>10초</option>
            <option value={30000}>30초</option>
          </select>
        </div>

        <button
          onClick={load}
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          지금 갱신
        </button>
      </div>

      {/* 테이블 */}
      <div style={{ marginTop: 14, overflowX: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 14 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 920 }}>
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.04)" }}>
              <Th>Rank</Th>
              <Th>Symbol</Th>
              <Th>Direction</Th>
              <Th>Type</Th>
              <Th>Band(%)</Th>
              <Th>Price</Th>
              <Th>MA30</Th>
              <Th>RSI14</Th>
              <Th>Dev(%)</
