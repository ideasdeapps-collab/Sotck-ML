"use client";

/**
 * Dashboard.tsx
 * -------------
 * Tabla ordenable con los 18 tickers y sus métricas de modelo + backtest.
 * Fuente: GET /dashboard
 *
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

type Row = {
  ticker: string;
  last_close?: number;
  last_date?: string;
  train_dir_acc?: number;
  sigma_daily?: number;
  bt_dir_acc?: number;
  bt_mape?: number;
  bt_strategy?: number;
  bt_buyhold?: number;
  bt_sharpe?: number;
};

type SortKey = keyof Row;

export default function Dashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("bt_dir_acc");
  const [asc, setAsc] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/dashboard`);
      if (!res.ok) throw new Error("Error API /dashboard");
      const j = await res.json();
      setRows(j.rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === "string" || typeof bv === "string") {
        return asc ? String(av).localeCompare(String(bv))
                   : String(bv).localeCompare(String(av));
      }
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [rows, sortKey, asc]);

  function th(label: string, key: SortKey, hint?: string) {
    const active = sortKey === key;
    return (
      <th
        onClick={() => { setSortKey(key); setAsc(active ? !asc : false); }}
        title={hint}
        style={{
          padding: "10px 8px", textAlign: "right", cursor: "pointer",
          borderBottom: "2px solid #eee", whiteSpace: "nowrap",
          color: active ? "#111" : "#666", fontSize: 12, userSelect: "none",
        }}
      >
        {label} {active ? (asc ? "▲" : "▼") : ""}
      </th>
    );
  }

  const pct = (v?: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const num = (v?: number) => (v == null ? "—" : v.toFixed(2));

  function retColor(v?: number) {
    if (v == null) return "#999";
    return v >= 0 ? "#1e824c" : "#c0392b";
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>📊 Panel de modelos</h2>
        <button onClick={load} disabled={loading}
          style={{ padding: "8px 16px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Actualizando..." : "Refrescar"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead style={{ background: "#fafafa" }}>
            <tr>
              <th onClick={() => { setSortKey("ticker"); setAsc(sortKey === "ticker" ? !asc : true); }}
                  style={{ padding: "10px 8px", textAlign: "left", cursor: "pointer",
                           borderBottom: "2px solid #eee", fontSize: 12 }}>
                Ticker {sortKey === "ticker" ? (asc ? "▲" : "▼") : ""}
              </th>
              {th("Precio", "last_close")}
              {th("Backtest Dir.Acc", "bt_dir_acc", "Precisión direccional en backtest")}
              {th("MAPE", "bt_mape", "Error porcentual medio del precio")}
              {th("Estrategia", "bt_strategy", "Retorno de la estrategia en backtest")}
              {th("Buy&Hold", "bt_buyhold")}
              {th("Sharpe", "bt_sharpe")}
              {th("Volatilidad", "sigma_daily", "σ diaria histórica")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.ticker} style={{ borderBottom: "1px solid #f3f3f3" }}>
                <td style={{ padding: "9px 8px", fontWeight: 600 }}>{r.ticker}</td>
                <td style={{ padding: "9px 8px", textAlign: "right" }}>
                  {r.last_close != null ? `$${r.last_close.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right" }}>{pct(r.bt_dir_acc)}</td>
                <td style={{ padding: "9px 8px", textAlign: "right" }}>{pct(r.bt_mape)}</td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: retColor(r.bt_strategy) }}>
                  {pct(r.bt_strategy)}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: retColor(r.bt_buyhold) }}>
                  {pct(r.bt_buyhold)}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right" }}>{num(r.bt_sharpe)}</td>
                <td style={{ padding: "9px 8px", textAlign: "right" }}>{pct(r.sigma_daily)}</td>
              </tr>
            ))}
            {sorted.length === 0 && !loading && (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: "#999" }}>
                Sin datos. Entrena modelos y corre backtests primero.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
        Haz clic en cualquier encabezado para ordenar. Dir.Acc &gt; 50% indica valor predictivo direccional.
      </p>
    </div>
  );
}
