"use client";

/**
 * ModelValidationTab.tsx — 📌 Validación de modelos (con AnalysisChart potente)
 * ============================================================================
 * Misma lógica de datos (precio real de Supabase, snapshots, cálculo en vivo,
 * métricas) pero la GRÁFICA usa <AnalysisChart>: zoom dinámico + dibujo.
 * • Curva XGBoost Extendido (AH+PM) para comparar acierto vs. el original.
 * • DESEMPEÑO AUTOMÁTICO: al elegir un ticker se calcula solo (sin botón).
 *   El botón «↻ Recalcular» queda como refresco manual opcional.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import AnalysisChart from "./AnalysisChart";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

const MODELS = [
  { key: "predicted", label: "XGBoost", color: "#e67e22" },
  { key: "ext", label: "XGBoost Extendido (AH+PM)", color: "#0a84ff" },
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
  const [viewSel, setViewSel] = useState<string>("");
  const [livePoints, setLivePoints] = useState<any[]>([]);
  const [liveReal, setLiveReal] = useState<{ date: string; close: number }[]>([]);
  const [realHist, setRealHist] = useState<{ date: string; close: number }[]>([]);
  const [realLastDate, setRealLastDate] = useState<string>("");

  const [loadingHist, setLoadingHist] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Evita cálculos en vivo solapados al cambiar de ticker rápido.
  const runToken = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`); const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail); setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos (/models)."); }
    })();
  }, []);

  // Precio real desde la caché de Supabase (para la línea negra)
  useEffect(() => {
    if (!ticker) { setRealHist([]); setRealLastDate(""); return; }
    (async () => {
      try {
        const r = await fetch(`${API_URL}/price-cache?ticker=${ticker}&years=1`);
        if (!r.ok) { setRealHist([]); setRealLastDate(""); return; }
        const j = await r.json();
        setRealHist(j.history || []); setRealLastDate(j.last_date || "");
      } catch { setRealHist([]); setRealLastDate(""); }
    })();
  }, [ticker]);

  // DESEMPEÑO AUTOMÁTICO: al elegir ticker → carga snapshots + calcula en vivo (sin botón)
  useEffect(() => {
    if (!ticker) return;
    const token = ++runToken.current;
    (async () => {
      await loadHistory(ticker, token);
      await calcLive(ticker, token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function loadHistory(tk: string, token?: number) {
    setLoadingHist(true); setError(null); setMsg(null);
    setLivePoints([]); setLiveReal([]);
    try {
      const res = await fetch(`${API_URL}/forecast-history?ticker=${tk}&limit_runs=30`);
      if (res.status === 503) throw new Error("Supabase no está configurado en el servidor.");
      if (!res.ok) throw new Error((await res.json()).detail || "Error al leer snapshots");
      const rs = (await res.json()).runs || [];
      if (token != null && token !== runToken.current) return;   // ticker cambió: descarta
      setRuns(rs); setViewSel(rs.length ? rs[0].run_id : "");
    } catch (e: any) { setError(e.message); setRuns([]); setViewSel(""); }
    finally { setLoadingHist(false); }
  }

  async function calcLive(tk: string, token?: number) {
    setLoadingLive(true); setError(null); setMsg(null);
    try {
      const [fRes, mRes, sRes, pRes, eRes] = await Promise.all([
        fetch(`${API_URL}/forecast`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: tk, horizon, n_sims: 10000, save: false }) }),
        fetch(`${API_URL}/predict-mlp?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/forecast-sentiment?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/psychology?ticker=${tk}&horizon=${horizon}`),
        fetch(`${API_URL}/predict-extended?ticker=${tk}&horizon=${horizon}`),
      ]);
      if (!fRes.ok) throw new Error((await fRes.json()).detail || "Error en /forecast");
      const fj = await fRes.json(); const pred = fj.prediction; const sim = fj.simulation;
      const lr = (pred.history || []).map((h: any) => ({ date: h.date, close: h.close }));
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
      if (eRes.ok) {
        const ej = await eRes.json();
        (ej.prediction || []).forEach((p: any) => (byDate[p.date] = { ...(byDate[p.date] || { target_date: p.date }), ext: p.close }));
      }
      if (token != null && token !== runToken.current) return;   // ticker cambió: descarta
      setLiveReal(lr);
      setLivePoints(Object.values(byDate).sort((a: any, b: any) => a.target_date.localeCompare(b.target_date)));
      setViewSel("live");
    } catch (e: any) { setError(e.message); setLivePoints([]); }
    finally { setLoadingLive(false); }
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
      setMsg(`✅ Predicción congelada (${j.points} puntos). id ${String(j.run_id).slice(0, 8)}…`);
      const hRes = await fetch(`${API_URL}/forecast-history?ticker=${ticker}&limit_runs=30`);
      if (hRes.ok) { const rs = (await hRes.json()).runs || []; setRuns(rs); setViewSel(j.run_id); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const isLive = viewSel === "live";
  const activeRun = useMemo(() => runs.find((r) => r.run_id === viewSel) || null, [runs, viewSel]);
  const frozenDate = isLive ? null : activeRun?.run_date;
  const activePoints = isLive ? livePoints : (activeRun?.points || []);

  const realByDate = useMemo(() => {
    const m: Record<string, number> = {};
    realHist.forEach((p) => (m[p.date] = p.close));
    if (isLive) liveReal.forEach((p) => (m[p.date] = p.close));
    else (activeRun?.points || []).forEach((p: any) => { if (p.actual_close != null) m[p.target_date] = p.actual_close; });
    return m;
  }, [realHist, isLive, liveReal, activeRun]);

  // Serie completa para AnalysisChart (con bandBase/band para la banda MC)
  const series = useMemo(() => {
    const byDate: Record<string, any> = {};
    Object.entries(realByDate).forEach(([d, val]) => (byDate[d] = { date: d, actual: val }));
    activePoints.forEach((pt: any) => {
      byDate[pt.target_date] = {
        ...(byDate[pt.target_date] || { date: pt.target_date }),
        predicted: pt.predicted, ext: pt.ext, mlp: pt.mlp, ml_sentiment: pt.ml_sentiment,
        sentiment_only: pt.sentiment_only, psy_a: pt.psy_a, psy_b: pt.psy_b, mc_median: pt.mc_median,
        bandBase: pt.mc_p5, band: (pt.mc_p95 != null && pt.mc_p5 != null) ? pt.mc_p95 - pt.mc_p5 : null,
      };
    });
    return Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [realByDate, activePoints]);

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
  const calculando = loadingLive || loadingHist;

  // Config de líneas para AnalysisChart (8 modelos + precio real)
  const chartLines = [
    ...MODELS.map((m) => ({ key: m.key, color: m.color, label: m.label, width: 1.6, dash: "4 3" })),
    { key: "actual", color: "#111", label: "Precio REAL", width: 2.6 },
  ];
  const chartMarkers = frozenDate ? [{ date: frozenDate, label: "congelado", color: "#bbb" }] : [];

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
          <div style={{ fontSize: 12, color: "#666" }}>Días a proyectar (en vivo)</div>
          <input type="number" value={horizon} min={5} max={252}
            onChange={(e) => setHorizon(Math.max(5, Number(e.target.value)))}
            style={{ padding: 8, width: 150, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={() => ticker && calcLive(ticker)} disabled={loadingLive || !ticker}
          title="Vuelve a calcular el desempeño en vivo (ya se calcula solo al elegir ticker)"
          style={{ padding: "10px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loadingLive ? "Calculando…" : "↻ Recalcular"}
        </button>
        <button onClick={saveSnapshot} disabled={!!busy || !ticker || livePoints.length === 0}
          style={{ padding: "10px 16px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: livePoints.length === 0 ? "not-allowed" : "pointer" }}>
          {busy === "save" ? "Guardando…" : "💾 Guardar esta predicción"}
        </button>
        {calculando && <span style={{ fontSize: 11, color: "#2980b9" }}>⟳ calculando desempeño…</span>}
      </div>

      {/* Selector de snapshot */}
      <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#666" }}>Ver:</span>
        <select value={viewSel} onChange={(e) => setViewSel(e.target.value)} disabled={loadingHist}
          style={{ padding: 8, minWidth: 340, border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
          {runs.length === 0 && <option value="">— solo precio real (sin snapshots) —</option>}
          {livePoints.length > 0 && <option value="live">🟢 En vivo (recién calculado, sin guardar)</option>}
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              📌 {r.run_date} · {r.points?.length || 0} pts · base ${r.last_close} · id {String(r.run_id).slice(0, 8)}
            </option>
          ))}
        </select>
        {loadingHist && <span style={{ fontSize: 12, color: "#888" }}>Cargando snapshots…</span>}
        {realLastDate && <span style={{ fontSize: 12, color: "#888" }}>Precio real hasta <b>{realLastDate}</b></span>}
      </div>

      {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>⚠️ {error}</p>}
      {isLive && <p style={{ fontSize: 12, color: "#8e44ad", margin: "2px 0 6px" }}>🟢 Vista <b>EN VIVO</b> (sin guardar). Pulsa <b>💾</b> para congelarla.</p>}
      {!isLive && activePoints.length > 0 && !activePoints.some((p: any) => p.ext != null) && (
        <p style={{ fontSize: 12, color: "#b8860b", margin: "2px 0 6px" }}>ⓘ Este snapshot se guardó antes de añadir la curva Extendida (solo aparece en los nuevos).</p>
      )}

      {/* Estado vacío / cargando inicial */}
      {series.length === 0 && !error && (
        <div style={{ padding: "56px 20px", textAlign: "center", background: "#f7f9fb",
                      borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d", marginTop: 6 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>{calculando ? "⏳" : "📌"}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>
            {calculando ? "Calculando desempeño de los modelos…" : (ticker ? `Sin datos para ${ticker}` : "Elige un ticker")}
          </div>
          {!calculando && <div style={{ fontSize: 13, marginTop: 4 }}>El desempeño se calcula solo al elegir un ticker.</div>}
        </div>
      )}

      {/* GRÁFICA INTERACTIVA */}
      {series.length > 0 && (
        <>
          <AnalysisChart data={series} lines={chartLines}
            band={{ lowerKey: "bandBase", spanKey: "band", color: "#3498db", label: "Banda P5–P95" }}
            markers={chartMarkers} storageKey={`mv_draw_${ticker}`} height={460} />

          {/* Métricas (desempeño automático) */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Acierto por modelo (predicho vs. real){" "}
              {activePoints.length === 0
                ? <span style={{ color: "#888", fontWeight: 400 }}>— elige un snapshot para comparar</span>
                : evalCount === 0
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
                        <td style={{ textAlign: "right", padding: "7px 10px", fontWeight: 600 }}>{m.mape == null ? "—" : `${(m.mape * 100).toFixed(2)}%`}</td>
                        <td style={{ textAlign: "right", padding: "7px 10px", color: "#888" }}>{m.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {metrics.coverage != null && evalCount > 0 && (
              <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                Cobertura banda Monte Carlo P5–P95: <b>{(metrics.coverage * 100).toFixed(0)}%</b> de los precios reales cayeron dentro del rango previsto (ideal ≈ 90%).
              </p>
            )}
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
            ⓘ El desempeño se calcula automáticamente al elegir un ticker. Gráfica interactiva: rueda para zoom,
            herramientas de dibujo (se guardan por ticker). Menor MAPE = modelo más preciso. No es recomendación de inversión.
          </p>
        </>
      )}
    </div>
  );
}
