"use client";

/**
 * ModelValidationTab.tsx — 📌 Validación de modelos (rediseño)
 * ===========================================================
 * DISEÑO NUEVO (sugerencia de Luis):
 *   • El PRECIO REAL se trae EN VIVO (GET /price-history) y se muestra SIEMPRE,
 *     independiente de cualquier snapshot. Es la "capa de verdad".
 *   • El botón 💾 Guardar snapshot congela SOLO las predicciones.
 *   • La validación es INMEDIATA: donde el precio real ya alcanzó las fechas
 *     predichas, se compara al vuelo (MAPE por modelo). Sin depender del backfill.
 *
 * Fuentes: GET /price-history · GET /forecast-history · POST /save-snapshot
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

// Curvas congeladas del snapshot: clave en Supabase -> etiqueta + color
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

  const [realHist, setRealHist] = useState<{ date: string; close: number }[]>([]);
  const [realLastDate, setRealLastDate] = useState<string>("");
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

  useEffect(() => { if (ticker) loadAll(ticker); /* eslint-disable-next-line */ }, [ticker]);

  async function loadAll(tk: string) {
    setLoading(true); setError(null);
    try {
      // 1) Precio real EN VIVO (siempre) + 2) snapshots guardados (predicciones)
      const [pRes, hRes] = await Promise.all([
        fetch(`${API_URL}/price-history?ticker=${tk}&days=220`),
        fetch(`${API_URL}/forecast-history?ticker=${tk}&limit_runs=20`),
      ]);
      if (pRes.ok) {
        const pj = await pRes.json();
        setRealHist(pj.history || []);
        setRealLastDate(pj.last_date || "");
      } else { setRealHist([]); setRealLastDate(""); }

      if (hRes.status === 503) throw new Error("Supabase no está configurado en el servidor.");
      if (hRes.ok) {
        const hj = await hRes.json();
        const rs = hj.runs || [];
        setRuns(rs);
        setSelRun(rs.length ? rs[0].run_id : "");
      } else { setRuns([]); setSelRun(""); }
    } catch (e: any) { setError(e.message); }
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
      setMsg(`✅ Predicción congelada (${j.points} puntos, 7 curvas). id ${String(j.run_id).slice(0, 8)}…`);
      await loadAll(ticker);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const run = useMemo(() => runs.find((r) => r.run_id === selRun) || null, [runs, selRun]);

  // Mapa de precio real por fecha (en vivo)
  const realByDate = useMemo(() => {
    const m: Record<string, number> = {};
    realHist.forEach((p) => (m[p.date] = p.close));
    return m;
  }, [realHist]);

  // Serie unificada: precio real (siempre) + curvas congeladas del snapshot
  const series = useMemo(() => {
    const byDate: Record<string, any> = {};
    // 1) Precio real en TODAS sus fechas
    realHist.forEach((p) => (byDate[p.date] = { date: p.date, actual: p.close }));
    // 2) Curvas congeladas del snapshot elegido
    if (run) {
      (run.points || []).forEach((pt: any) => {
        byDate[pt.target_date] = {
          ...(byDate[pt.target_date] || { date: pt.target_date }),
          predicted: pt.predicted, mlp: pt.mlp, ml_sentiment: pt.ml_sentiment,
          sentiment_only: pt.sentiment_only, psy_a: pt.psy_a, psy_b: pt.psy_b, mc_median: pt.mc_median,
          bandBase: pt.mc_p5, band: (pt.mc_p95 != null && pt.mc_p5 != null) ? pt.mc_p95 - pt.mc_p5 : null,
        };
      });
    }
    return Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [realHist, run]);

  // Métricas al vuelo: predicho congelado vs precio real EN VIVO (fechas que ya ocurrieron)
  const metrics = useMemo(() => {
    if (!run) return null;
    const pts = (run.points || []).filter((p: any) => realByDate[p.target_date] != null);
    const evalN = pts.length;
    const rows = MODELS.map((m) => {
      const valid = pts.filter((p: any) => p[m.key] != null);
      if (!valid.length) return { ...m, mape: null, n: 0 };
      const mape = valid.reduce((s: number, p: any) => {
        const real = realByDate[p.target_date];
        return s + Math.abs(p[m.key] - real) / real;
      }, 0) / valid.length;
      return { ...m, mape, n: valid.length };
    });
    const cov = pts.length
      ? pts.filter((p: any) => {
          const real = realByDate[p.target_date];
          return p.mc_p5 != null && real >= p.mc_p5 && real <= p.mc_p95;
        }).length / pts.length
      : null;
    return { rows, evalN, coverage: cov };
  }, [run, realByDate]);

  const evalCount = metrics?.evalN ?? 0;
  const runDate = run?.run_date;

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
          <div style={{ fontSize: 12, color: "#666" }}>Horizonte a congelar (días)</div>
          <input type="number" value={horizon} min={5} max={252}
            onChange={(e) => setHorizon(Math.max(5, Number(e.target.value)))}
            style={{ padding: 8, width: 160, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={saveSnapshot} disabled={!!busy || !ticker}
          style={{ padding: "10px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {busy === "save" ? "Guardando…" : "💾 Guardar predicción"}
        </button>
        <button onClick={() => ticker && loadAll(ticker)} disabled={loading || !ticker}
          style={{ padding: "10px 16px", background: "#1e824c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Cargando…" : "🔄 Actualizar precio real"}
        </button>
      </div>

      {realLastDate && <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>
        Precio real en vivo hasta el <b>{realLastDate}</b>.
      </p>}
      {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>⚠️ {error}</p>}

      {/* Selector de snapshot */}
      {runs.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>Predicción congelada ({runs.length})</div>
          <select value={selRun} onChange={(e) => setSelRun(e.target.value)}
            style={{ padding: 9, minWidth: 380, border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_date} · {r.points?.length || 0} pts · base ${r.last_close} · id {String(r.run_id).slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        !loading && <p style={{ fontSize: 13, color: "#999" }}>
          Aún no hay predicciones congeladas para {ticker}. Pulsa <b>💾 Guardar predicción</b> para congelar la de hoy.
        </p>
      )}

      {/* Gráfica: precio real (siempre) + predicciones congeladas */}
      {series.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={430}>
            <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
              <Tooltip /><Legend />
              {/* Línea vertical: fecha en que se congeló la predicción */}
              {runDate && <ReferenceLine x={runDate} stroke="#bbb" strokeDasharray="3 3"
                label={{ value: "congelado", position: "top", fontSize: 9, fill: "#aaa" }} />}
              {/* Banda Monte Carlo del snapshot */}
              {run && <Area dataKey="bandBase" stackId="mc" stroke="none" fill="transparent" legendType="none" />}
              {run && <Area dataKey="band" stackId="mc" stroke="none" fill="#3498db" fillOpacity={0.10} name="Banda P5–P95" />}
              {/* Curvas congeladas (solo si hay snapshot) */}
              {run && MODELS.map((m) => (
                <Line key={m.key} dataKey={m.key} stroke={m.color} dot={false} strokeWidth={1.6}
                      strokeDasharray="4 3" name={m.label} connectNulls />
              ))}
              {/* Precio REAL siempre visible, encima */}
              <Line dataKey="actual" stroke="#111" dot={false} strokeWidth={2.6} name="Precio REAL (vivo)" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Métricas al vuelo */}
          {run && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                Acierto por modelo — predicho (congelado {runDate}) vs. real{" "}
                {evalCount === 0
                  ? <span style={{ color: "#b8860b", fontWeight: 400 }}>— el precio real aún no alcanza las fechas predichas</span>
                  : <span style={{ color: "#888", fontWeight: 400 }}>({evalCount} días ya ocurridos)</span>}
              </div>
              {evalCount > 0 && (
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
                      {metrics!.rows
                        .slice()
                        .sort((a: any, b: any) => (a.mape ?? 9) - (b.mape ?? 9))
                        .map((m: any) => (
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
              )}
              {metrics!.coverage != null && evalCount > 0 && (
                <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                  Cobertura banda Monte Carlo P5–P95: <b>{(metrics!.coverage * 100).toFixed(0)}%</b> de los precios reales
                  cayeron dentro del rango previsto (ideal ≈ 90%).
                </p>
              )}
            </div>
          )}

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
            ⓘ El <b>precio real</b> (línea negra) es en vivo y siempre visible. La predicción está
            <b> congelada</b>: no cambia aunque recalcules. La validación crece sola día a día conforme
            el real alcanza las fechas predichas. Menor MAPE = modelo más preciso. No es recomendación de inversión.
          </p>
        </>
      )}
    </div>
  );
}
