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
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Next/React hydration 이후 1회만
    if (hydratedRef.current) return;
    hydratedRef.current = true;

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
  const [show, setShow] = useState(true);

  if (!show) return null;

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
            onClick={() => {
              onSave(k.trim(), r);
              setShow(false);
            }}
            disabled={!k.trim()}
            style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: 700 }}
          >
            로그인
          </button>
          <button
            onClick={() => setShow(false)}
            style={{ padding: 10, borderRadius: 10 }}
          >
            닫기
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

// 유지 시간(요구사항)
const KEEP_MS = {
  "전환확정": 3 * 60 * 1000, // 3분
  "전환근접": 1 * 60 * 1000  // 1분
};

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
 *  핵심: 신호 유지(프론트 캐시)
 *  - 백엔드가 다음 refresh에서 목록에서 빠져도,
 *    CONFIRM 3분 / NEAR 1분 동안 화면에 남김
 *  - 새로 생긴 신호는 맨 위로 올림
 * =========================
 *
 * cache 구조:
 * key = `${symbol}|${type}` (type이 바뀌면 새 신호로 취급)
 * value = {
 *   row: 백엔드 row 원본,
 *   firstSeenAt: 최초 등장 시간,
 *   lastSeenAt: 마지막으로 백엔드에서 관측된 시간,
 *   expiresAt: 만료 시간
 * }
 */

export default function Page() {
  // ✅ Hook은 항상 최상단 (조건 return 보다 먼저)
  const { apiKey, role, save, logout } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [rows, setRows] = useState([]); // 최종 렌더용 rows
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("RANK"); // RANK | ABS_DEV | UPDATED
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  // 프론트 캐시(Map) - 리렌더와 분리
  const cacheRef = useRef(new Map());

  // ✅ 로그인 안 되어 있으면 여기서만 return (Hook 뒤)
  if (!apiKey) {
    return <LoginGate onSave={save} />;
  }

  function cacheKeyOf(row) {
    const sym = String(row?.symbol || "");
    const type = String(row?.type || "");
    return `${sym}|${type}`;
  }

  function getKeepMs(type) {
    return KEEP_MS[type] ?? 0;
  }

  function rebuildRowsFromCache() {
    const now = Date.now();
    const cache = cacheRef.current;

    // 만료 제거
    for (const [k, v] of cache.entries()) {
      if (!v?.expiresAt || v.expiresAt <= now) {
        cache.delete(k);
      }
    }

    // 캐시 -> 배열
    const arr = [];
    for (const v of cache.values()) {
      if (!v?.row) continue;
      arr.push({
        ...v.row,
        __firstSeenAt: v.firstSeenAt,
        __lastSeenAt: v.lastSeenAt,
        __expiresAt: v.expiresAt
      });
    }

    setRows(arr);
  }

  async function load() {
    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });

      const j = await r.json();
      setMeta({ ok: !!j.ok, updated: j.updated || "", error: j.error || "" });

      const incoming = Array.isArray(j.data) ? j.data : [];
      const now = Date.now();
      const cache = cacheRef.current;

      // 들어온 신호들을 캐시에 반영
      for (const row of incoming) {
        const type = String(row?.type || "");
        // 전환확정/전환근접만 유지 대상 (그 외는 원래대로 표시 안 함)
        if (type !== "전환확정" && type !== "전환근접") continue;

        const keepMs = getKeepMs(type);
        if (!keepMs) continue;

        const key = cacheKeyOf(row);
        const prev = cache.get(key);

        if (!prev) {
          // ✅ 새 신호: firstSeenAt = now (맨 위로 올릴 근거)
          cache.set(key, {
            row,
            firstSeenAt: now,
            lastSeenAt: now,
            expiresAt: now + keepMs
          });
        } else {
          // 기존 신호: row 갱신 + 만료 시간 연장
          cache.set(key, {
            row,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
            expiresAt: now + keepMs
          });
        }
      }

      // 캐시 기반으로 렌더 rows 재구성
      rebuildRowsFromCache();
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      // 에러가 나도 기존 캐시는 유지하고 싶으면 rows를 비우지 않음
      // (원하면 아래 주석 해제 가능)
      // setRows([]);
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

  // 캐시 만료 타이머(1초마다 만료 제거하여 “유지시간” 정확히)
  useEffect(() => {
    const t = setInterval(() => {
      rebuildRowsFromCache();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let out = [...rows];

    // 필터
    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    // ✅ 새 신호를 맨 위로: firstSeenAt 내림차순 우선
    out.sort((a, b) => {
      const fa = Number(a.__firstSeenAt || 0);
      const fb = Number(b.__firstSeenAt || 0);
      if (fb !== fa) return fb - fa;

      // 그 다음은 사용자가 선택한 정렬
      if (sortKey === "ABS_DEV") {
        return absVal(b.deviationPct) - absVal(a.deviationPct);
      } else if (sortKey === "UPDATED") {
        return String(b.updated).localeCompare(String(a.updated));
      } else {
        return Number(a.rank) - Number(b.rank);
      }
    });

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
            marginLeft: 6,
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
                  <tr key={`${r.symbol}|${r.type}`} style={{ background: bg }}>
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
        * 새 신호는 맨 위로 표시됩니다.
        <br />
        * 이 대시보드는 백엔드 <code>/api/top30</code> 결과를 표시합니다.
      </div>
    </div>
  );
}
