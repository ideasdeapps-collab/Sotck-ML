"use client";

/**
 * ModelValidationTab.tsx — 📌 Validación de modelos (snapshots guardados)
 * ======================================================================
 * Flujo completo de "congelar y validar después":
 *   • 💾 Guardar snapshot  -> POST /save-snapshot  (congela TODAS las curvas hoy)
 *   • 🔄 Rellenar reales    -> POST /backfill-actuals (trae precios reales)
 *   • Selecciona un snapshot guardado y superpone PREDICHO (congelado) vs REAL
 *   • Métricas de acierto por modelo (MAPE) + cobertura de la banda Monte Carlo
 *
 * Fuente: GET /forecast-history · POST /save-snapshot · POST /backfill-actuals
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

// Curvas congeladas: clave en el punto de Supabase -> etiqueta + color
const MODELS = [
  { key: "predicted", label: "XGBoost", color: "#e67e22" },
  { key: "mlp", label: "Red Neuronal (MLP)", color: "#16a085" },
  { key: "ml_sentiment", label: "XGBoost + Sentimiento", color: "#8e44ad" },
  { key: "sentiment_only", label: "Sentimiento puro", color: "#d35400" },
  { key: "psy_a", label: "Psicología contrarian (A)", color: "#9b59b6" },
  { key: "psy_b", label: "Psicología ML (B)", color: "#2ecc71" },
  { key: "mc_median", label: "Mediana Monte Carlo", color: "#3498db" },
];

export default function ModelValidationTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [horizon, setHorizon] = useState(30);
  const [runs, setRuns] = useState<any[]>([]);
  const [selRun, setSelRun] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`); const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail); setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos (/models)."); }
    })();
  }, []);

  useEffect(() => { if (ticker) loadHistory(ticker); /* eslint-disable-next-line */ }, [ticker]);

  async function loadHistory(tk: string) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/forecast-history?ticker=${tk}&limit_runs=15`);
      if (res.status === 503) throw new Error("Supabase no está configurado en el servidor.");
      if (!res.ok) throw new Error((await res.json()).detail || "Error al leer histórico");
      const j = await res.json();
      const rs = j.runs || [];
      setRuns(rs);
      setSelRun(rs.length ? rs[0].run_id : "");
    } catch (e: any) { setError(e.message); setRuns([]); setSelRun(""); }
    finally { setLoading(false); }
  }

  async function saveSnapshot() {
    setBusy("save"); setMsg(null); setError(null);
    try {
      const res = await fetch(`${API_URL}/save-snapshot`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, horizon }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Error al guardar");
      const j = await res.json();
      setMsg(`✅ Snapshot guardado (${j.points} puntos). run_id ${String(j.run_id).slice(0, 8)}…`);
      await loadHistory(ticker);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function backfill() {
    setBusy("backfill"); setMsg(null); setError(null);
    try {
      const res = await fetch(`${API_URL}/backfill-actuals?ticker=${ticker}&days=120`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Error en backfill");
      const j = await res.json();
      setMsg(`✅ Precios reales actualizados en ${j.dates_updated} fechas.`);
      await loadHistory(ticker);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const run = useMemo(() => runs.find((r) => r.run_id === selRun) || null, [runs, selRun]);

  // Serie para graficar: por fecha, real + todas las curvas + banda MC
  const series = useMemo(() => {
    if (!run) return [];
    return (run.points || []).map((p: any) => ({
      date: p.target_date,
      actual: p.actual_close,
      predicted: p.predicted, mlp: p.mlp, ml_sentiment: p.ml_sentiment,
      sentiment_only: p.sentiment_only, psy_a: p.psy_a, psy_b: p.psy_b, mc_median: p.mc_median,
      bandBase: p.mc_p5, band: (p.mc_p95 != null && p.mc_p5 != null) ? p.mc_p95 - p.mc_p5 : null,
    }));
  }, [run]);

  // Métricas por modelo sobre puntos con actual_close != null
  const metrics = useMemo(() => {
    if (!run) return [];
    const pts = (run.points || []).filter((p: any) => p.actual_close != null);
    const evalN = pts.length;
    const out = MODELS.map((m) => {
      const valid = pts.filter((p: any) => p[m.key] != null);
      if (!valid.length) return { ...m, mape: null, n: 0 };
      const mape = valid.reduce((s: number, p: any) => s + Math.abs(p[m.key] - p.actual_close) / p.actual_close, 0) / valid.length;
      return { ...m, mape, n: valid.length };
    });
    // Cobertura banda MC P5–P95
    const cov = pts.length
      ? pts.filter((p: any) => p.mc_p5 != null && p.actual_close >= p.mc_p5 && p.actual_close <= p.mc_p95).length / pts.length
      : null;
    return { rows: out, evalN, coverage: cov } as any;
  }, [run]);

  const evalCount = (metrics as any).evalN ?? 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      {/* Controles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 110, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Horizonte a guardar (días)</div>
          <input type="number" value={horizon} min={5} max={252}
            onChange={(e) => setHorizon(Math.max(5, Number(e.target.value)))}
            style={{ padding: 8, width: 150, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={saveSnapshot} disabled={!!busy || !ticker}
          style={{ padding: "10px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {busy === "save" ? "Guardando…" : "💾 Guardar snapshot"}
        </button>
        <button onClick={backfill} disabled={!!busy || !ticker}
          style={{ padding: "10px 16px", background: "#1e824c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {busy === "backfill" ? "Actualizando…" : "🔄 Rellenar precios reales"}
        </button>
      </div>

      {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>⚠️ {error}</p>}

      {/* Selector de snapshot */}
      {runs.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>Snapshot guardado ({runs.length})</div>
          <select value={selRun} onChange={(e) => setSelRun(e.target.value)}
            style={{ padding: 9, minWidth: 360, border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_date} · {r.points?.length || 0} pts · último cierre ${r.last_close} · id {String(r.run_id).slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        !loading && <p style={{ fontSize: 13, color: "#999" }}>
          Aún no hay snapshots para {ticker}. Pulsa <b>💾 Guardar snapshot</b> para congelar la predicción de hoy.
        </p>
      )}

      {/* Gráfica predicho (congelado) vs real */}
      {run && series.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Predicción congelada del <b>{run.run_date}</b> vs. precio REAL (línea negra). {evalCount} días con dato real.
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
              <Tooltip /><Legend />
              <Area dataKey="bandBase" stackId="mc" stroke="none" fill="transparent" legendType="none" />
              <Area dataKey="band" stackId="mc" stroke="none" fill="#3498db" fillOpacity={0.10} name="Banda P5–P95" />
              {MODELS.map((m) => (
                <Line key={m.key} dataKey={m.key} stroke={m.color} dot={false} strokeWidth={1.6}
                      strokeDasharray="4 3" name={m.label} connectNulls />
              ))}
              <Line dataKey="actual" stroke="#111" dot={{ r: 2 }} strokeWidth={2.6} name="Precio REAL" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Métricas por modelo */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Acierto por modelo {evalCount === 0 && <span style={{ color: "#b8860b", fontWeight: 400 }}>— aún sin precios reales; pulsa 🔄</span>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#eef2f6" }}>
                    <th style={{ textAlign: "left", padding: "8px 10px" }}>Modelo</th>
                    <th style={{ textAlign: "right", padding: "8px 10px" }}>MAPE (error medio)</th>
                    <th style={{ textAlign: "right", padding: "8px 10px" }}>Días evaluados</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics as any).rows?.map((m: any) => (
                    <tr key={m.key} style={{ borderBottom: "1px solid #eef2f6" }}>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: m.color, marginRight: 6 }} />
                        {m.label}
                      </td>
                      <td style={{ textAlign: "right", padding: "7px 10px", fontWeight: 600 }}>
                        {m.mape == null ? "—" : `${(m.mape * 100).toFixed(2)}%`}
                      </td>
                      <td style={{ textAlign: "right", padding: "7px 10px", color: "#888" }}>{m.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(metrics as any).coverage != null && (
              <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                Cobertura banda Monte Carlo P5–P95: <b>{((metrics as any).coverage * 100).toFixed(0)}%</b> de los precios reales
                cayeron dentro del rango previsto (ideal ≈ 90%).
              </p>
            )}
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
            ⓘ Menor MAPE = modelo más preciso para este ticker y periodo. La predicción está <b>congelada</b>:
            no cambia aunque recalcules en la pestaña Predicción. Análisis educativo, no recomendación de inversión.
          </p>
        </>
      )}
    </div>
  );
}
