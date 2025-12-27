"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** =========================
 *  Login (LocalStorage)
 *  ========================= */
const LS_KEY = "MEXC_SCANNER_API_KEY";
const LS_ROLE = "MEXC_SCANNER_ROLE"; // "admin" | "view"

function useAuthKey() {
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("view");

  useEffect(() => {
    try {
      const k = localStorage.getItem(LS_KEY) || "";
      const r = localStorage.getItem(LS_ROLE) || "view";
      setApiKey(k);
      setRole(r === "admin" ? "admin" : "view");
    } catch {
      setApiKey("");
      setRole("view");
    }
  }, []);

  const save = (k, r) => {
    const key = String(k || "").trim();
    const role2 = r === "admin" ? "admin" : "view";
    try {
      localStorage.setItem(LS_KEY, key);
      localStorage.setItem(LS_ROLE, role2);
    } catch {}
    setApiKey(key);
    setRole(role2);
  };

  const logout = () => {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_ROLE);
    } catch {}
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

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
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
          style={{ width: "100%", padding: 10, borderRadius: 10, marginBottom: 10 }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onSave(k.trim(), r)}
            disabled={!k.trim()}
            style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}
          >
            로그인
          </button>
        </div>
      </div>
    </div>
  );
}

/** =========================
 *  UI helpers
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
 *  Signal retention rules
 *  =========================
 *  CONFIRM: 3분 유지
 *  NEAR:    1분 유지
 *  새 신호는 맨 위로
 */
const TTL_MS = {
  "전환확정": 3 * 60 * 1000,
  "전환근접": 1 * 60 * 1000
};

function nowMs() {
  return Date.now();
}

function pickTypeTtl(typeText) {
  return TTL_MS[typeText] || 0;
}

/**
 * key 생성: symbol + type(확정/근접)
 * 같은 코인이 확정/근접으로 번갈아 오면 서로 다른 신호로 취급
 */
function signalKeyOfRow(r) {
  const sym = String(r?.symbol || "").trim();
  const type = String(r?.type || "").trim();
  return `${sym}__${type}`;
}

export default function Page() {
  /**
   * ✅ 중요: Hook들은 항상 "조건문 return"보다 위에 있어야 함
   * => 이 구조로 React 310(조건부 Hook) 재발 방지
   */
  const { apiKey, role, save, logout } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.toString?.() ||
    "https://mexc-scanner-backend.onrender.com";

  // 서버에서 받은 원본 rows
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  // UI controls
  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("NEW"); // NEW | RANK | ABS_DEV | UPDATED
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  /**
   * 신호 유지용 저장소(렌더링과 무관하게 유지되도록 ref)
   * Map<signalKey, { row, firstSeenMs, lastSeenMs, expiresAtMs }>
   */
  const storeRef = useRef(new Map());

  // ✅ 로그인 안되어 있으면 여기서만 return (Hook 뒤!)
  if (!apiKey) {
    return <LoginGate onSave={save} />;
  }

  async function load() {
    try {
      setLoading(true);

      const url = `${BACKEND}/api/top30`;
      const r = await fetch(url, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });

      const j = await r.json().catch(async () => {
        const t = await r.text().catch(() => "");
        return { ok: false, error: t || `HTTP ${r.status}` };
      });

      setMeta({ ok: !!j.ok, updated: j.updated || "", error: j.error || "" });
      const data = Array.isArray(j.data) ? j.data : [];
      setRows(data);

      // ---- 신호 유지(store) 업데이트 ----
      const tNow = nowMs();
      const store = storeRef.current;

      // 1) 이번 fetch에서 들어온 신호들 mark
      for (const row of data) {
        const type = String(row?.type || "");
        const ttl = pickTypeTtl(type);
        if (!ttl) continue; // 확정/근접만 유지 대상

        const key = signalKeyOfRow(row);
        const prev = store.get(key);

        if (!prev) {
          // 새 신호(맨 위로 보내기 위해 firstSeenMs 기록)
          store.set(key, {
            row,
            firstSeenMs: tNow,
            lastSeenMs: tNow,
            expiresAtMs: tNow + ttl
          });
        } else {
          // 기존 신호 갱신(유지 시간 연장)
          store.set(key, {
            row, // 최신 데이터로 갱신
            firstSeenMs: prev.firstSeenMs,
            lastSeenMs: tNow,
            expiresAtMs: tNow + ttl
          });
        }
      }

      // 2) 만료된 신호 정리
      for (const [k, v] of store.entries()) {
        if (v.expiresAtMs <= tNow) store.delete(k);
      }
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // 자동 새로고침
  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs, apiKey, BACKEND]);

  /**
   * 화면에 표시할 rows:
   * - 서버 응답 rows + 유지(store) rows를 합친 뒤
   * - TTL 안에 있는 신호는 남겨서 “너무 빨리 사라짐” 방지
   */
  const mergedRows = useMemo(() => {
    const tNow = nowMs();
    const store = storeRef.current;

    // 만료 정리(렌더 타이밍에서도 한번 더)
    for (const [k, v] of store.entries()) {
      if (v.expiresAtMs <= tNow) store.delete(k);
    }

    // storeRows
    const storeRows = [];
    for (const v of store.values()) {
      storeRows.push({
        ...v.row,
        __firstSeenMs: v.firstSeenMs,
        __expiresAtMs: v.expiresAtMs
      });
    }

    /**
     * 서버 rows에도 firstSeen을 붙여주되,
     * store에 있으면 store 기준 firstSeen 사용
     */
    const out = rows.map((r) => {
      const key = signalKeyOfRow(r);
      const v = store.get(key);
      return {
        ...r,
        __firstSeenMs: v?.firstSeenMs ?? 0,
        __expiresAtMs: v?.expiresAtMs ?? 0
      };
    });

    // 중복 제거: 같은 key는 storeRows를 우선(최신 유지/정렬 정보 포함)
    const seen = new Set();
    const merged = [];

    for (const r of storeRows) {
      const key = signalKeyOfRow(r);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    for (const r of out) {
      const key = signalKeyOfRow(r);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    return merged;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = [...mergedRows];

    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    /**
     * ✅ 새 신호 맨 위:
     * - NEW 정렬: __firstSeenMs 내림차순
     * - 동점이면 Updated 최신
     */
    if (sortKey === "NEW") {
      out.sort((a, b) => {
        const fa = Number(a.__firstSeenMs || 0);
        const fb = Number(b.__firstSeenMs || 0);
        if (fb !== fa) return fb - fa;
        return String(b.updated).localeCompare(String(a.updated));
      });
    } else if (sortKey === "ABS_DEV") {
      out.sort((a, b) => absVal(b.deviationPct) - absVal(a.deviationPct));
    } else if (sortKey === "UPDATED") {
      out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    } else {
      out.sort((a, b) => Number(a.rank) - Number(b.rank));
    }

    return out;
  }, [mergedRows, filterType, sortKey]);

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
            marginLeft: "auto",
            padding: "8px 10px",
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
            <option value="NEW">새 신호 맨 위</option>
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
                  <tr key={signalKeyOfRow(r)} style={{ background: bg }}>
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
        * 전환확정=빨강(3분 유지), 전환근접=노랑(1분 유지)
        <br />
        * 새 신호는 “새 신호 맨 위” 정렬에서 자동으로 맨 위에 표시됩니다.
        <br />
        * 이 대시보드는 백엔드 <code>/api/top30</code> 결과를 표시하며, TTL 동안은 화면에서 유지됩니다.
      </div>
    </div>
  );
}
