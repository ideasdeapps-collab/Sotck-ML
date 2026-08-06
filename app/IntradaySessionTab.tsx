"use client";

/**
 * IntradaySessionTab.tsx — 🕐 Sesión intradía (AnalysisChart + precio EN VIVO)
 * ==========================================================================
 * Igual que antes (sesiones, quote, snapshots, scorecard, guardado, velas de
 * sesiones pasadas, Elliott, herramientas de dibujo) + NUEVO:
 *   • Polling cada 60s a /intraday-live (solo en vista "En vivo").
 *   • El NÚMERO del precio se actualiza cada minuto (🔴 con hora).
 *   • Una SEÑAL horizontal móvil en la gráfica marca dónde está el precio ahora.
 *   (No se dibuja línea atrasada; solo la señal + el número.)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import AnalysisChart from "./AnalysisChart";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
const PALETTE = ["#e67e22", "#2980b9", "#16a085", "#8e44ad", "#c0392b",
                 "#27ae60", "#d35400", "#2c3e50", "#f39c12", "#7f8c8d"];
const LIVE = "__live__";

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
const fechaCorta = (d: string) => new Date(d + "T12:00:00").toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });

export default function IntradaySessionTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [selSession, setSelSession] = useState<string>(LIVE);
  const [data, setData] = useState<any>(null);
  const [pastBars, setPastBars] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [score, setScore] = useState<any>(null);
  const [showElliott, setShowElliott] = useState(true);
  const [showScore, setShowScore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // NUEVO: precio en vivo (minuto a minuto)
  const [live, setLive] = useState<{ price: number | null; time: string | null } | null>(null);
  const pollRef = useRef<any>(null);

  const isLive = selSession === LIVE;

  useEffect(() => {
    (async () => {
      try {
        let avail: string[] = [];
        const r1 = await fetch(`${API_URL}/models-intraday`);
        if (r1.ok) avail = (await r1.json()).available || [];
        if (avail.length === 0) {
          const r2 = await fetch(`${API_URL}/models`);
          if (r2.ok) avail = (await r2.json()).available || [];
        }
        setModels(avail);
        setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos."); }
    })();
  }, []);

  useEffect(() => {
    if (!ticker) return;
    setError(null); setMsg(null); setScore(null); setShowScore(false);
    setSelSession(LIVE);
    cargarSesionesLista(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    setMsg(null); setScore(null); setShowScore(false);
    if (isLive) {
      setPastBars([]); cargarSesion(ticker); cargarQuote(ticker); cargarSnaps(ticker, null);
    } else {
      setData(null); setQuote(null); cargarSnaps(ticker, selSession); cargarVelasPasadas(ticker, selSession);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSession, ticker]);

  // NUEVO: polling de precio en vivo (solo en la vista "En vivo")
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!isLive || !ticker) { setLive(null); return; }
    const tick = async () => {
      try {
        const r = await fetch(`${API_URL}/intraday-live?ticker=${ticker}`);
        if (r.ok) { const j = await r.json(); setLive({ price: j.price, time: j.time }); }
      } catch { /* silencioso */ }
    };
    tick();                                       // inmediato
    pollRef.current = setInterval(tick, 60000);   // cada 60 s
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, ticker]);

  async function cargarSesionesLista(tk: string) {
    try { const r = await fetch(`${API_URL}/intraday-sessions?ticker=${tk}`); setSessions(r.ok ? (await r.json()).sessions || [] : []); }
    catch { setSessions([]); }
  }
  async function cargarSesion(tk: string) {
    setLoading(true);
    try { const res = await fetch(`${API_URL}/predict-intraday?ticker=${tk}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API intradía"); setData(await res.json()); }
    catch (e: any) { setError(e.message); setData(null); } finally { setLoading(false); }
  }
  async function cargarVelasPasadas(tk: string, sd: string) {
    setLoading(true);
    try { const r = await fetch(`${API_URL}/intraday-bars?ticker=${tk}&session_date=${sd}`); setPastBars(r.ok ? (await r.json()).bars || [] : []); }
    catch { setPastBars([]); } finally { setLoading(false); }
  }
  async function cargarQuote(tk: string) {
    try { const r = await fetch(`${API_URL}/quote?ticker=${tk}`); setQuote(r.ok ? await r.json() : null); } catch { setQuote(null); }
  }
  async function cargarSnaps(tk: string, sd: string | null) {
    try {
      const q = sd ? `&session_date=${sd}` : "";
      const r = await fetch(`${API_URL}/intraday-snapshots?ticker=${tk}${q}`);
      if (!r.ok) { setSnaps([]); return; }
      let list = (await r.json()).snapshots || [];
      if (!sd && list.length) {
        const latest = list.reduce((mx: string, s: any) => (s.session_date > mx ? s.session_date : mx), list[0].session_date);
        list = list.filter((s: any) => s.session_date === latest);
      }
      setSnaps(list.map((s: any, i: number) => ({ ...s, color: PALETTE[i % PALETTE.length] })));
    } catch { setSnaps([]); }
  }

  async function guardar() {
    if (!data) return;
    if (!data.predicted || data.predicted.length === 0) {
      setError("La sesión ya cerró (0 barras a predecir). Guarda durante una sesión ABIERTA."); return;
    }
    setSaving(true); setMsg(null); setError(null);
    try {
      const lastReal = data.real?.[data.real.length - 1];
      const payload = { ticker, session_date: data.session_date, bars_real: data.bars_real,
        anchor_time: lastReal?.time || null, anchor_close: data.last_real_close,
        points: data.predicted.map((p: any) => ({ time: p.time, close: p.close })),
        dir_acc_model: data.model_meta?.directional_accuracy ?? null };
      const res = await fetch(`${API_URL}/intraday-snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).detail || "Error al guardar");
      setMsg(`✅ Predicción guardada (${payload.points.length} barras).`);
      await cargarSnaps(ticker, null); await cargarSesionesLista(ticker);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  async function verDesempeno() {
    setShowScore(true); setScore(null); setError(null);
    try {
      const q = isLive ? "" : `&session_date=${selSession}`;
      const r = await fetch(`${API_URL}/intraday-scorecard?ticker=${ticker}${q}`);
      if (!r.ok) throw new Error((await r.json()).detail || "Error scorecard");
      setScore(await r.json());
    } catch (e: any) { setError(e.message); }
  }

  // ---------- Construcción de datos para AnalysisChart ----------
  const realBars: any[] = isLive ? (data?.real || []) : pastBars;

  const chart = useMemo(() => {
    let times: string[];
    if (isLive && data?.full) times = data.full.map((p: any) => p.time);
    else {
      const set = new Set<string>();
      realBars.forEach((b) => set.add(b.time));
      snaps.forEach((s) => { if (s.anchor_time) set.add(s.anchor_time); (s.points || []).forEach((p: any) => set.add(p.time)); });
      times = Array.from(set).sort();
    }
    if (times.length < 2) return null;

    const nReal = isLive ? (data?.bars_real ?? realBars.length) : realBars.length;
    const realByTime: Record<string, any> = {}; realBars.forEach((b) => (realByTime[b.time] = b));

    const rows: Record<string, any> = {};
    times.forEach((t) => {
      const b = realByTime[t];
      rows[t] = { date: t, ...(b ? { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume } : {}) };
    });

    const lines: any[] = [];
    snaps.forEach((s) => {
      const key = `s_${s.id}`;
      if (s.anchor_time && rows[s.anchor_time]) rows[s.anchor_time][key] = s.anchor_close;
      (s.points || []).forEach((p: any) => { if (rows[p.time]) rows[p.time][key] = p.close; });
      if (s.points?.length) lines.push({ key, color: s.color, label: `Snap ${hm(s.calc_time)}`, width: 1.6, dash: "3 3" });
    });
    if (isLive && data?.full && nReal > 0) {
      const anchorT = times[nReal - 1];
      if (rows[anchorT]) rows[anchorT]["pred"] = data.full[nReal - 1].close;
      data.full.slice(nReal).forEach((p: any) => { if (rows[p.time]) rows[p.time]["pred"] = p.close; });
      if (data.bars_predicted > 0) lines.push({ key: "pred", color: "#111", label: "Predicción", width: 2, dash: "5 4" });
    }

    const overlays: any[] = [];
    if (showElliott && data) {
      const eR = data.elliott_real?.elliott, eF = data.elliott_full?.elliott, abc = data.elliott_full?.abc;
      (eF?.found ? eF.points : []).filter((w: any) => w.label !== "0").forEach((w: any) =>
        overlays.push({ date: w.time, price: w.price, label: w.label, color: "#e67e22", filled: false }));
      (abc?.found ? abc.points : []).forEach((w: any) =>
        overlays.push({ date: w.time, price: w.price, label: w.label, color: "#d35400", filled: true, dy: 16 }));
      (eR?.found ? eR.points : []).filter((w: any) => w.label !== "0").forEach((w: any) =>
        overlays.push({ date: w.time, price: w.price, label: w.label, color: "#8e44ad", filled: true }));
    }

    const markers: any[] = [];
    if (isLive && nReal > 0 && times[nReal - 1]) markers.push({ date: times[nReal - 1], label: "ahora", color: "#999" });

    return { data: Object.values(rows), lines, overlays, markers };
  }, [isLive, data, realBars, snaps, showElliott]);

  const ell = data?.elliott_full?.elliott;
  const chg = quote?.change ?? null, chgPct = quote?.change_pct ?? null;
  const up = (chg ?? 0) >= 0;
  const sessionClosed = isLive && data && (!data.predicted || data.predicted.length === 0);
  const hayGrafica = !!chart;
  const shownPrice = live?.price ?? quote?.price;   // número visible: live si existe, si no el quote

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      {/* Controles */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 100, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Sesión</div>
          <select value={selSession} onChange={(e) => setSelSession(e.target.value)}
            style={{ padding: 9, minWidth: 200, border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            <option value={LIVE}>🔴 En vivo (hoy)</option>
            {sessions.map((s) => (
              <option key={s.session_date} value={s.session_date}>
                📌 {fechaCorta(s.session_date)} · {s.count} snap{s.count > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>

        {isLive && (
          <>
            <button onClick={() => cargarSesion(ticker)} disabled={loading || !ticker}
              style={{ padding: "10px 18px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {loading ? "Calculando…" : "↻ Calcular"}
            </button>
            <button onClick={guardar} disabled={saving || !data || sessionClosed}
              title={sessionClosed ? "La sesión ya cerró" : "Guarda la predicción actual"}
              style={{ padding: "10px 16px", background: sessionClosed ? "#ccc" : "#8e44ad", color: "#fff",
                       border: "none", borderRadius: 6, cursor: (data && !sessionClosed) ? "pointer" : "not-allowed" }}>
              {saving ? "Guardando…" : "💾 Guardar"}
            </button>
          </>
        )}
        <button onClick={verDesempeno} disabled={!ticker}
          style={{ padding: "10px 16px", background: "#1e824c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          📊 Desempeño
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={showElliott} onChange={(e) => setShowElliott(e.target.checked)} /> Elliott
        </label>
      </div>

      {/* Precio EN VIVO (número que cambia minuto a minuto) */}
      {isLive && shownPrice != null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{ticker}</span>
          <span style={{ fontSize: 26, fontWeight: 700 }}>${Number(shownPrice).toFixed(2)}</span>
          {live?.time && (
            <span style={{ fontSize: 11, color: "#0a84ff", fontWeight: 700 }}>
              🔴 {new Date(live.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span style={{ fontSize: 15, fontWeight: 700, color: up ? "#1e824c" : "#c0392b" }}>
            {up ? "▲" : "▼"} {chg != null ? `${up ? "+" : ""}${Number(chg).toFixed(2)}` : "—"}
            {chgPct != null ? ` (${up ? "+" : ""}${Number(chgPct).toFixed(2)}%)` : ""}
          </span>
          <span style={{ fontSize: 10, color: "#bbb" }}>⏱ ~15 min de retraso (Polygon Starter)</span>
        </div>
      )}

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}
      {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
      {sessionClosed && !error && (
        <p style={{ fontSize: 12, color: "#b8860b" }}>ⓘ Sesión cerrada: se muestran las velas del día, pero no hay predicción que guardar.</p>
      )}
      {!isLive && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: 8, fontSize: 12,
          background: "#eef2f6", borderLeft: "4px solid #2980b9", color: "#2c3e50" }}>
          📌 Sesión guardada del <b>{fechaCorta(selSession)}</b> — velas reales + {snaps.length} predicción(es). Pulsa 📊 para el scorecard.
        </div>
      )}

      {!hayGrafica && !loading && !error && (
        <div style={{ padding: "56px 20px", textAlign: "center", background: "#f7f9fb", borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🕐</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>
            {isLive ? "Elige un ticker y pulsa «↻ Calcular»" : "No hay datos para esta sesión"}
          </div>
        </div>
      )}

      {hayGrafica && chart && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 13, flexWrap: "wrap" }}>
            {isLive && data && <>
              <span>📅 Sesión: <strong>{fecha(data.full[0].time)}</strong></span>
              <span style={{ color: "#666" }}>{data.bars_real} velas · {data.bars_predicted} predichas</span>
              {ell?.found && <span style={{ color: "#8e44ad" }}>🌊 Elliott {ell.tentative ? "(tentativo)" : `(${ell.confidence}%)`}</span>}
            </>}
            {!isLive && <span style={{ color: "#666" }}>{realBars.length} velas reales · {snaps.length} guardadas</span>}
          </div>

          <AnalysisChart
            data={chart.data} lines={chart.lines}
            candleKey={{ o: "o", h: "h", l: "l", c: "c", v: "v" }}
            overlays={chart.overlays} markers={chart.markers}
            priceLine={isLive && live?.price != null ? { price: live.price, color: "#0a84ff", label: "● real ahora" } : undefined}
            storageKey={`intr_draw_${ticker}`} height={470} />

          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#1e824c" }}>▮ vela alcista</span>
            <span style={{ color: "#c0392b" }}>▮ vela bajista</span>
            <span style={{ color: "#111" }}>┈ predicción</span>
            <span style={{ color: "#8e44ad" }}>● Elliott (real)</span>
            <span style={{ color: "#0a84ff" }}>┅ precio real ahora</span>
          </div>
        </>
      )}

      {/* SCORECARD */}
      {showScore && (
        <div style={{ marginTop: 20, padding: 16, background: "#f7f9fb", borderRadius: 10, border: "1px solid #e5eaf0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            📊 Desempeño — {ticker} {!isLive && `· ${fechaCorta(selSession)}`}
          </div>
          {!score ? <p style={{ fontSize: 13, color: "#999" }}>Cargando scorecard…</p> : (
            <>
              {score.verdict && (
                <div style={{ padding: 10, marginBottom: 10, borderRadius: 8, fontSize: 13,
                  background: (score.avg_skill ?? 0) > 0.05 ? "#eafaf1" : (score.avg_skill ?? 0) < -0.05 ? "#fbeeee" : "#fff8e1",
                  borderLeft: `4px solid ${(score.avg_skill ?? 0) > 0.05 ? "#1e824c" : (score.avg_skill ?? 0) < -0.05 ? "#c0392b" : "#f39c12"}` }}>
                  <b>Veredicto:</b> {score.verdict}
                  {score.avg_skill != null && <span style={{ color: "#666" }}> · Skill medio: <b>{(score.avg_skill * 100).toFixed(0)}%</b></span>}
                </div>
              )}
              {score.rows?.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#eef2f6" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Calculado</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>Barras eval.</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>MAPE modelo</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>MAPE baseline</th>
                        <th style={{ textAlign: "right", padding: "8px 10px" }}>Skill</th>
                        <th style={{ textAlign: "center", padding: "8px 10px" }}>Dir.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.rows.map((r: any) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #eef2f6" }}>
                          <td style={{ padding: "7px 10px" }}>{hm(r.calc_time)}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px" }}>{r.evaluated_bars}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px" }}>{r.mape == null ? "—" : `${(r.mape * 100).toFixed(2)}%`}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px", color: "#888" }}>{r.mape_baseline == null ? "—" : `${(r.mape_baseline * 100).toFixed(2)}%`}</td>
                          <td style={{ textAlign: "right", padding: "7px 10px", fontWeight: 700, color: r.skill == null ? "#999" : r.skill > 0 ? "#1e824c" : "#c0392b" }}>
                            {r.skill == null ? "—" : `${r.skill > 0 ? "+" : ""}${(r.skill * 100).toFixed(0)}%`}
                          </td>
                          <td style={{ textAlign: "center", padding: "7px 10px" }}>{r.dir_ok == null ? "—" : r.dir_ok ? "✅" : "❌"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p style={{ fontSize: 13, color: "#999" }}>Sin snapshots evaluables (curvas vacías o precio real aún no alcanza las fechas).</p>}
              <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>
                ⓘ <b>Skill</b> = cuánto le gana el modelo al baseline “sin cambio”. &gt; 0 = aporta. Análisis educativo, no recomendación.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
