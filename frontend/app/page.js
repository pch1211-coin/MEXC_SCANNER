
```javascript
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** =========================
Login (LocalStorage)
========================= */
const LS_KEY = "MEXC_SCANNER_API_KEY";
const LS_ROLE = "MEXC_SCANNER_ROLE"; // "admin" | "view"

function useAuthKey() {
  // 로딩 상태를 추가하여 localStorage 로딩 중임을 표시
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("view");

  useEffect(() => {
    const loadAuth = async () => { // async 함수로 변경
      try {
        const k = localStorage.getItem(LS_KEY) || "";
        const r = localStorage.getItem(LS_ROLE) || "view";
        setApiKey(k);
        setRole(r);
      } catch (e) {
        console.error("localStorage access error:", e);
        // localStorage 접근 실패 환경 대비
        setApiKey("");
        setRole("view");
      } finally {
        setIsAuthLoaded(true); // localStorage 로딩 완료 후 true로 설정
      }
    };
    loadAuth(); // async 함수 호출
  }, []);

  const save = (k, r) => {
    try {
      localStorage.setItem(LS_KEY, k);
      localStorage.setItem(LS_ROLE, r);
    } catch (e) {
      console.error("localStorage save error:", e);
    }
    setApiKey(k);
    setRole(r);
  };

  const logout = () => {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_ROLE);
    } catch (e) {
      console.error("localStorage remove error:", e);
    }
    setApiKey("");
    setRole("view");
  };

  // isAuthLoaded 값을 함께 반환
  return { apiKey, role, save, logout, isAuthLoaded };
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

        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
          MEXC Scanner 로그인
        </div>

        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
          권한 선택 후 API Key(비밀번호)를 입력하세요.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <select
            value={r}
            onChange={(e) => setR(e.target.value)}
            style={{ flex: 1, padding: 10, borderRadius: 10 }}

            <option value="view">읽기 전용</option>
            <option value="admin">관리자</option>
          </select>
        </div>

        <input
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="API Key 입력"
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            marginBottom: 10
          }}
        />

        <button
          onClick={() => onSave(k.trim(), r)}
          disabled={!k.trim()}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            fontWeight: 800,
            cursor: k.trim() ? "pointer" : "not-allowed"
          }}

          로그인
        </button>
      </div>
    </div>
  );
}

/** =========================
UI helpers
========================= */
const DEFAULT_REFRESH_MS = 5000;
const CONFIRM_TTL_MS = 3  60  1000; // 3분
const NEAR_TTL_MS = 1  60  1000;    // 1분

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

      {children}
    </td>
  );
}

/** =========================
Page
========================= */
export default function Page() {
  // ✅ Hook은 무조건 최상단(조건부 return 위) — 이게 #310 방지 핵심
  // useAuthKey에서 isAuthLoaded 값을 받아서 사용
  const { apiKey, role, save, logout, isAuthLoaded } = useAuthKey();

  const BACKEND =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://mexc-scanner-backend.onrender.com";

  const [rows, setRows] = useState([]); // 화면에 표시되는(만료 반영) rows
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });

  const [filterType, setFilterType] = useState("ALL"); // ALL | CONFIRM | NEAR
  const [sortKey, setSortKey] = useState("NEW"); // NEW | ABS_DEV | RANK
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [loading, setLoading] = useState(false);

  // 내부 저장소: “신호 유지(확정 3분 / 근접 1분)” 구현용
  const storeRef = useRef(new Map()); // key: symbol, value: {row, firstSeen, lastSeen, expiresAt}

  // ✅ 로그인 전에는 여기서만 return (Hook 이후)
  // isAuthLoaded가 false이면 LoginGate를 렌더링하지 않음
  if (!isAuthLoaded || !apiKey) {
    return <LoginGate onSave={save} />;
  }

  async function load() {
    const controller = new AbortController();
    const sig = controller.signal;

    try {
      setLoading(true);

      const r = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey },
        signal: sig
      });

      const j = await r.json().catch(async () => {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
      });

      if (!r.ok || !j?.ok) {
        // API 키 오류 시 로그아웃 기능 추가
        if (r.status === 401 || r.status === 403) {
          console.error("Authentication failed. Logging out.");
          logout(); // 로그아웃 함수 호출
          // Optionally, show a message to the user
          setMeta({ ok: false, updated: "", error: "인증 오류로 로그아웃되었습니다. API 키를 확인해주세요." });
          return; // 로딩 중단
        }
        throw new Error(j?.error || `HTTP ${r.status}`);
      }

      setMeta({ ok: true, updated: j.updated || "", error: "" });

      const incoming = Array.isArray(j.data) ? j.data : [];
      const now = Date.now();

      // 스토어 업데이트 + TTL 적용
      for (const it of incoming) {
        if (!it?.symbol) continue;

        const type = String(it.type || "");
        const ttl = type === "전환확정" ? CONFIRM_TTL_MS : type === "전환근접" ? NEAR_TTL_MS : 0;
        if (!ttl) continue; // 확정/근접만 유지 대상으로

        const key = String(it.symbol);
        const prev = storeRef.current.get(key);

        const firstSeen = prev?.firstSeen ?? now;
        const lastSeen = now;
        const expiresAt = now + ttl;

        storeRef.current.set(key, {
          row: it,
          firstSeen,
          lastSeen,
          expiresAt
        });
      }

      // 만료 정리 + 화면 rows 재구성
      const alive = [];
      for (const [key, v] of storeRef.current.entries()) {
        if (!v || v.expiresAt <= now) {
          storeRef.current.delete(key);
          continue;
        }
        alive.push({
          ...v.row,
          __firstSeen: v.firstSeen,
          __lastSeen: v.lastSeen,
          __expiresAt: v.expiresAt
        });
      }

      setRows(alive);
    } catch (e) {
      setMeta({ ok: false, updated: "", error: String(e?.message || e) });
      // rows는 유지(= TTL 남아있는 신호는 계속 보이게)
      // API 키 오류 시에도 로그아웃 로직 추가
      if (String(e).includes("401") || String(e).includes("403")) {
        console.error("Authentication failed during fetch. Logging out.");
        logout();
        setMeta({ ok: false, updated: "", error: "인증 오류로 로그아웃되었습니다. API 키를 확인해주세요." });
        return;
      }
    } finally {
      setLoading(false);
    }

    // AbortController는 여기선 즉시 해제할 필요 없지만, 안전하게 리턴
    return () => controller.abort();
  }

  // 주기 갱신
  useEffect(() => {
    let stop = false;

    const run = async () => {
      if (그만) return;
      await load();
    };

    run();
    const t = setInterval(run, refreshMs);

    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs, apiKey, BACKEND]); // apiKey가 변경되면 갱신 로직 다시 시작

  // 만료 카운트다운 정리(1초마다 만료된 신호 제거)
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const [key, v] of storeRef.current.entries()) {
        if (!v || v.expiresAt <= now) {
          storeRef.current.delete(key);
          changed = true;
        }
      }

      if (changed) {
        const alive = [];
        for (const v of storeRef.current.values()) {
          alive.push({
            ...v.row,
            __firstSeen: v.firstSeen,
            __lastSeen: v.lastSeen,
            __expiresAt: v.expiresAt
          });
        }
        setRows(alive);
      }
    }, 1000);

    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    let out = [...rows];

    if (filterType === "CONFIRM") out = out.filter((r) => r.type === "전환확정");
    if (filterType === "NEAR") out = out.filter((r) => r.type === "전환근접");

    // ✅ 새 신호 맨 위: lastSeen 기준 내림차순
    if (sortKey === "NEW") {
      out.sort((a, b) => Number(b.__lastSeen || 0) - Number(a.__lastSeen || 0));
    } else if (sortKey === "ABS_DEV") {
      out.sort((a, b) => absVal(b.deviationPct) - absVal(a.deviationPct));
    } else {
      out.sort((a, b) => Number(a.rank || 9999) - Number(b.rank || 9999));
    }

    return out;
  }, [rows, filterType, sortKey]);

  // API 키가 로딩되었지만 비어있는 경우 (예: localStorage에 없거나 삭제된 경우)
  // !isAuthLoaded || !apiKey 조건으로 LoginGate가 렌더링되므로,
  // 이 부분에서는 이미 apiKey가 존재함을 보장받음.

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }}

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
            <div style={{ marginTop: 6, color: "crimson", wordBreak: "break-word" }}>
              error: {meta.error}
            </div>
          ) : null}
        </div>
      </div>

      {/ 컨트롤 /}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          alignItems: "end"
        }}

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>필터</div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}

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

            <option value="NEW">새 신호 순(맨 위)</option>
            <option value="ABS_DEV">Deviation(절대값) 큰 순</option>
            <option value="RANK">Rank 순</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>새로고침(초)</div>
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}

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
            fontWeight: 800
          }}

          지금 갱신
        </button>
      </div>

      {/ 테이블 /}
      <div
        style={{
          marginTop: 14,
          overflowX: "auto",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 14
        }}

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
                const type = String(r.type || "");
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
                    <Td style={{ fontWeight: 900 }}>{r.symbol}</Td>
                    <Td>{r.direction}</Td>
                    <Td style={{ fontWeight: 900 }}>
                      {type}
                      {isConfirm ? " 🔴" : isNear ? " 🟡" : ""}
                    </Td>
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
전환확정=3분 유지(빨강), 전환근접=1분 유지(노랑)
        <br />
새 신호는 자동으로 맨 위에 올라옵니다.
        <br />
이 대시보드는 백엔드 <code>/api/top30</code> 결과를 기준으로 표시합니다.
      </div>
    </div>
  );
}
```
