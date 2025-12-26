"use client";
import { useEffect, useState } from "react";

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:10000"; // 로컬 테스트용

export default function Page() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({});

  async function load() {
    const r = await fetch(`${BACKEND}/api/top30`);
    const j = await r.json();
    setMeta({ updated: j.updated, interval: j.interval, ok: j.ok, error: j.error });
    setRows(j.data || []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>MEXC FUTURES TURN_TOP30</h2>
      <div style={{ marginBottom: 12 }}>
        backend: <b>{BACKEND}</b>
        <br />
        interval: <b>{meta.interval}</b> / updated: <b>{meta.updated}</b>
        <br />
        status: <b>{String(meta.ok)}</b>
        {meta.error ? <div style={{ color: "red" }}>error: {meta.error}</div> : null}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Symbol</th>
              <th>Direction</th>
              <th>Type</th>
              <th>Band(%)</th>
              <th>Price</th>
              <th>MA30</th>
              <th>RSI14</th>
              <th>Dev(%)</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td>{r.rank}</td>
                <td>{r.symbol}</td>
                <td>{r.direction}</td>
                <td>{r.type}</td>
                <td>{Number(r.bandPct).toFixed(2)}</td>
                <td>{r.price}</td>
                <td>{r.ma30}</td>
                <td>{Number(r.rsi14).toFixed(2)}</td>
                <td>{Number(r.deviationPct).toFixed(4)}</td>
                <td>{r.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        * 이 화면은 “동작 확인용 기본 계산” 버전입니다. 원본 구글시트 계산식을 주면 그대로 맞춰서 교체 가능합니다.
      </p>
    </div>
  );
}
