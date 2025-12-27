"use client";

import { useEffect, useMemo, useState } from "react";

/* =====================
   Auth (LocalStorage)
===================== */
const LS_KEY = "MEXC_SCANNER_API_KEY";
const LS_ROLE = "MEXC_SCANNER_ROLE";

function useAuthKey() {
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("view");

  useEffect(() => {
    setApiKey(localStorage.getItem(LS_KEY) || "");
    setRole(localStorage.getItem(LS_ROLE) || "view");
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
  const [key, setKey] = useState("");
  const [role, setRole] = useState("view");

  return (
    <div style={{ padding: 40 }}>
      <h2>MEXC Scanner 로그인</h2>

      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="view">읽기 전용</option>
        <option value="admin">관리자</option>
      </select>

      <br /><br />

      <input
        placeholder="API KEY 입력"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />

      <br /><br />

      <button onClick={() => onSave(key.trim(), role)} disabled={!key.trim()}>
        로그인
      </button>
    </div>
  );
}

/* =====================
   Page
===================== */
export default function Page() {
  /* 🔴 Hook은 무조건 최상단 */
  const { apiKey, role, save, logout } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });
  const [loading, setLoading] = useState(false);

  /* 🔐 로그인 안 되어 있으면 여기서만 return */
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
      const j = await r.json();

      setMeta({
        ok: !!j.ok,
        updated: j.updated || "",
        error: j.error || ""
      });

      setRows(Array.isArray(j.data) ? j.data : []);
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e) });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>
        MEXC Futures DASH
        <button onClick={logout} style={{ marginLeft: 20 }}>로그아웃</button>
      </h2>

      <p>
        상태:{" "}
        <b style={{ color: meta.ok ? "green" : "red" }}>
          {meta.ok ? "OK" : "ERROR"}
        </b>
        {loading && " (loading...)"}
      </p>

      {meta.error && (
        <div style={{ color: "red" }}>error: {meta.error}</div>
      )}

      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Symbol</th>
            <th>Direction</th>
            <th>Type</th>
            <th>Price</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="6">데이터 없음</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.symbol}>
                <td>{r.rank}</td>
                <td>{r.symbol}</td>
                <td>{r.direction}</td>
                <td>{r.type}</td>
                <td>{r.price}</td>
                <td>{r.updated}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
