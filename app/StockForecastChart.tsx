"use client";

/**
 * StockForecastChart.tsx — Predicción (mejorada)
 * ==============================================
 * ✅ Selector de rango: 1D · 5D · 1M · 6M  (por defecto 1M, ya calculada al cargar)
 * ✅ Ticker como LISTA DESPLEGABLE (poblada desde /models)
 * ✅ Incluye la curva "ML + Sentimiento" superpuesta + nota de riesgo
 *
 * Combina 2 endpoints en paralelo:
 *   POST /forecast            -> histórico + XGBoost + bandas Monte Carlo
 *   GET  /forecast-sentiment  -> curva ajustada por sentimiento + noticias
 *
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

// Rangos -> horizonte en días hábiles de proyección
const RANGES: { id: string; label: string; horizon: number }[] = [
  { id: "1D", label: "1D", horizon: 1 },
  { id: "5D", label: "5D", horizon: 5 },
  { id: "1M", label: "1M", horizon: 21 },
  { id: "6M", label: "6M", horizon: 126 },
];
const DEFAULT_RANGE = "1M";

export default function StockForecastChart() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [range, setRange] = useState<string>(DEFAULT_RANGE);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [sentiment, setSentiment] = useState<any>(null);
  const [riskNote, setRiskNote] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const horizon = useMemo(
    () => RANGES.find((r) => r.id === range)?.horizon ?? 21, [range]);

  // 1) Al montar: cargar la lista de modelos y autocalcular con el default
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/models`);
        const j = await res.json();
        const avail: string[] = j.available || [];
        setModels(avail);
        // Ticker por defecto: TSM si existe, si no el primero disponible
        const def = avail.includes("TSM") ? "TSM" : avail[0] || "";
        setTicker(def);
      } catch {
        setError("No se pudo cargar la lista de modelos (/models).");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Cuando ya hay ticker (o cambia ticker/rango): recalcular automáticamente
  useEffect(() => {
    if (ticker) run(ticker, horizon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, range]);

  async function run(tk: string, h: number) {
    setLoading(true); setError(null);
    try {
      // Llamadas en paralelo (Polygon cachea el diario, así que no gasta cuota extra)
      const [fRes, sRes] = await Promise.all([
        fetch(`${API_URL}/forecast`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: tk, horizon: h, n_sims: 10000 }),
        }),
        fetch(`${API_URL}/forecast-sentiment?ticker=${tk}&horizon=${h}`),
      ]);

      if (!fRes.ok) throw new Error((await fRes.json()).detail || "Error en /forecast");
      const fj = await fRes.json();

      // Sentimiento puede fallar (sin noticias) -> degradar con elegancia
      let sj: any = null;
      if (sRes.ok) sj = await sRes.json();

      const rows: Record<string, any> = {};
      fj.prediction.history.forEach((hh: any) =>
        (rows[hh.date] = { date: hh.date, historical: hh.close }));

      const sim = fj.simulation;
      fj.prediction.prediction.forEach((p: any, i: number) => {
        rows[p.date] = {
          ...(rows[p.date] || { date: p.date }),
          prediction: p.close, median: sim.median[i],
          band95Base: sim.p5[i], band95: sim.p95[i] - sim.p5[i],
          band75Base: sim.p25[i], band75: sim.p75[i] - sim.p25[i],
        };
      });

      // Curva ML + Sentimiento (alineada por fecha)
      if (sj?.ml_plus_sentiment) {
        sj.ml_plus_sentiment.forEach((p: any) => {
          rows[p.date] = { ...(rows[p.date] || { date: p.date }), mlSent: p.close };
        });
        setSentiment(sj.sentiment);
        setRiskNote(sj.risk_note || "");
      } else {
        setSentiment(null); setRiskNote("");
      }

      const merged = Object.values(rows).sort((a: any, b: any) => a.date.localeCompare(b.date));
      setData(merged);
      setSummary({ ...sim.terminal, metrics: fj.prediction.model_meta,
                   lastClose: fj.prediction.last_close });
    } catch (e: any) {
      setError(e.message); setData([]); setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  const divergence = riskNote.includes("Divergencia");

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      {/* Controles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 120, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        {/* Selector de rango (segmented) */}
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>Rango</div>
          <div style={{ display: "inline-flex", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
            {RANGES.map((r) => (
              <button key={r.id} onClick={() => setRange(r.id)}
                style={{
                  padding: "9px 16px", border: "none", cursor: "pointer", fontSize: 13,
                  background: range === r.id ? "#111" : "#fff",
                  color: range === r.id ? "#fff" : "#555",
                  fontWeight: range === r.id ? 700 : 400,
                }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => ticker && run(ticker, horizon)} disabled={loading || !ticker}
          style={{ padding: "10px 18px", background: "#2c3e50", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Calculando…" : "↻ Recalcular"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {/* Nota de gestión de riesgo (sentimiento) */}
      {riskNote && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 13,
          background: divergence ? "#fbeeee" : "#eafaf1",
          borderLeft: `4px solid ${divergence ? "#c0392b" : "#1e824c"}` }}>
          <strong>Gestión de riesgo:</strong> {riskNote}
          {sentiment && (
            <span style={{ color: "#666" }}>
              {"  "}· Sentimiento {sentiment.score} (▲{sentiment.pos} ▼{sentiment.neg} ●{sentiment.neu})
            </span>
          )}
        </div>
      )}

      {data.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={430}>
            <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
              <Tooltip />
              <Legend />
              {/* Bandas Monte Carlo */}
              <Area dataKey="band95Base" stackId="b95" stroke="none" fill="transparent" legendType="none" />
              <Area dataKey="band95" stackId="b95" stroke="none" fill="#3498db" fillOpacity={0.10} name="Escenario P5–P95" />
              <Area dataKey="band75Base" stackId="b75" stroke="none" fill="transparent" legendType="none" />
              <Area dataKey="band75" stackId="b75" stroke="none" fill="#3498db" fillOpacity={0.20} name="Escenario P25–P75" />
              {/* Curvas */}
              <Line dataKey="historical" stroke="#111" dot={false} strokeWidth={2} name="Histórico" connectNulls />
              <Line dataKey="prediction" stroke="#e67e22" dot={false} strokeWidth={2}
                    strokeDasharray="5 4" name="Predicción XGBoost" connectNulls />
              <Line dataKey="mlSent" stroke="#8e44ad" dot={false} strokeWidth={2}
                    name="XGBoost + Sentimiento" connectNulls />
              <Line dataKey="median" stroke="#3498db" dot={false} strokeWidth={1.3}
                    strokeDasharray="2 3" name="Mediana Monte Carlo" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
              <Stat label={`Precio esperado (${range})`} value={`$${summary.median}`} />
              <Stat label="Rango P5–P95" value={`$${summary.p5} – $${summary.p95}`} />
              <Stat label="Prob. de subir" value={`${(summary.prob_up * 100).toFixed(1)}%`} />
              <Stat label="Retorno esperado" value={`${(summary.expected_return * 100).toFixed(1)}%`} />
            </div>
          )}

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
            ⓘ La curva morada ajusta la predicción XGBoost con el sentimiento de noticias
            (Polygon), como modulador de riesgo. Bandas azules = escenarios Monte Carlo.
          </p>
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
