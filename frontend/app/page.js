"use client";
import { useEffect, useState, useRef } from "react";
import { useAuthKey } from "./authHook"; // 로그인 훅
import LoginGate from "./LoginGate"; // 로그인 컴포넌트

const DEFAULT_REFRESH_MS = 10000;
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "https://mexc-scanner-backend.onrender.com";

export default function Page() {
  const { apiKey, save } = useAuthKey();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ ok: false, updated: "", error: "" });
  const [alertOn, setAlertOn] = useState(true);
  const [lastSymbols, setLastSymbols] = useState({}); // 이전 상태 저장

  const beep1 = useRef(null);
  const beep2 = useRef(null);

  useEffect(() => {
    if (!apiKey) return;
    const interval = setInterval(() => load(), DEFAULT_REFRESH_MS);
    load();
    return () => clearInterval(interval);
  }, [apiKey]);

  async function load() {
    try {
      const res = await fetch(`${BACKEND}/api/top30`, {
        cache: "no-store",
        headers: { "x-api-key": apiKey }
      });

      const json = await res.json();
      if (json?.ok && Array.isArray(json.data)) {
        handleAlert(json.data);
        setRows(json.data);
        setMeta({ ok: true, updated: json.updated });
      } else {
        setMeta({ ok: false, error: json?.error || "Unknown error" });
      }
    } catch (e) {
      setMeta({ ok: false, error: e.message });
    }
  }

  function handleAlert(data) {
    if (!alertOn) return;

    data.forEach((item) => {
      const sym = item.symbol;
      const prev = lastSymbols[sym];

      if (item.type === "전환근접" && (!prev || prev.type !== "전환근접")) {
        beep1.current?.play();
      } else if (item.type === "전환확정" && (!prev || prev.type !== "전환확정")) {
        beep2.current?.play();
      }
    });

    const newState = {};
    data.forEach((item) => {
      newState[item.symbol] = { type: item.type };
    });
    setLastSymbols(newState);
  }

  if (!apiKey) return <LoginGate onSave={save} />;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">🚀 TOP30 Dashboard</h2>
      <button
        onClick={() => setAlertOn(!alertOn)}
        className="px-3 py-1 rounded bg-gray-200 text-sm mb-4"
      >
        {alertOn ? "알림소리 끄기 🔇" : "알림소리 켜기 🔈"}
      </button>

      <div className="mb-2 text-sm text-gray-500">
        마지막 업데이트: {meta.updated || "로딩 중..."}
      </div>

      {rows.map((row) => (
        <div key={row.symbol} className="p-2 border-b text-sm flex justify-between">
          <div>{row.rank}. {row.symbol}</div>
          <div>{row.type} - {row.direction}</div>
        </div>
      ))}

      <audio ref={beep1} src="/beep1.mp3" preload="auto" />
      <audio ref={beep2} src="/beep2.mp3" preload="auto" />
    </div>
  );
}
