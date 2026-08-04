"use client";

/**
 * ModelValidationTab.tsx — 📌 Validación de modelos (WYSIWYG)
 * ==========================================================
 *   • Muestra EN VIVO las 7 curvas de predicción + el precio REAL antes de guardar.
 *   • 💾 Guardar predicción → congela exactamente ese preview.
 *   • Selector para ver snapshots pasados y compararlos contra el real.
 *
 * CAMBIOS UX:
 *   1) El cálculo NO se dispara solo al cambiar el ticker; solo se pobla el
 *      desplegable. Nada se calcula hasta pulsar «↻ Calcular en vivo».
 *   2) Zoom independiente de eje X y eje Y (＋/－ por eje) + ⟲ Reset, que recorta
 *      la ventana visible sin volver a llamar a la API.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

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
  const [livePoints, setLivePoints] = useState<any[]>([]);
  const [liveBase, setLiveBase] = useState<number | null>(null);

  const [runs, setRuns] = useState<any[]>([]);
  const [viewSel, setViewSel] = useState<string>("live");
  const [calculated, setCalculated] = useState(false);   // ¿ya se calculó?

  // Zoom independiente por eje (1 = ver todo). <1 recorta.
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // SOLO poblar el desplegable de tickers (NO calcula nada).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`); const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail); setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos (/models)."); }
    })();
  }, []);

  async function loadAll(tk: string) {
    setLoading(true); setError(null); setViewSel("live"); setZoomX(1); setZoomY(1);
    try {
      const [fRes, mRes, sRes, pRes, hRes] = await Promise.all([
        fetch(`${API_URL}/forecast`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: tk, horizon, n_sims: 10000, save: false }) }),
        fetch(`${API_URL}/predict-mlp?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/forecast-sentiment?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/psychology?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/forecast-history?ticker=${tk}&limit_runs=20`),
      ]);

      if (!fRes.ok) throw new Error((await fRes.json()).detail || "Error en /forecast");
      const fj = await fRes.json();
      const pred = fj.prediction; const sim = fj.simulation;

      const hist = (pred.history || []).map((h: any) => ({ date: h.date, close: h.close }));
      setRealHist(hist);
      setRealLastDate(hist.length ? hist[hist.length - 1].date : "");
      setLiveBase(pred.last_close);

      const byDate: Record<string, any> = {};
      pred.prediction.forEach((p: any, i: number) => {
        byDate[p.date] = { target_date: p.date, predicted: p.close,
          mc_median: sim.median[i], mc_p5: sim.p5[i], mc_p95: sim.p95[i] };
      });
      if (mRes.ok) { const mj = await mRes.json(); mj.prediction.forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), mlp: p.close })); }
      if (sRes.ok) {
        const sj = await sRes.json();
        (sj.ml_plus_sentiment || []).forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), ml_sentiment: p.close }));
        (sj.sentiment_only || []).forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), sentiment_only: p.close }));
      }
      if (pRes.ok) {
        const pj = await pRes.json();
        ((pj.contrarian || {}).curve || []).forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), psy_a: p.close }));
        ((pj.learned || {})?.curve || []).forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), psy_b: p.close }));
      }
      setLivePoints(Object.values(byDate).sort((a: any, b: any) => a.target_date.localeCompare(b.target_date)));

      if (hRes.status === 503) throw new Error("Supabase no está configurado en el servidor.");
      setRuns(hRes.ok ? ((await hRes.json()).runs || []) : []);
      setCalculated(true);
    } catch (e: any) { setError(e.message); setLivePoints([]); }
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
      const hRes = await fetch(`${API_URL}/forecast-history?ticker=${ticker}&limit_runs=20`);
      if (hRes.ok) { const runs2 = (await hRes.json()).runs || []; setRuns(runs2); setViewSel(j.run_id); setZoomX(1); setZoomY(1); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const realByDate = useMemo(() => {
    const m: Record<string, number> = {};
    realHist.forEach((p) => (m[p.date] = p.close));
    return m;
  }, [realHist]);

  const activePoints = useMemo(() => {
    if (viewSel === "live") return livePoints;
    const run = runs.find((r) => r.run_id === viewSel);
    return run ? (run.points || []) : [];
  }, [viewSel, livePoints, runs]);

  const activeRun = useMemo(() => runs.find((r) => r.run_id === viewSel) || null, [runs, viewSel]);
  const frozenDate = viewSel === "live" ? null : activeRun?.run_date;

  // Serie completa (todas las fechas)
  const fullSeries = useMemo(() => {
    const byDate: Record<string, any> = {};
    realHist.forEach((p) => (byDate[p.date] = { date: p.date, actual: p.close }));
    activePoints.forEach((pt: any) => {
      byDate[pt.target_date] = {
        ...(byDate[pt.target_date] || { date: pt.target_date }),
        predicted: pt.predicted, mlp: pt.mlp, ml_sentiment: pt.ml_sentiment,
        sentiment_only: pt.sentiment_only, psy_a: pt.psy_a, psy_b: pt.psy_b, mc_median: pt.mc_median,
        bandBase: pt.mc_p5, band: (pt.mc_p95 != null && pt.mc_p5 != null) ? pt.mc_p95 - pt.mc_p5 : null,
      };
    });
    return Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [realHist, activePoints]);

  // Zoom X: recorta a la fracción final de puntos (más recientes/futuros)
  const series = useMemo(() => {
    if (zoomX >= 1 || fullSeries.length === 0) return fullSeries;
    const keep = Math.max(5, Math.round(fullSeries.length * zoomX));
    return fullSeries.slice(fullSeries.length - keep);
  }, [fullSeries, zoomX]);

  // Zoom Y: dominio recortado alrededor del punto medio del rango visible
  const yDomain = useMemo<[any, any]>(() => {
    if (zoomY >= 1) return ["auto", "auto"];
    const vals: number[] = [];
    series.forEach((r: any) => {
      ["actual", "predicted", "mlp", "ml_sentiment", "sentiment_only", "psy_a", "psy_b", "mc_median"].forEach((k) => {
        if (r[k] != null) vals.push(r[k]);
      });
    });
    if (vals.length < 2) return ["auto", "auto"];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const mid = (lo + hi) / 2, half = ((hi - lo) / 2) * zoomY;
    return [+(mid - half).toFixed(2), +(mid + half).toFixed(2)];
  }, [series, zoomY]);

  const metrics = useMemo(() => {
    const pts = activePoints.filter((p: any) => realByDate[p.target_date] != null);
    const rows = MODELS.map((m) => {
      const valid = pts.filter((p: any) => p[m.key] != null);
      if (!valid.length) return { ...m, mape: null, n: 0 };
      const mape = valid.reduce((s: number, p: any) => s + Math.abs(p[m.key] - realByDate[p.target_date]) / realByDate[p.target_date], 0) / valid.length;
      return { ...m, mape, n: valid.length };
    });
    const cov = pts.length
      ? pts.filter((p: any) => { const r = realByDate[p.target_date]; return p.mc_p5 != null && r >= p.mc_p5 && r <= p.mc_p95; }).length / pts.length
      : null;
    return { rows, evalN: pts.length, coverage: cov };
  }, [activePoints, realByDate]);

  const evalCount = metrics.evalN;
  const isLive = viewSel === "live";

  const zXin = () => setZoomX((z) => Math.max(0.1, +(z * 0.7).toFixed(3)));
  const zXout = () => setZoomX((z) => Math.min(1, +(z / 0.7).toFixed(3)));
  const zYin = () => setZoomY((z) => Math.max(0.1, +(z * 0.7).toFixed(3)));
  const zYout = () => setZoomY((z) => Math.min(1, +(z / 0.7).toFixed(3)));
  const zReset = () => { setZoomX(1); setZoomY(1); };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      {/* Controles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "end", flexWrap: "wrap" }}>
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
          <input type="number" value={horizon} min={5} max={252}
            onChange={(e) => setHorizon(Math.max(5, Number(e.target.value)))}
            style={{ padding: 8, width: 130, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={() => ticker && loadAll(ticker)} disabled={loading || !ticker}
          style={{ padding: "10px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Calculando…" : "↻ Calcular en vivo"}
        </button>
        <button onClick={saveSnapshot} disabled={!!busy || !ticker || livePoints.length === 0}
          style={{ padding: "10px 16px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          title="Congela exactamente lo que ves en la vista 'En vivo'">
          {busy === "save" ? "Guardando…" : "💾 Guardar esta predicción"}
        </button>
      </div>

      {/* Estado vacío */}
      {!calculated && !loading && !error && (
        <div style={{ padding: "60px 20px", textAlign: "center", background: "#f7f9fb",
                      borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d", marginTop: 4 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📌</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>Elige un ticker y pulsa «↻ Calcular en vivo»</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Verás las 7 curvas y el precio real; luego podrás guardar la predicción.</div>
        </div>
      )}

      {calculated && (
        <>
          {/* Selector de vista + Zoom X/Y */}
          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#666" }}>Ver:</span>
            <select value={viewSel} onChange={(e) => { setViewSel(e.target.value); setZoomX(1); setZoomY(1); }}
              style={{ padding: 8, minWidth: 300, border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
              <option value="live">🟢 En vivo (sin guardar) — lo que se guardaría</option>
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  📌 {r.run_date} · {r.points?.length || 0} pts · base ${r.last_close} · id {String(r.run_id).slice(0, 8)}
                </option>
              ))}
            </select>

            {/* Zoom independiente por eje */}
            {series.length > 0 && (
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                <span style={{ fontSize: 12, color: "#666" }}>Zoom X:</span>
                <ZoomBtn onClick={zXin} disabled={zoomX <= 0.1}>＋</ZoomBtn>
                <ZoomBtn onClick={zXout} disabled={zoomX >= 1}>－</ZoomBtn>
                <span style={{ fontSize: 12, color: "#666", marginLeft: 4 }}>Zoom Y:</span>
                <ZoomBtn onClick={zYin} disabled={zoomY <= 0.1}>＋</ZoomBtn>
                <ZoomBtn onClick={zYout} disabled={zoomY >= 1}>－</ZoomBtn>
                <ZoomBtn onClick={zReset} disabled={zoomX >= 1 && zoomY >= 1}>⟲</ZoomBtn>
              </div>
            )}
          </div>

          {realLastDate && <span style={{ fontSize: 12, color: "#888" }}>Precio real hasta <b>{realLastDate}</b></span>}
          {(zoomX < 1 || zoomY < 1) && (
            <p style={{ fontSize: 11, color: "#2980b9", margin: "4px 0 0" }}>
              🔍 Zoom X {Math.round(zoomX * 100)}% · Zoom Y {Math.round(zoomY * 100)}% · ⟲ para ver todo
            </p>
          )}

          {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
          {error && <p style={{ color: "#c0392b", fontSize: 13 }}>⚠️ {error}</p>}

          {isLive && livePoints.length > 0 && (
            <p style={{ fontSize: 12, color: "#8e44ad", margin: "6px 0" }}>
              🟢 Vista <b>EN VIVO</b>: estás viendo las 7 curvas recién calculadas. Pulsa <b>💾</b> para congelar exactamente esto.
            </p>
          )}

          {/* Gráfica */}
          {series.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={430}>
                <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                  <YAxis domain={yDomain} allowDataOverflow tick={{ fontSize: 11 }} width={60} />
                  <Tooltip /><Legend />
                  {frozenDate && <ReferenceLine x={frozenDate} stroke="#bbb" strokeDasharray="3 3"
                    label={{ value: "congelado", position: "top", fontSize: 9, fill: "#aaa" }} />}
                  <Area dataKey="bandBase" stackId="mc" stroke="none" fill="transparent" legendType="none" />
                  <Area dataKey="band" stackId="mc" stroke="none" fill="#3498db" fillOpacity={0.10} name="Banda P5–P95" />
                  {MODELS.map((m) => (
                    <Line key={m.key} dataKey={m.key} stroke={m.color} dot={false} strokeWidth={1.6}
                          strokeDasharray="4 3" name={m.label} connectNulls />
                  ))}
                  <Line dataKey="actual" stroke="#111" dot={false} strokeWidth={2.6} name="Precio REAL" connectNulls />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Métricas */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Acierto por modelo (predicho vs. real){" "}
                  {evalCount === 0
                    ? <span style={{ color: "#b8860b", fontWeight: 400 }}>
                        — {isLive ? "vista en vivo: las fechas predichas son futuras, aún sin real que comparar" : "el precio real aún no alcanza las fechas predichas"}
                      </span>
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
                        {metrics.rows.slice().sort((a: any, b: any) => (a.mape ?? 9) - (b.mape ?? 9)).map((m: any) => (
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
                {metrics.coverage != null && evalCount > 0 && (
                  <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                    Cobertura banda Monte Carlo P5–P95: <b>{(metrics.coverage * 100).toFixed(0)}%</b> de los precios reales
                    cayeron dentro del rango previsto (ideal ≈ 90%).
                  </p>
                )}
              </div>

              <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
                ⓘ El <b>precio real</b> (línea negra) siempre visible. En la vista <b>En vivo</b> ves lo que
                guardarías; al guardar, queda <b>congelado</b> y la validación crece sola día a día. Menor MAPE =
                modelo más preciso. No es recomendación de inversión.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ZoomBtn({ children, onClick, disabled }: { children: any; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 32, height: 32, border: "1px solid #ddd", borderRadius: 6, cursor: disabled ? "default" : "pointer",
               background: disabled ? "#f5f5f5" : "#fff", color: disabled ? "#bbb" : "#333", fontSize: 15 }}>{children}</button>
  );
}
