"use client";

import { useEffect, useMemo, useState } from "react";

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
    <th
      style={{
        textAlign: "left",
        padding: "10px 10px",
        fontSize: 12,
        opacity: 0.85,
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        position: "sticky",
        top: 0,
        background: "rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }) {
  return (
    <td
      style={{
        padding: "10px 10px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        fontSize: 13,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function LoginGate({ onLogin }) {
  const [k, setK] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: "92vw",
          background: "#111",
          color: "#fff",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
          MEXC Scanner 로그인
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          백엔드에 설정한 API Key를 입력하세요.
        </div>

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

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          * 이 버전은 브라우저 저장소(localStorage)를 쓰지 않습니다.
          <br />
          * 새로고침하면 다시 로그인해야 합니다.
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL || "https://mexc-scanner-backend.onrender.com";

  const [apiKey, setApiKey] = useState("");         // ✅ 저장 안함(메모리)
  const [role, setRole] = useState("");             // 백엔드가 알려줌

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("RANK");      // RANK | ABS_DEV | UPDATED
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey },
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j.ok) {
        const msg = j?.error || `HTTP ${r.status}`;
        setMeta({ ok: false, updated: "", error: msg });
        setRows([]);
        // 인증 실패면 로그인 화면으로
        if (r.status === 401) {
          setApiKey("");
          setRole("");
        }
        return;
      }

      setRole(String(j.role || ""));
      setMeta({ ok: true, updated: j.updated || "", error: "" });
      setRows(Array.isArray(j.data) ? j.data : []);
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, refreshMs]);

  const filtered = useMemo(() => {
    let out = [...rows];

    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    if (sortKey === "ABS_DEV") {
      out.sort((a, b) => absVal(b.deviationPct) - absVal(a.deviationPct));
    } else if (sortKey === "UPDATED") {
      out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    } else {
      out.sort((a, b) => Number(a.rank) - Number(b.rank));
    }

    return out;
  }, [rows, filterType, sortKey]);

  if (!apiKey) {
    return <LoginGate onLogin={(k) => setApiKey(k)} />;
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>MEXC Futures DASH</h2>
        <span style={{ fontSize: 12, opacity: 0.75 }}>backend: {BACKEND}</span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>role: {role || "-"}</span>
        <button
          onClick={() => { setApiKey(""); setRole(""); }}
          style={{
            marginLeft: 6,
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          로그아웃
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: 13 }}>
        상태:{" "}
        <b style={{ color: meta.ok ? "green" : "crimson" }}>{meta.ok ? "OK" : "ERROR"}</b>
        {loading ? <span style={{ marginLeft: 8, opacity: 0.7 }}>(loading...)</span> : null}
        <div style={{ marginTop: 4, opacity: 0.8 }}>
          updated: <b>{meta.updated || "-"}</b>
          {meta.error ? <div style={{ marginTop: 6, color: "crimson" }}>error: {meta.error}</div> : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          alignItems: "end",
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>필터</div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}>
            <option value="ALL">전체</option>
            <option value="CONFIRM">전환확정만</option>
            <option value="NEAR">전환근접만</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>정렬</div>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}>
            <option value="RANK">Rank 순</option>
            <option value="ABS_DEV">Deviation(절대값) 큰 순</option>
            <option value="UPDATED">최신 갱신 순</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>새로고침(초)</div>
          <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}>
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
            fontWeight: 700,
          }}
        >
          지금 갱신
        </button>
      </div>

      <div style={{ marginTop: 14, overflowX: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 14 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 920 }}>
          <thead>
            <tr>
              <Th>Rank</Th><Th>Symbol</Th><Th>Direction</Th><Th>Type</Th><Th>Band(%)</Th>
              <Th>Price</Th><Th>MA30</Th><Th>RSI14</Th><Th>Dev(%)</Th><Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 14, opacity: 0.7 }}>
                  조건에 맞는 항목이 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const type = r.type || "";
                const isConfirm = type === "전환확정";
                const isNear = type === "전환근접";

                const bg = isConfirm
                  ? "rgba(255,77,77,0.25)"
                  : isNear
                  ? "rgba(255,242,204,0.9)"
                  : "transparent";

                return (
                  <tr key={r.symbol} style={{ background: bg }}>
                    <Td>{r.rank}</Td>
                    <Td style={{ fontWeight: 800 }}>{r.symbol}</Td>
                    <Td>{r.direction}</Td>
                    <Td style={{ fontWeight: 800 }}>
                      {type}
                      {isConfirm ? " 🔴" : isNear ? " 🟡" : ""}
                    </Td>
                    <Td>{fmt(r.bandPct, 3)}</Td>
                    <Td>{fmt(r.price, 8)}</Td>
                    <Td>{fmt(r.ma30, 8)}</Td>
                    <Td>{fmt(r.rsi14, 2)}</Td>
                    <Td style={{ fontWeight: 700 }}>{fmt(r.deviationPct, 4)}</Td>
                    <Td>{r.updated}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
        * 전환확정=빨강, 전환근접=노랑
        <br />
        * 이 대시보드는 백엔드 <code>/api/top30</code> 결과를 그대로 표시합니다.
      </div>
    </div>
  );
}
