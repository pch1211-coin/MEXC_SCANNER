"use client";

import { useEffect, useMemo, useState } from "react";

/** =========================
 *  Login (LocalStorage)
 *  ========================= */
const LS_KEY = "MEXC_SCANNER_API_KEY";
const LS_ROLE = "MEXC_SCANNER_ROLE"; // "admin" | "view"

function useAuthKey() {
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("view");

  useEffect(() => {
    const k = localStorage.getItem(LS_KEY) || "";
    const r = localStorage.getItem(LS_ROLE) || "view";
    setApiKey(k);
    setRole(r);
  }, []);

  const save = (k, r) => {
    localStorage.setItem(LS_KEY, k);
    localStorage.setItem(LS_ROLE, r);
    setApiKey(k);
    setRole(r);
  };

  const logout = () => {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_ROLE);
    setApiKey("");
    setRole("view");
  };

  return { apiKey, role, save, logout };
}

function LoginGate({ onSave }) {
  const [k, setK] = useState("");
  const [r, setR] = useState("view");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999
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
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
          MEXC Scanner 로그인
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          관리자/읽기전용 중 선택 후 비밀번호(API Key)를 입력하세요.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <select
            value={r}
            onChange={(e) => setR(e.target.value)}
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
          >
            <option value="view">읽기 전용</option>
            <option value="admin">관리자</option>
          </select>
        </div>

        <input
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="비밀번호(API Key) 입력"
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            marginBottom: 10
          }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onSave(k.trim(), r)}
            disabled={!k.trim()}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 10,
              fontWeight: 700,
              cursor: k.trim() ? "pointer" : "not-allowed"
            }}
          >
            로그인
          </button>
        </div>
      </div>
    </div>
  );
}

/** =========================
 *  UI Helpers (기존 유지)
 *  ========================= */
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
        background: "rgba(0,0,0,0.04)"
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
        ...style
      }}
    >
      {children}
    </td>
  );
}

/** =========================
 *  Page
 *  ========================= */
export default function Page() {
  /**
   * ✅ 중요: Hook들은 "조건문 return"보다 항상 위에 있어야 함
   * (이게 관리자 로그인 후 크래시의 원인이었음)
   */
  const { apiKey, role, save, logout } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("RANK"); // RANK | ABS_DEV | UPDATED
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  // ✅ 로그인 안되어 있으면 여기서만 "return" (Hook 뒤!)
  if (!apiKey) {
    return <LoginGate onSave={save} />;
  }

  async function load() {
    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });

      // ✅ 응답이 JSON이 아닐 때도 에러를 화면에 표시하게 방어
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
      }

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
  }, [refreshMs, apiKey, BACKEND]);

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

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>MEXC Futures DASH</h2>
        <span style={{ fontSize: 12, opacity: 0.75 }}>backend: {BACKEND}</span>

        <span style={{ fontSize: 12, opacity: 0.75 }}>role: {role}</span>

        <button
          onClick={logout}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          로그아웃
        </button>
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
            <div style={{ marginTop: 6, color: "crimson" }}>error: {meta.error}</div>
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
      <div
        style={{
          marginTop: 14,
          overflowX: "auto",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 14
        }}
      >
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 920 }}>
          <thead>
            <tr>
              <Th>Rank</Th>
              <Th>Symbol</Th>
              <Th>Direction</Th>
              <Th>Type</Th>
              <Th>Band(%)</Th>
              <Th>Price</Th>
              <Th>MA30</Th>
              <Th>RSI14</Th>
              <Th>Dev(%)</Th>
              <Th>Updated</Th>
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
