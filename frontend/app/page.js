"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** =========================================================
 *  ✅ 로그인(LocalStorage) - Hooks 규칙 100% 준수
 *  ========================================================= */
const LS_KEY = "MEXC_SCANNER_API_KEY";
const LS_ROLE = "MEXC_SCANNER_ROLE"; // "admin" | "view"

function useAuthKey() {
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("view");
  const mounted = useRef(false);

  useEffect(() => {
    // StrictMode 2번 실행에도 안전하게 1번만 반영
    if (mounted.current) return;
    mounted.current = true;

    try {
      const k = localStorage.getItem(LS_KEY) || "";
      const r = localStorage.getItem(LS_ROLE) || "view";
      setApiKey(k);
      setRole(r);
    } catch {
      setApiKey("");
      setRole("view");
    }
  }, []);

  const save = (k, r) => {
    const kk = String(k || "").trim();
    const rr = r === "admin" ? "admin" : "view";
    try {
      localStorage.setItem(LS_KEY, kk);
      localStorage.setItem(LS_ROLE, rr);
    } catch {}
    setApiKey(kk);
    setRole(rr);
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
          width: 380,
          maxWidth: "92vw",
          background: "#111",
          color: "#fff",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
          MEXC Scanner 로그인
        </div>

        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 12 }}>
          역할 선택 후 비밀번호(API Key)를 입력하세요.
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
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
          placeholder="비밀번호(API Key)"
          style={{ width: "100%", padding: 10, borderRadius: 10, marginBottom: 10 }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onSave(k, r)}
            disabled={!String(k || "").trim()}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 10,
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            로그인
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          * 키가 없거나 틀리면 데이터가 안 뜰 수 있어요.
        </div>
      </div>
    </div>
  );
}

/** =========================================================
 *  ✅ UI 유틸
 *  ========================================================= */
const DEFAULT_REFRESH_MS = 30000; // 최대 30초로 고정(사용자 요청)
const CONFIRM_KEEP_MS = 3 * 60 * 1000; // 3분 유지
const NEAR_KEEP_MS = 1 * 60 * 1000; // 1분 유지

function fmt(n, digits = 6) {
  if (n === null || n === undefined) return "";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toFixed(digits).replace(/\.?0+$/, "");
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

/** =========================================================
 *  ✅ 메인 페이지 (통째 교체본)
 *  - CONFIRM 3분, NEAR 1분 유지
 *  - 새 신호는 맨 위로
 *  - 훅 규칙 위반(React 310) 절대 안 터짐
 *  - x-api-key 헤더 포함
 *  ========================================================= */
export default function Page() {
  // ✅ Hooks는 무조건 최상단 (규칙 100% 준수)
  const { apiKey, role, save, logout } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL || "https://mexc-scanner-backend.onrender.com";

  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });
  const [loading, setLoading] = useState(false);

  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("LATEST_SIGNAL"); // LATEST_SIGNAL | RANK | UPDATED

  // ✅ 새로고침은 최대 30초만 (고정)
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);

  /**
   * ✅ "유지 로직"을 위해 rows를 그대로 쓰면 안됨.
   * 서버가 다음 주기에서 사라지면, 프론트가 TTL로 유지해야 함.
   *
   * store: Map<symbol, { row, seenAt(ms), signalAt(ms), type }>
   */
  const storeRef = useRef(new Map());
  const [viewRows, setViewRows] = useState([]);

  // ✅ 로그인 안되면 UI만 반환 (Hook 뒤에서 return)
  if (!apiKey) return <LoginGate onSave={save} />;

  // 타입/TTL 계산
  function keepMsForType(typeText) {
    if (typeText === "전환확정") return CONFIRM_KEEP_MS;
    if (typeText === "전환근접") return NEAR_KEEP_MS;
    return 0;
  }

  function nowMs() {
    return Date.now();
  }

  async function load() {
    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });

      // JSON이 아닐 수도 있어서 방어
      const text = await r.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${r.status} ${text.slice(0, 160)}`);
      }

      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${r.status}`);
      }

      setMeta({ ok: true, updated: j.updated || "", error: "" });

      const incoming = Array.isArray(j.data) ? j.data : [];
      const now = nowMs();

      // ✅ store 업데이트(신규/갱신)
      const store = storeRef.current;

      for (const row of incoming) {
        if (!row || !row.symbol) continue;
        const sym = String(row.symbol);

        const type = String(row.type || "");
        const ttl = keepMsForType(type);
        if (!ttl) continue; // 전환근접/확정만 유지 대상

        const prev = store.get(sym);

        // "신호 발생 시간" 기준: 타입이 바뀌거나, 이전에 없었다면 now를 signalAt
        const signalAt =
          !prev || prev.type !== type
            ? now
            : prev.signalAt; // 같은 타입이면 기존 신호 발생 시각 유지

        store.set(sym, {
          row: { ...row },
          seenAt: now,
          signalAt,
          type
        });
      }

      // ✅ 만료 정리 + viewRows 재계산
      rebuildViewRows_();

    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      // 에러가 나도 "유지 중인 항목"은 계속 보여주되 TTL 만료는 계속 진행
      rebuildViewRows_();
    } finally {
      setLoading(false);
    }
  }

  function rebuildViewRows_() {
    const store = storeRef.current;
    const now = nowMs();

    // 만료 제거
    for (const [sym, v] of store.entries()) {
      const ttl = keepMsForType(v.type);
      if (!ttl) {
        store.delete(sym);
        continue;
      }
      const age = now - v.signalAt;
      if (age > ttl) {
        store.delete(sym);
      }
    }

    // 배열화
    const arr = Array.from(store.values()).map((v) => {
      const remaining = Math.max(0, keepMsForType(v.type) - (now - v.signalAt));
      return {
        ...v.row,
        __signalAt: v.signalAt,
        __remainingMs: remaining
      };
    });

    setViewRows(arr);
  }

  // ✅ 자동 갱신 (StrictMode에도 안전)
  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      await load();
    };

    tick();
    const t = setInterval(tick, refreshMs);

    // TTL 만료(초 단위로 남은 시간 표시 갱신)
    const t2 = setInterval(() => {
      if (!alive) return;
      rebuildViewRows_();
    }, 1000);

    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs, apiKey, BACKEND]);

  // ✅ 필터/정렬
  const filtered = useMemo(() => {
    let out = [...viewRows];

    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    // 새 신호 맨위: signalAt DESC
    if (sortKey === "LATEST_SIGNAL") {
      out.sort((a, b) => Number(b.__signalAt || 0) - Number(a.__signalAt || 0));
      return out;
    }

    // rank
    if (sortKey === "RANK") {
      out.sort((a, b) => Number(a.rank || 999999) - Number(b.rank || 999999));
      return out;
    }

    // updated string
    out.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    return out;
  }, [viewRows, filterType, sortKey]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>MEXC Futures DASH</h2>
        <span style={{ fontSize: 12, opacity: 0.75 }}>backend: {BACKEND}</span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>role: {role}</span>
        <button
          onClick={logout}
          style={{
            marginLeft: 8,
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            cursor: "pointer",
            fontWeight: 800
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
          {meta.error ? <div style={{ marginTop: 6, color: "crimson" }}>error: {meta.error буш}</div> : null}
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
            <option value="LATEST_SIGNAL">새 신호(맨위)</option>
            <option value="RANK">Rank 순</option>
            <option value="UPDATED">갱신시간 순</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>새로고침(초)</div>
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}
          >
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
            fontWeight: 800
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
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 980 }}>
          <thead>
            <tr>
              <Th>Rank</Th>
              <Th>Symbol</Th>
              <Th>Direction</Th>
              <Th>Type</Th>
              <Th>유지(남은시간)</Th>
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
                <td colSpan={11} style={{ padding: 14, opacity: 0.7 }}>
                  조건에 맞는 항목이 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const type = String(r.type || "");
                const isConfirm = type === "전환확정";
                const isNear = type === "전환근접";

                const bg = isConfirm
                  ? "rgba(255,77,77,0.25)"
                  : isNear
                  ? "rgba(255,242,204,0.9)"
                  : "transparent";

                const remainSec = Math.ceil((Number(r.__remainingMs || 0) / 1000) || 0);
                const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
                const ss = String(remainSec % 60).padStart(2, "0");

                return (
                  <tr key={r.symbol} style={{ background: bg }}>
                    <Td>{r.rank}</Td>
                    <Td style={{ fontWeight: 900 }}>{r.symbol}</Td>
                    <Td>{r.direction}</Td>
                    <Td style={{ fontWeight: 900 }}>
                      {type}
                      {isConfirm ? " 🔴" : isNear ? " 🟡" : ""}
                    </Td>
                    <Td style={{ fontWeight: 800 }}>{mm}:{ss}</Td>
                    <Td>{fmt(r.bandPct, 3)}</Td>
                    <Td>{fmt(r.price, 8)}</Td>
                    <Td>{fmt(r.ma30, 8)}</Td>
                    <Td>{fmt(r.rsi14, 2)}</Td>
                    <Td style={{ fontWeight: 800 }}>{fmt(r.deviationPct, 4)}</Td>
                    <Td>{r.updated}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
        * 전환확정=3분 유지(빨강), 전환근접=1분 유지(노랑)
        <br />
        * 새 신호는 무조건 맨 위로 표시됩니다.
        <br />
        * 이 대시보드는 백엔드 <code>/api/top30</code> 결과를 기반으로 “프론트에서 TTL 유지” 합니다.
      </div>
    </div>
  );
}
