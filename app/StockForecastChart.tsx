"use client";

/**
 * StockForecastChart.tsx — Predicción + Validación
 * ================================================
 * (1) El usuario ingresa los DÍAS a proyectar (input numérico).
 * (2) Dos vistas en la misma pestaña:
 *     • PROYECCIÓN (futuro): Histórico + XGBoost + MLP + XGBoost+Sentimiento +
 *       Mediana Monte Carlo con bandas P5–P95.
 *     • VALIDACIÓN (pasado): para los últimos N días, predicho-a-1-día de cada
 *       modelo vs. el precio REAL, con métricas de acierto (MAPE + dir.acc).
 *
 * Endpoints (en paralelo):
 *   POST /forecast · GET /predict-mlp · GET /forecast-sentiment · GET /validate
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

type View = "proyeccion" | "validacion";

export default function StockForecastChart() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [days, setDays] = useState<number>(21);       // (1) usuario ingresa días
  const [view, setView] = useState<View>("proyeccion");

  const [fwd, setFwd] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [sentiment, setSentiment] = useState<any>(null);
  const [riskNote, setRiskNote] = useState<string>("");
  const [hasMlp, setHasMlp] = useState(false);

  const [val, setVal] = useState<any[]>([]);
  const [valMetrics, setValMetrics] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`);
        const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail);
        setTicker(avail.includes("TSM") ? "TSM" : avail[0] || "");
      } catch {
        setError("No se pudo cargar la lista de modelos (/models).");
      }
    })();
  }, []);

  useEffect(() => {
    if (ticker) run(ticker, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function run(tk: string, h: number) {
    setLoading(true); setError(null);
    try {
      const [fRes, mRes, sRes, vRes] = await Promise.all([
        fetch(`${API_URL}/forecast`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: tk, horizon: h, n_sims: 10000 }),
        }),
        fetch(`${API_URL}/predict-mlp?ticker=${tk}&horizon=${h}`),
        fetch(`${API_URL}/forecast-sentiment?ticker=${tk}&horizon=${h}`),
        fetch(`${API_URL}/validate?ticker=${tk}&days=${Math.max(30, h * 2)}`),
      ]);

      if (!fRes.ok) throw new Error((await fRes.json()).detail || "Error en /forecast");
      const fj = await fRes.json();

      // ---- Proyección (futuro) ----
      const rows: Record<string, any> = {};
      fj.prediction.history.forEach((hh: any) => (rows[hh.date] = { date: hh.date, historical: hh.close }));
      const sim = fj.simulation;
      fj.prediction.prediction.forEach((p: any, i: number) => {
        rows[p.date] = {
          ...(rows[p.date] || { date: p.date }),
          xgb: p.close, median: sim.median[i],
          band95Base: sim.p5[i], band95: sim.p95[i] - sim.p5[i],
        };
      });
      if (mRes.ok) {
        const mj = await mRes.json();
        mj.prediction.forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), mlp: p.close }));
        setHasMlp(true);
      } else setHasMlp(false);
      if (sRes.ok) {
        const sj = await sRes.json();
        (sj.ml_plus_sentiment || []).forEach((p: any) =>
          (rows[p.date] = { ...(rows[p.date] || { date: p.date }), mlSent: p.close }));
        setSentiment(sj.sentiment || null); setRiskNote(sj.risk_note || "");
      } else { setSentiment(null); setRiskNote(""); }
      setFwd(Object.values(rows).sort((a: any, b: any) => a.date.localeCompare(b.date)));
      setSummary({ ...sim.terminal });

      // ---- Validación (pasado, predicho vs real) ----
      if (vRes.ok) {
        const vj = await vRes.json();
        setVal(vj.series || []);
        setValMetrics(vj.metrics || null);
      } else { setVal([]); setValMetrics(null); }
    } catch (e: any) {
      setError(e.message); setFwd([]); setSummary(null);
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
            style={{ padding: 9, minWidth: 110, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Días a proyectar</div>
          <input type="number" value={days} min={1} max={252}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
            style={{ padding: 8, width: 130, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={() => ticker && run(ticker, days)} disabled={loading || !ticker}
          style={{ padding: "10px 18px", background: "#2c3e50", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Calculando…" : "↻ Calcular"}
        </button>

        {/* Conmutador de vista */}
        <div style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          {(["proyeccion", "validacion"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "9px 14px", border: "none", cursor: "pointer", fontSize: 13,
                       background: view === v ? "#111" : "#fff", color: view === v ? "#fff" : "#555",
                       fontWeight: view === v ? 700 : 400 }}>
              {v === "proyeccion" ? "Proyección" : "Validación (acierto)"}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {/* ============ VISTA PROYECCIÓN ============ */}
      {view === "proyeccion" && (
        <>
          {riskNote && (
            <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 13,
              background: divergence ? "#fbeeee" : "#eafaf1",
              borderLeft: `4px solid ${divergence ? "#c0392b" : "#1e824c"}` }}>
              <strong>Gestión de riesgo:</strong> {riskNote}
              {sentiment && <span style={{ color: "#666" }}>{"  "}· Sentimiento {sentiment.score}</span>}
            </div>
          )}
          {fwd.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart data={fwd} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip /><Legend />
                  <Area dataKey="band95Base" stackId="b" stroke="none" fill="transparent" legendType="none" />
                  <Area dataKey="band95" stackId="b" stroke="none" fill="#3498db" fillOpacity={0.10} name="Escenario P5–P95" />
                  <Line dataKey="historical" stroke="#111" dot={false} strokeWidth={2} name="Histórico" connectNulls />
                  <Line dataKey="xgb" stroke="#e67e22" dot={false} strokeWidth={2} strokeDasharray="5 4" name="XGBoost" connectNulls />
                  <Line dataKey="mlp" stroke="#16a085" dot={false} strokeWidth={2} name="Red Neuronal (MLP)" connectNulls />
                  <Line dataKey="mlSent" stroke="#8e44ad" dot={false} strokeWidth={2} name="XGBoost + Sentimiento" connectNulls />
                  <Line dataKey="median" stroke="#3498db" dot={false} strokeWidth={1.2} strokeDasharray="2 3" name="Mediana Monte Carlo" connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
              {summary && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
                  <Stat label={`Precio esperado (${days}d)`} value={`$${summary.median}`} />
                  <Stat label="Rango P5–P95" value={`$${summary.p5} – $${summary.p95}`} />
                  <Stat label="Prob. de subir" value={`${(summary.prob_up * 100).toFixed(1)}%`} />
                  <Stat label="Retorno esperado" value={`${(summary.expected_return * 100).toFixed(1)}%`} />
                </div>
              )}
              {!hasMlp && (
                <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>
                  ⓘ {ticker} no tiene modelo MLP entrenado (curva verde oculta).
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* ============ VISTA VALIDACIÓN ============ */}
      {view === "validacion" && (
        <>
          <p style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
            Cada punto es la <b>predicción a 1 día</b> de cada modelo vs. el <b>precio real</b>.
            Mientras más pegada al negro, más acertó esa curva.
          </p>
          {val.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={val} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip /><Legend />
                  <Line dataKey="actual" stroke="#111" dot={false} strokeWidth={2.5} name="Precio REAL" connectNulls />
                  <Line dataKey="xgb" stroke="#e67e22" dot={false} strokeWidth={1.6} strokeDasharray="4 3" name="XGBoost (predicho)" connectNulls />
                  <Line dataKey="mlp" stroke="#16a085" dot={false} strokeWidth={1.6} strokeDasharray="4 3" name="MLP (predicho)" connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
              {valMetrics && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 16 }}>
                  <ModelCard title="XGBoost" color="#e67e22" m={valMetrics.xgb} />
                  <ModelCard title="Red Neuronal (MLP)" color="#16a085" m={valMetrics.mlp} />
                </div>
              )}
              <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
                ⓘ <b>Dir.Acc</b> = % de días que acertó la dirección (subir/bajar). <b>MAPE</b> = error medio del precio.
                Un modelo &gt;50% en dirección tiene valor predictivo.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#999" }}>Sin datos de validación para {ticker}.</p>
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

function ModelCard({ title, color, m }: { title: string; color: string; m: any }) {
  if (!m) return (
    <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#999" }}>Sin modelo entrenado</div>
    </div>
  );
  return (
    <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ display: "flex", gap: 18, fontSize: 14 }}>
        <span>Dir.Acc: <b>{(m.directional_accuracy * 100).toFixed(1)}%</b></span>
        <span>MAPE: <b>{(m.mape * 100).toFixed(2)}%</b></span>
        <span style={{ color: "#999" }}>({m.n} días)</span>
      </div>
    </div>
  );
}
