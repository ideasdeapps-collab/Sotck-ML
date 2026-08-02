"use client";

/**
 * SentimentChart.tsx — Serie ML + Noticias + Sentimiento
 * ======================================================
 * Grafica la curva XGBoost original vs. la curva ajustada por el sentimiento de
 * noticias reales de Polygon, con marcadores de noticias (verde/rojo/gris) y una
 * nota de gestión de riesgo (confluencia vs. divergencia).
 *
 * Fuente: GET /forecast-sentiment?ticker=NVDA&horizon=30
 * Requiere: recharts. Env: NEXT_PUBLIC_ML_API_URL
 */

import { useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceDot,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

const SENT_COLOR: Record<string, string> = {
  positive: "#1e824c", negative: "#c0392b", neutral: "#95a5a6",
};

export default function SentimentChart() {
  const [ticker, setTicker] = useState("NVDA");
  const [horizon, setHorizon] = useState(30);
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/forecast-sentiment?ticker=${ticker}&horizon=${horizon}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      const j = await res.json();
      const map: Record<string, any> = {};
      j.history.forEach((h: any) => (map[h.date] = { date: h.date, historical: h.close }));
      j.ml_only.forEach((p: any) => (map[p.date] = { ...(map[p.date] || { date: p.date }), ml: p.close }));
      j.ml_plus_sentiment.forEach((p: any) =>
        (map[p.date] = { ...(map[p.date] || { date: p.date }), mlSent: p.close }));
      setRows(Object.values(map).sort((a: any, b: any) => a.date.localeCompare(b.date)));
      setData(j);
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  const s = data?.sentiment;
  const divergence = data?.risk_note?.includes("Divergencia");

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "end" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 90, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Horizonte</div>
          <input type="number" value={horizon} min={5} max={120}
            onChange={(e) => setHorizon(Number(e.target.value))}
            style={{ padding: 8, width: 90, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Predicción + Sentimiento"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          {/* Nota de riesgo */}
          <div style={{
            padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 13,
            background: divergence ? "#fbeeee" : "#eafaf1",
            borderLeft: `4px solid ${divergence ? "#c0392b" : "#1e824c"}` }}>
            <strong>Gestión de riesgo:</strong> {data.risk_note}
          </div>

          {/* Resumen de sentimiento */}
          <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 13, flexWrap: "wrap" }}>
            <span>Score de sentimiento: <strong>{s.score}</strong></span>
            <span style={{ color: "#1e824c" }}>▲ {s.pos} positivas</span>
            <span style={{ color: "#c0392b" }}>▼ {s.neg} negativas</span>
            <span style={{ color: "#95a5a6" }}>● {s.neu} neutras</span>
            <span style={{ color: "#888" }}>({s.n} noticias)</span>
          </div>

          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={rows} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-40}
                     textAnchor="end" height={60} minTickGap={20} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
              <Tooltip />
              <Legend verticalAlign="top" />
              <Line dataKey="historical" stroke="#111" dot={false} strokeWidth={2} name="Histórico" connectNulls />
              <Line dataKey="ml" stroke="#e67e22" dot={false} strokeWidth={2}
                    strokeDasharray="5 4" name="Predicción XGBoost" connectNulls />
              <Line dataKey="mlSent" stroke="#8e44ad" dot={false} strokeWidth={2}
                    name="XGBoost + Sentimiento" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Noticias recientes */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              📰 Noticias recientes ({data.news.length})
            </div>
            {data.news.map((n: any, k: number) => (
              <div key={k} style={{
                padding: "6px 10px", marginBottom: 6, borderRadius: 6, fontSize: 12,
                background: "#f7f7f8",
                borderLeft: `3px solid ${SENT_COLOR[n.sentiment] || "#95a5a6"}` }}>
                <span style={{ color: SENT_COLOR[n.sentiment], fontWeight: 600 }}>
                  {n.sentiment === "positive" ? "▲" : n.sentiment === "negative" ? "▼" : "●"}{" "}
                </span>
                {n.url
                  ? <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "#2c3e50" }}>{n.title}</a>
                  : n.title}
                <span style={{ color: "#999" }}> — {n.publisher} · {n.date}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>
            ⓘ La curva morada inclina la predicción del modelo según el sentimiento agregado
            (tilt diario acotado a ±0.15%). Sirve como modulador de riesgo, no como pronóstico exacto.
          </p>
        </>
      )}
    </div>
  );
}
