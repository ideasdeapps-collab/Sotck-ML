"use client";

/**
 * StockForecastChart.tsx
 * ----------------------
 * Componente Next.js/React que consume el endpoint /forecast de la API de ML
 * y grafica:
 *   - Curva histórica (línea sólida)
 *   - Predicción XGBoost (línea punteada)
 *   - Abanico de escenarios Monte Carlo (bandas P5-P95 y P25-P75)
 *
 * Requiere: recharts  ->  npm install recharts
 * Variable de entorno: NEXT_PUBLIC_ML_API_URL (URL de tu API FastAPI)
 */

import { useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API_URL =
  process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

type ForecastRow = {
  date: string;
  historical?: number;
  prediction?: number;
  p5?: number;
  p95?: number;
  p25?: number;
  p75?: number;
  median?: number;
  // Para bandas apiladas en Recharts (base + rango)
  band95Base?: number;
  band95?: number;
  band75Base?: number;
  band75?: number;
};

export default function StockForecastChart() {
  const [ticker, setTicker] = useState("AAPL");
  const [horizon, setHorizon] = useState(30);
  const [data, setData] = useState<ForecastRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, horizon, n_sims: 10000 }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      const json = await res.json();

      const rows: ForecastRow[] = [];

      // 1. Histórico
      json.prediction.history.forEach((h: any) =>
        rows.push({ date: h.date, historical: h.close })
      );

      // 2. Predicción + bandas (alineadas por índice)
      const sim = json.simulation;
      json.prediction.prediction.forEach((p: any, i: number) => {
        rows.push({
          date: p.date,
          prediction: p.close,
          median: sim.median[i],
          p5: sim.p5[i],
          p95: sim.p95[i],
          p25: sim.p25[i],
          p75: sim.p75[i],
          band95Base: sim.p5[i],
          band95: sim.p95[i] - sim.p5[i],
          band75Base: sim.p25[i],
          band75: sim.p75[i] - sim.p25[i],
        });
      });

      setData(rows);
      setSummary({ ...sim.terminal, metrics: json.prediction.model_meta });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "end" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 100, border: "1px solid #ddd", borderRadius: 6 }}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Horizonte (días)</div>
          <input
            type="number"
            value={horizon}
            min={1}
            max={252}
            onChange={(e) => setHorizon(Number(e.target.value))}
            style={{ padding: 8, width: 120, border: "1px solid #ddd", borderRadius: 6 }}
          />
        </label>
        <button
          onClick={run}
          disabled={loading}
          style={{
            padding: "10px 20px", background: "#111", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
          }}
        >
          {loading ? "Calculando..." : "Proyectar"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
              <Tooltip />
              <Legend />

              {/* Banda P5-P95 (apilada: base transparente + rango sombreado) */}
              <Area dataKey="band95Base" stackId="b95" stroke="none" fill="transparent" legendType="none" />
              <Area dataKey="band95" stackId="b95" stroke="none" fill="#3498db" fillOpacity={0.12} name="Escenario P5–P95" />

              {/* Banda P25-P75 */}
              <Area dataKey="band75Base" stackId="b75" stroke="none" fill="transparent" legendType="none" />
              <Area dataKey="band75" stackId="b75" stroke="none" fill="#3498db" fillOpacity={0.22} name="Escenario P25–P75" />

              {/* Curvas */}
              <Line dataKey="historical" stroke="#111" dot={false} strokeWidth={2} name="Histórico" />
              <Line dataKey="prediction" stroke="#e67e22" dot={false} strokeWidth={2}
                    strokeDasharray="5 4" name="Predicción XGBoost" />
              <Line dataKey="median" stroke="#3498db" dot={false} strokeWidth={1.5}
                    strokeDasharray="2 3" name="Mediana Monte Carlo" />
            </ComposedChart>
          </ResponsiveContainer>

          {summary && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12, marginTop: 16,
            }}>
              <Stat label="Precio esperado (mediana)" value={`$${summary.median}`} />
              <Stat label="Rango P5–P95" value={`$${summary.p5} – $${summary.p95}`} />
              <Stat label="Prob. de subir" value={`${(summary.prob_up * 100).toFixed(1)}%`} />
              <Stat label="Retorno esperado" value={`${(summary.expected_return * 100).toFixed(1)}%`} />
            </div>
          )}
        </>
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
