"use client";

/**
 * BacktestChart.tsx
 * -----------------
 * Grafica PREDICCIONES PASADAS vs. PRECIOS REALES a partir de dos fuentes:
 *
 *   modo "backtest"  -> GET /backtest?ticker=XXX
 *        Walk-forward histórico: predicho vs. real + curva de estrategia vs. buy&hold.
 *
 *   modo "history"   -> GET /forecast-history?ticker=XXX
 *        Corridas de forecast guardadas en Supabase, con actual_close backfilled.
 *
 * Requiere: recharts  ->  npm install recharts
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useState } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

type Mode = "backtest" | "history";

export default function BacktestChart() {
  const [ticker, setTicker] = useState("NVDA");
  const [mode, setMode] = useState<Mode>("backtest");
  const [rows, setRows] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setMetrics(null);
    try {
      if (mode === "backtest") {
        const res = await fetch(`${API_URL}/backtest?ticker=${ticker}`);
        if (!res.ok) throw new Error((await res.json()).detail || "Error");
        const j = await res.json();
        setRows(j.series);
        setMetrics(j.metrics);
      } else {
        const res = await fetch(`${API_URL}/forecast-history?ticker=${ticker}&limit_runs=5`);
        if (!res.ok) throw new Error((await res.json()).detail || "Error");
        const j = await res.json();
        // Aplanar: por cada punto, predicho + real (si existe)
        const map: Record<string, any> = {};
        j.runs.forEach((run: any) => {
          run.points.forEach((p: any) => {
            map[p.target_date] = map[p.target_date] || { date: p.target_date };
            map[p.target_date].predicted = p.predicted;
            map[p.target_date].mc_p5 = p.mc_p5;
            map[p.target_date].mc_p95 = p.mc_p95;
            map[p.target_date].band = p.mc_p95 - p.mc_p5;
            map[p.target_date].bandBase = p.mc_p5;
            if (p.actual_close != null) map[p.target_date].actual = p.actual_close;
          });
        });
        setRows(Object.values(map).sort((a: any, b: any) =>
          a.date.localeCompare(b.date)));
      }
    } catch (e: any) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "end" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 100, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Fuente</div>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}
            style={{ padding: 9, border: "1px solid #ddd", borderRadius: 6 }}>
            <option value="backtest">Backtest (walk-forward)</option>
            <option value="history">Histórico Supabase</option>
          </select>
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Cargando..." : "Ver predicciones pasadas"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {rows.length > 0 && (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={rows} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
            <Tooltip />
            <Legend />

            {mode === "history" && (
              <>
                <Area dataKey="bandBase" stackId="b" stroke="none" fill="transparent" legendType="none" />
                <Area dataKey="band" stackId="b" stroke="none" fill="#3498db"
                      fillOpacity={0.12} name="Banda P5–P95 (predicha)" />
              </>
            )}

            <Line dataKey="actual" stroke="#111" dot={false} strokeWidth={2}
                  name="Precio real" connectNulls />
            <Line dataKey="predicted" stroke="#e67e22" dot={false} strokeWidth={2}
                  strokeDasharray="5 4" name="Predicción" connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {metrics && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 12, marginTop: 16 }}>
          <Stat label="Precisión direccional"
                value={`${(metrics.directional_accuracy * 100).toFixed(1)}%`} />
          <Stat label="MAPE precio"
                value={`${(metrics.mape_price * 100).toFixed(2)}%`} />
          <Stat label="Estrategia (retorno)"
                value={`${(metrics.strategy_total_return * 100).toFixed(1)}%`} />
          <Stat label="Buy & Hold"
                value={`${(metrics.buyhold_total_return * 100).toFixed(1)}%`} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
