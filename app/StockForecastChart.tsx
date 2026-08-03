"use client";

/**
 * StockForecastChart.tsx — Predicción + Validación + Simulador de inversión
 * =========================================================================
 * • Curvas: Histórico · XGBoost · MLP · XGBoost+Sentimiento · Sentimiento puro ·
 *   Psicología contrarian (A) · Psicología ML (B) · Mediana Monte Carlo + bandas
 * • Noticias de Polygon desplegadas abajo
 * • Zoom In/Out/Reset
 * • Vista Validación (predicho vs real)
 * • 🆕 SIMULADOR DE INVERSIÓN:
 *     - Dos modos: por CANTIDAD (acciones) o por MONTO ($)
 *     - Precio de entrada editable
 *     - Días de evaluación (acotados al horizonte)
 *     - Compara TODAS las curvas en una tabla (P&L por modelo)
 *     - Rango de riesgo Monte Carlo P5–P95 (mejor/peor caso)
 *     - Trayectoria del valor de la inversión superpuesta en la gráfica
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
type View = "proyeccion" | "validacion";
type BuyMode = "cantidad" | "monto";

const SENT_COLOR: Record<string, string> = { positive: "#1e824c", negative: "#c0392b", neutral: "#95a5a6" };

// Definición de las curvas simulables (clave en 'rows' -> etiqueta + color)
const CURVES = [
  { key: "xgb", label: "XGBoost", color: "#e67e22" },
  { key: "mlp", label: "Red Neuronal (MLP)", color: "#16a085" },
  { key: "mlSent", label: "XGBoost + Sentimiento", color: "#8e44ad" },
  { key: "sentOnly", label: "Sentimiento puro", color: "#d35400" },
  { key: "psyA", label: "Psicología contrarian (A)", color: "#9b59b6" },
  { key: "psyB", label: "Psicología ML (B)", color: "#2ecc71" },
  { key: "median", label: "Mediana Monte Carlo", color: "#3498db" },
];

export default function StockForecastChart() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [days, setDays] = useState<number>(21);
  const [view, setView] = useState<View>("proyeccion");

  const [fwd, setFwd] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [sentiment, setSentiment] = useState<any>(null);
  const [news, setNews] = useState<any[]>([]);
  const [riskNote, setRiskNote] = useState<string>("");
  const [hasMlp, setHasMlp] = useState(false);
  const [mlpWarning, setMlpWarning] = useState<string | null>(null);
  const [val, setVal] = useState<any[]>([]);
  const [valMetrics, setValMetrics] = useState<any>(null);

  // Bandas Monte Carlo crudas (para el rango de riesgo del simulador)
  const [mc, setMc] = useState<{ p5: number[]; p95: number[]; median: number[] } | null>(null);

  // Estado del SIMULADOR
  const [buyMode, setBuyMode] = useState<BuyMode>("monto");
  const [qty, setQty] = useState<number>(100);
  const [amount, setAmount] = useState<number>(10000);
  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [evalDay, setEvalDay] = useState<number>(21);
  const [showInvestment, setShowInvestment] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`); const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail); setTicker(avail.includes("TSM") ? "TSM" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos (/models)."); }
    })();
  }, []);

  useEffect(() => { if (ticker) run(ticker, days); /* eslint-disable-next-line */ }, [ticker]);

  async function run(tk: string, h: number) {
    setLoading(true); setError(null); setZoom(1);
    try {
      const [fRes, mRes, sRes, vRes, pRes] = await Promise.all([
        fetch(`${API_URL}/forecast`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: tk, horizon: h, n_sims: 10000 }) }),
        fetch(`${API_URL}/predict-mlp?ticker=${tk}&horizon=${h}`),
        fetch(`${API_URL}/forecast-sentiment?ticker=${tk}&horizon=${h}`),
        fetch(`${API_URL}/validate?ticker=${tk}&days=${Math.max(30, h * 2)}`),
        fetch(`${API_URL}/psychology?ticker=${tk}&horizon=${h}`),
      ]);
      if (!fRes.ok) throw new Error((await fRes.json()).detail || "Error en /forecast");
      const fj = await fRes.json();

      const rows: Record<string, any> = {};
      fj.prediction.history.forEach((hh: any) => (rows[hh.date] = { date: hh.date, historical: hh.close }));
      const sim = fj.simulation;
      fj.prediction.prediction.forEach((p: any, i: number) => {
        rows[p.date] = { ...(rows[p.date] || { date: p.date }), xgb: p.close, median: sim.median[i],
          band95Base: sim.p5[i], band95: sim.p95[i] - sim.p5[i] };
      });
      setMc({ p5: sim.p5, p95: sim.p95, median: sim.median });

      if (mRes.ok) {
        const mj = await mRes.json(); const rel = mj.reliability;
        mj.prediction.forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), mlp: p.close }));
        setHasMlp(true);
        setMlpWarning(rel && rel.reliable === false ? `modelo poco confiable — ${rel.warning || ""}`
          : rel && rel.weak ? `capacidad predictiva débil (${rel.warning || ""})` : null);
      } else { setHasMlp(false); setMlpWarning(null); }
      if (sRes.ok) {
        const sj = await sRes.json();
        (sj.ml_plus_sentiment || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), mlSent: p.close }));
        (sj.sentiment_only || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), sentOnly: p.close }));
        setSentiment(sj.sentiment || null); setRiskNote(sj.risk_note || ""); setNews(sj.news || []);
      } else { setSentiment(null); setRiskNote(""); setNews([]); }
      if (pRes.ok) {
        const pj = await pRes.json();
        (pj.contrarian?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), psyA: p.close }));
        (pj.learned?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), psyB: p.close }));
      }
      const merged = Object.values(rows).sort((a: any, b: any) => a.date.localeCompare(b.date));
      setFwd(merged);
      setSummary({ ...sim.terminal });

      // Inicializa el simulador: precio de entrada = último cierre, evalDay = horizonte
      const lc = fj.prediction.last_close;
      setEntryPrice(Number(lc.toFixed(2)));
      setEvalDay(h);

      if (vRes.ok) { const vj = await vRes.json(); setVal(vj.series || []); setValMetrics(vj.metrics || null); }
      else { setVal([]); setValMetrics(null); }
    } catch (e: any) { setError(e.message); setFwd([]); setSummary(null); }
    finally { setLoading(false); }
  }

  const fwdZoom = useMemo(() => {
    if (zoom >= 1 || fwd.length === 0) return fwd;
    const keep = Math.max(5, Math.round(fwd.length * zoom));
    return fwd.slice(fwd.length - keep);
  }, [fwd, zoom]);

  // Solo las filas de predicción (futuro) — las que tienen 'xgb'
  const predRows = useMemo(() => fwd.filter((r) => r.xgb != null || r.median != null), [fwd]);
  const maxEvalDay = predRows.length;

  // Acciones efectivas según modo
  const shares = useMemo(() => {
    if (buyMode === "cantidad") return qty;
    return entryPrice > 0 ? amount / entryPrice : 0;
  }, [buyMode, qty, amount, entryPrice]);
  const cost = shares * entryPrice;

  // Cálculo de P&L por curva al día 'evalDay'
  const simResults = useMemo(() => {
    if (!predRows.length || shares <= 0) return [];
    const idx = Math.min(Math.max(1, evalDay), predRows.length) - 1;
    return CURVES.map((c) => {
      const price = predRows[idx]?.[c.key];
      if (price == null) return { ...c, price: null, value: null, pnl: null, pnlPct: null };
      const value = shares * price;
      const pnl = value - cost;
      return { ...c, price, value, pnl, pnlPct: cost > 0 ? pnl / cost : 0 };
    });
  }, [predRows, evalDay, shares, cost]);

  // Rango de riesgo Monte Carlo P5–P95 al día evalDay
  const riskRange = useMemo(() => {
    if (!mc || !predRows.length) return null;
    const idx = Math.min(Math.max(1, evalDay), mc.p5.length) - 1;
    const p5 = mc.p5[idx], p95 = mc.p95[idx], med = mc.median[idx];
    if (p5 == null) return null;
    return {
      worst: shares * p5, best: shares * p95, expected: shares * med,
      worstPnl: shares * p5 - cost, bestPnl: shares * p95 - cost, expectedPnl: shares * med - cost,
      p5, p95, med,
    };
  }, [mc, predRows, evalDay, shares, cost]);

  // Trayectoria del valor de la inversión (curva mediana MC) para superponer
  const investmentPath = useMemo(() => {
    if (!showInvestment || !predRows.length || shares <= 0) return [];
    return predRows.map((r) => ({ date: r.date, invValue: r.median != null ? shares * r.median : null }));
  }, [showInvestment, predRows, shares]);

  // Mezcla la trayectoria de inversión en los datos de la gráfica (eje secundario)
  const chartData = useMemo(() => {
    if (!showInvestment) return fwdZoom;
    const invByDate: Record<string, number> = {};
    investmentPath.forEach((p) => { if (p.invValue != null) invByDate[p.date] = p.invValue; });
    return fwdZoom.map((r) => ({ ...r, invValue: invByDate[r.date] ?? null }));
  }, [fwdZoom, showInvestment, investmentPath]);

  const divergence = riskNote.includes("Divergencia");
  const zoomIn = () => setZoom((z) => Math.max(0.1, +(z * 0.7).toFixed(3)));
  const zoomOut = () => setZoom((z) => Math.min(1, +(z / 0.7).toFixed(3)));
  const zoomReset = () => setZoom(1);
  const fmt = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const money = (n: number | null | undefined) => n == null ? "—" : `$${fmt(n)}`;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
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
          style={{ padding: "10px 18px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Calculando…" : "↻ Calcular"}
        </button>
        {view === "proyeccion" && (
          <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#666" }}>Zoom:</span>
            <ZoomBtn onClick={zoomIn} disabled={zoom <= 0.1}>＋</ZoomBtn>
            <ZoomBtn onClick={zoomOut} disabled={zoom >= 1}>－</ZoomBtn>
            <ZoomBtn onClick={zoomReset} disabled={zoom >= 1}>⟲</ZoomBtn>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          {(["proyeccion", "validacion"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "9px 14px", border: "none", cursor: "pointer", fontSize: 13,
                       background: view === v ? "#111" : "#fff", color: view === v ? "#fff" : "#555", fontWeight: view === v ? 700 : 400 }}>
              {v === "proyeccion" ? "Proyección" : "Validación (acierto)"}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {view === "proyeccion" && (
        <>
          {riskNote && (
            <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 13,
              background: divergence ? "#fbeeee" : "#eafaf1", borderLeft: `4px solid ${divergence ? "#c0392b" : "#1e824c"}` }}>
              <strong>Gestión de riesgo:</strong> {riskNote}
              {sentiment && <span style={{ color: "#666" }}>{"  "}· Sentimiento {sentiment.score} (▲{sentiment.pos} ▼{sentiment.neg} ●{sentiment.neu})</span>}
            </div>
          )}
          {fwd.length > 0 && (
            <>
              {zoom < 1 && <p style={{ fontSize: 11, color: "#2980b9", margin: "0 0 6px" }}>🔍 Mostrando el {Math.round(zoom * 100)}% más reciente · ⟲ para ver todo</p>}
              <ResponsiveContainer width="100%" height={430}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                  <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
                  {showInvestment && <YAxis yAxisId="inv" orientation="right" domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={70}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />}
                  <Tooltip /><Legend />
                  <Area yAxisId="price" dataKey="band95Base" stackId="b" stroke="none" fill="transparent" legendType="none" />
                  <Area yAxisId="price" dataKey="band95" stackId="b" stroke="none" fill="#3498db" fillOpacity={0.10} name="Escenario P5–P95" />
                  <Line yAxisId="price" dataKey="historical" stroke="#111" dot={false} strokeWidth={2} name="Histórico" connectNulls />
                  <Line yAxisId="price" dataKey="xgb" stroke="#e67e22" dot={false} strokeWidth={2} strokeDasharray="5 4" name="XGBoost" connectNulls />
                  <Line yAxisId="price" dataKey="mlp" stroke="#16a085" dot={false} strokeWidth={2} name="Red Neuronal (MLP)" connectNulls />
                  <Line yAxisId="price" dataKey="mlSent" stroke="#8e44ad" dot={false} strokeWidth={2} name="XGBoost + Sentimiento" connectNulls />
                  <Line yAxisId="price" dataKey="sentOnly" stroke="#d35400" dot={false} strokeWidth={1.6} strokeDasharray="1 3" name="Sentimiento puro" connectNulls />
                  <Line yAxisId="price" dataKey="psyA" stroke="#9b59b6" dot={false} strokeWidth={1.6} strokeDasharray="3 2" name="Psicología contrarian (A)" connectNulls />
                  <Line yAxisId="price" dataKey="psyB" stroke="#2ecc71" dot={false} strokeWidth={1.6} strokeDasharray="1 3" name="Psicología ML (B)" connectNulls />
                  <Line yAxisId="price" dataKey="median" stroke="#3498db" dot={false} strokeWidth={1.2} strokeDasharray="2 3" name="Mediana Monte Carlo" connectNulls />
                  {showInvestment && <Line yAxisId="inv" dataKey="invValue" stroke="#111" dot={false} strokeWidth={2.4} name="💰 Valor inversión ($)" connectNulls />}
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
              {!hasMlp && <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>ⓘ {ticker} no tiene modelo MLP entrenado (curva verde oculta).</p>}
              {hasMlp && mlpWarning && <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>⚠️ Curva MLP de {ticker}: {mlpWarning}</p>}

              {/* ================= SIMULADOR DE INVERSIÓN ================= */}
              <div style={{ marginTop: 22, padding: 16, background: "#f7f9fb", borderRadius: 10, border: "1px solid #e5eaf0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>💰 Simulador de inversión</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
                    <input type="checkbox" checked={showInvestment} onChange={(e) => setShowInvestment(e.target.checked)} />
                    Superponer valor de la inversión en la gráfica
                  </label>
                </div>

                {/* Controles */}
                <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>Modo de compra</div>
                    <div style={{ display: "inline-flex", border: "1px solid #ddd", borderRadius: 6, overflow: "hidden" }}>
                      {(["cantidad", "monto"] as BuyMode[]).map((m) => (
                        <button key={m} onClick={() => setBuyMode(m)}
                          style={{ padding: "8px 12px", border: "none", cursor: "pointer", fontSize: 13,
                            background: buyMode === m ? "#2c3e50" : "#fff", color: buyMode === m ? "#fff" : "#555", fontWeight: buyMode === m ? 700 : 400 }}>
                          {m === "cantidad" ? "Por cantidad" : "Por monto"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {buyMode === "cantidad" ? (
                    <label>
                      <div style={{ fontSize: 12, color: "#666" }}>Acciones</div>
                      <input type="number" value={qty} min={0} step={1}
                        onChange={(e) => setQty(Math.max(0, Number(e.target.value)))}
                        style={{ padding: 8, width: 110, border: "1px solid #ddd", borderRadius: 6 }} />
                    </label>
                  ) : (
                    <label>
                      <div style={{ fontSize: 12, color: "#666" }}>Monto a invertir ($)</div>
                      <input type="number" value={amount} min={0} step={100}
                        onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                        style={{ padding: 8, width: 130, border: "1px solid #ddd", borderRadius: 6 }} />
                    </label>
                  )}

                  <label>
                    <div style={{ fontSize: 12, color: "#666" }}>Precio de entrada ($)</div>
                    <input type="number" value={entryPrice} min={0} step={0.01}
                      onChange={(e) => setEntryPrice(Math.max(0, Number(e.target.value)))}
                      style={{ padding: 8, width: 120, border: "1px solid #ddd", borderRadius: 6 }} />
                  </label>

                  <label>
                    <div style={{ fontSize: 12, color: "#666" }}>Evaluar a los (días)</div>
                    <input type="number" value={evalDay} min={1} max={maxEvalDay || 1}
                      onChange={(e) => setEvalDay(Math.min(maxEvalDay || 1, Math.max(1, Number(e.target.value))))}
                      style={{ padding: 8, width: 120, border: "1px solid #ddd", borderRadius: 6 }} />
                    <div style={{ fontSize: 10, color: "#aaa" }}>máx {maxEvalDay} (horizonte)</div>
                  </label>
                </div>

                {/* Resumen de la posición */}
                <div style={{ marginTop: 12, fontSize: 13, color: "#444" }}>
                  Posición: <b>{fmt(shares)}</b> acciones × <b>${fmt(entryPrice)}</b> ={" "}
                  <b>{money(cost)}</b> invertidos · evaluado al día <b>{evalDay}</b>
                  {predRows[Math.min(evalDay, predRows.length) - 1] && (
                    <span style={{ color: "#888" }}> ({predRows[Math.min(evalDay, predRows.length) - 1].date})</span>
                  )}
                </div>

                {/* Tabla comparativa de curvas */}
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#eef2f6" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Curva</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>Precio día {evalDay}</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>Valor inversión</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>Ganancia/Pérdida</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simResults.map((r) => (
                        <tr key={r.key} style={{ borderBottom: "1px solid #eef2f6" }}>
                          <td style={{ padding: "7px 10px" }}>
                            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: r.color, marginRight: 6 }} />
                            {r.label}
                          </td>
                          <td style={{ textAlign: "right", padding: "7px 10px" }}>{money(r.price)}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px" }}>{money(r.value)}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px", fontWeight: 600, color: r.pnl == null ? "#999" : r.pnl >= 0 ? "#1e824c" : "#c0392b" }}>
                            {r.pnl == null ? "—" : `${r.pnl >= 0 ? "+$" : "-$"}${fmt(Math.abs(r.pnl))}`}
                          </td>
                          <td style={{ textAlign: "right", padding: "7px 10px", fontWeight: 600, color: r.pnlPct == null ? "#999" : r.pnlPct >= 0 ? "#1e824c" : "#c0392b" }}>
                            {r.pnlPct == null ? "—" : `${r.pnlPct >= 0 ? "+" : ""}${(r.pnlPct * 100).toFixed(2)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Rango de riesgo Monte Carlo */}
                {riskRange && (
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    <RiskCard label="⬇ Peor caso (P5)" value={money(riskRange.worst)}
                      pnl={riskRange.worstPnl} sub={`precio $${riskRange.p5}`} color="#c0392b" />
                    <RiskCard label="◎ Escenario esperado (mediana)" value={money(riskRange.expected)}
                      pnl={riskRange.expectedPnl} sub={`precio $${riskRange.med}`} color="#2980b9" />
                    <RiskCard label="⬆ Mejor caso (P95)" value={money(riskRange.best)}
                      pnl={riskRange.bestPnl} sub={`precio $${riskRange.p95}`} color="#1e824c" />
                  </div>
                )}

                <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
                  ⓘ Simulación educativa sobre las curvas del modelo. El rango P5–P95 (Monte Carlo) indica la
                  banda probable de resultados. No es recomendación de inversión.
                </p>
              </div>

              {/* ================= NOTICIAS ================= */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  📰 Noticias de {ticker} {news.length > 0 && <span style={{ color: "#888", fontWeight: 400 }}>({news.length})</span>}
                </div>
                {news.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#999" }}>Sin noticias recientes en Polygon para este ticker.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {news.map((n: any, k: number) => (
                      <div key={k} style={{ padding: "8px 10px", borderRadius: 6, background: "#f7f7f8",
                        borderLeft: `3px solid ${SENT_COLOR[n.sentiment] || "#95a5a6"}` }}>
                        <div style={{ fontSize: 13 }}>
                          <span style={{ color: SENT_COLOR[n.sentiment], fontWeight: 700 }}>
                            {n.sentiment === "positive" ? "▲" : n.sentiment === "negative" ? "▼" : "●"}{" "}
                          </span>
                          {n.url ? <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "#2c3e50", textDecoration: "none" }}>{n.title}</a> : n.title}
                        </div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{n.publisher} · {n.date}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {view === "validacion" && (
        <>
          <p style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>Cada punto es la <b>predicción a 1 día</b> de cada modelo vs. el <b>precio real</b>.</p>
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
            </>
          ) : <p style={{ fontSize: 13, color: "#999" }}>Sin datos de validación para {ticker}.</p>}
        </>
      )}
    </div>
  );
}

function ZoomBtn({ children, onClick, disabled }: { children: any; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 34, height: 34, border: "1px solid #ddd", borderRadius: 6, cursor: disabled ? "default" : "pointer",
               background: disabled ? "#f5f5f5" : "#fff", color: disabled ? "#bbb" : "#333", fontSize: 16 }}>{children}</button>
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
function RiskCard({ label, value, pnl, sub, color }: { label: string; value: string; pnl: number; sub: string; color: string }) {
  return (
    <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #eee", borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: pnl >= 0 ? "#1e824c" : "#c0392b" }}>
        {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </div>
      <div style={{ fontSize: 10, color: "#aaa" }}>{sub}</div>
    </div>
  );
}
function ModelCard({ title, color, m }: { title: string; color: string; m: any }) {
  if (!m) return (<div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8, borderLeft: `4px solid ${color}` }}>
    <div style={{ fontWeight: 600 }}>{title}</div><div style={{ fontSize: 12, color: "#999" }}>Sin modelo entrenado</div></div>);
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
