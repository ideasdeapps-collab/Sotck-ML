"use client";

/**
 * StockForecastChart.tsx — Predicción + Validación + Noticias + Sentimiento puro
 * ==============================================================================
 * • Días a proyectar (input) + Zoom In/Out/Reset
 * • Curvas: Histórico · XGBoost · MLP · XGBoost+Sentimiento · Sentimiento puro
 *   · Mediana Monte Carlo + bandas P5–P95
 * • (#1) Noticias de Polygon desplegadas ABAJO de la curva
 * • (#3) NUEVA curva "Sentimiento puro" (proyección solo con score de noticias)
 * • Vista Validación (predicho vs real)
 */

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
type View = "proyeccion" | "validacion";

const SENT_COLOR: Record<string, string> = { positive: "#1e824c", negative: "#c0392b", neutral: "#95a5a6" };

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
      // Curvas psicológicas (IPM): contrarian directa (A) + aprendida ML (B)
      if (pRes.ok) {
        const pj = await pRes.json();
        (pj.contrarian?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), psyA: p.close }));
        (pj.learned?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), psyB: p.close }));
      }
      setFwd(Object.values(rows).sort((a: any, b: any) => a.date.localeCompare(b.date)));
      setSummary({ ...sim.terminal });

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

  const divergence = riskNote.includes("Divergencia");
  const zoomIn = () => setZoom((z) => Math.max(0.1, +(z * 0.7).toFixed(3)));
  const zoomOut = () => setZoom((z) => Math.min(1, +(z / 0.7).toFixed(3)));
  const zoomReset = () => setZoom(1);

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
                <ComposedChart data={fwdZoom} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
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
                  <Line dataKey="sentOnly" stroke="#d35400" dot={false} strokeWidth={1.6} strokeDasharray="1 3" name="Sentimiento puro" connectNulls />
                  <Line dataKey="psyA" stroke="#9b59b6" dot={false} strokeWidth={1.6} strokeDasharray="3 2" name="Psicología contrarian (A)" connectNulls />
                  <Line dataKey="psyB" stroke="#2ecc71" dot={false} strokeWidth={1.6} strokeDasharray="1 3" name="Psicología ML (B)" connectNulls />
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
              {!hasMlp && <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>ⓘ {ticker} no tiene modelo MLP entrenado (curva verde oculta).</p>}
              {hasMlp && mlpWarning && <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>⚠️ Curva MLP de {ticker}: {mlpWarning}</p>}

              {/* ===== (#1) NOTICIAS DESPLEGADAS ABAJO DE LA CURVA ===== */}
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
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                          {n.publisher} · {n.date}
                          {n.reasoning ? ` — ${String(n.reasoning).slice(0, 120)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
                ⓘ <b style={{ color: "#e67e22" }}>XGBoost</b> · <b style={{ color: "#16a085" }}>MLP</b> ·
                <b style={{ color: "#8e44ad" }}> XGBoost+Sentimiento</b> ·
                <b style={{ color: "#d35400" }}> Sentimiento puro</b> (solo noticias, sin modelo).
              </p>
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
