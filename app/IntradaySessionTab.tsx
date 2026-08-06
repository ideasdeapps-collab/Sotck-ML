"use client";

/**
 * IntradaySessionTab.tsx — 🕐 Sesión intradía (dropdown + velas en sesiones pasadas)
 * ================================================================================
 * FIXES:
 *   • Al abrir una SESIÓN PASADA → carga las VELAS REALES de ese día (/intraday-bars)
 *     y superpone las predicciones guardadas (predicho vs. lo que realmente pasó).
 *   • Evita GUARDAR snapshots vacíos: si la sesión ya cerró (0 barras a predecir),
 *     el botón 💾 avisa en vez de guardar points:[] inservible.
 *
 * Endpoints: /predict-intraday · /quote · /intraday-snapshot · /intraday-snapshots
 *            · /intraday-sessions · /intraday-scorecard · /intraday-bars
 */

import { useEffect, useState } from "react";

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
  const [data, setData] = useState<any>(null);            // /predict-intraday (en vivo)
  const [pastBars, setPastBars] = useState<any[]>([]);     // velas reales de sesión pasada
  const [quote, setQuote] = useState<any>(null);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [score, setScore] = useState<any>(null);
  const [showElliott, setShowElliott] = useState(true);
  const [showScore, setShowScore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

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
    setError(null); setMsg(null); setHover(null); setScore(null); setShowScore(false);
    setSelSession(LIVE);
    cargarSesionesLista(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    setMsg(null); setHover(null); setScore(null); setShowScore(false);
    if (isLive) {
      setPastBars([]);
      cargarSesion(ticker);
      cargarQuote(ticker);
      cargarSnaps(ticker, null);
    } else {
      setData(null); setQuote(null);
      cargarSnaps(ticker, selSession);
      cargarVelasPasadas(ticker, selSession);   // ← velas reales del día pasado
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSession, ticker]);

  async function cargarSesionesLista(tk: string) {
    try {
      const r = await fetch(`${API_URL}/intraday-sessions?ticker=${tk}`);
      setSessions(r.ok ? (await r.json()).sessions || [] : []);
    } catch { setSessions([]); }
  }

  async function cargarSesion(tk: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/predict-intraday?ticker=${tk}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API intradía");
      setData(await res.json());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  async function cargarVelasPasadas(tk: string, sessionDate: string) {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/intraday-bars?ticker=${tk}&session_date=${sessionDate}`);
      setPastBars(r.ok ? (await r.json()).bars || [] : []);
    } catch { setPastBars([]); }
    finally { setLoading(false); }
  }

  async function cargarQuote(tk: string) {
    try { const r = await fetch(`${API_URL}/quote?ticker=${tk}`); setQuote(r.ok ? await r.json() : null); }
    catch { setQuote(null); }
  }

  async function cargarSnaps(tk: string, sessionDate: string | null) {
    try {
      const q = sessionDate ? `&session_date=${sessionDate}` : "";
      const r = await fetch(`${API_URL}/intraday-snapshots?ticker=${tk}${q}`);
      if (!r.ok) { setSnaps([]); return; }
      const j = await r.json();
      let list = j.snapshots || [];
      if (!sessionDate && list.length) {
        const latest = list.reduce((mx: string, s: any) => (s.session_date > mx ? s.session_date : mx), list[0].session_date);
        list = list.filter((s: any) => s.session_date === latest);
      }
      setSnaps(list.map((s: any, i: number) => ({ ...s, color: PALETTE[i % PALETTE.length] })));
    } catch { setSnaps([]); }
  }

  async function guardar() {
    if (!data) return;
    // Fix: no guardar snapshots vacíos (sesión ya cerrada → nada que predecir)
    if (!data.predicted || data.predicted.length === 0) {
      setError("La sesión ya cerró (0 barras a predecir). Guarda durante una sesión ABIERTA, cuando aún queda día por proyectar.");
      return;
    }
    setSaving(true); setMsg(null); setError(null);
    try {
      const lastReal = data.real?.[data.real.length - 1];
      const payload = {
        ticker, session_date: data.session_date, bars_real: data.bars_real,
        anchor_time: lastReal?.time || null, anchor_close: data.last_real_close,
        points: data.predicted.map((p: any) => ({ time: p.time, close: p.close })),
        dir_acc_model: data.model_meta?.directional_accuracy ?? null,
      };
      const res = await fetch(`${API_URL}/intraday-snapshot`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Error al guardar");
      setMsg(`✅ Predicción guardada (${payload.points.length} barras proyectadas).`);
      await cargarSnaps(ticker, null);
      await cargarSesionesLista(ticker);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
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

  // ---------- Geometría ----------
  const W = 960, H = 480, padL = 52, padR = 62, padT = 22, padB = 48;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Velas reales activas: en vivo (data.real) o de la sesión pasada (pastBars)
  const realBars: any[] = isLive ? (data?.real || []) : pastBars;

  // Eje temporal: en vivo usa data.full; en pasada usa la unión de velas + snapshots
  function buildTimes(): string[] {
    if (isLive && data?.full) return data.full.map((p: any) => p.time);
    const set = new Set<string>();
    realBars.forEach((b) => set.add(b.time));
    snaps.forEach((s) => { if (s.anchor_time) set.add(s.anchor_time); (s.points || []).forEach((p: any) => set.add(p.time)); });
    return Array.from(set).sort();
  }

  function render() {
    const times = buildTimes();
    if (times.length < 2) return null;
    const nReal = isLive ? (data?.bars_real ?? realBars.length) : realBars.length;

    const idxByTime: Record<string, number> = {};
    times.forEach((t, i) => (idxByTime[t] = i));

    const vals: number[] = [];
    realBars.forEach((b) => { vals.push(b.high, b.low); });
    snaps.forEach((s) => { if (s.anchor_close) vals.push(s.anchor_close); (s.points || []).forEach((p: any) => vals.push(p.close)); });
    if (isLive && data?.full) data.full.slice(nReal).forEach((p: any) => vals.push(p.close));
    const eReal = data?.elliott_real || {}, eFull = data?.elliott_full || {};
    [...(eReal.elliott?.points || []), ...(eFull.elliott?.points || []),
     ...(eFull.abc?.points || [])].forEach((w: any) => vals.push(w.price));
    if (!vals.length) return null;
    const yMax = Math.max(...vals) * 1.001, yMin = Math.min(...vals) * 0.999;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;

    const n = times.length, cw = plotW / n, cx = (i: number) => padL + i * cw + cw / 2;
    const boundaryX = (isLive && nReal > 0) ? padL + nReal * cw : null;

    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((n - 1) * (k / 6)); return { i, time: times[i] };
    });

    const zzFull = (eFull.zigzag || []) as any[];
    const wavesReal = eReal.elliott?.found ? eReal.elliott.points.filter((w: any) => w.label !== "0") : [];
    const wavesFull = eFull.elliott?.found ? eFull.elliott.points.filter((w: any) => w.label !== "0") : [];
    const abcFull = eFull.abc?.found ? eFull.abc.points : [];

    const predLine = (isLive && data?.full)
      ? data.full.slice(Math.max(0, nReal - 1)).map((p: any, k: number) => {
          const i = (nReal - 1) + k; return `${k === 0 ? "M" : "L"} ${cx(i)} ${y(p.close)}`;
        }).join(" ")
      : "";

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}
           onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 5 }).map((_, k) => {
          const p = yMin + (yMax - yMin) * (k / 4);
          return (<g key={k}>
            <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="#f2f2f2" />
            <text x={W - padR + 4} y={y(p) + 3} fontSize={10} fill="#999">{p.toFixed(2)}</text>
          </g>);
        })}
        {xticks.map((t, k) => (
          <text key={k} x={cx(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">{hm(t.time)}</text>
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="#bbb">Hora ({fecha(times[0])})</text>

        {boundaryX != null && <>
          <line x1={boundaryX} x2={boundaryX} y1={padT} y2={H - padB} stroke="#999" strokeDasharray="4 3" opacity={0.5} />
          <text x={boundaryX} y={padT - 5} fontSize={9} fill="#999" textAnchor="middle">ahora</text>
        </>}

        {showElliott && zzFull.length > 1 && (
          <path d={zzFull.map((z: any, i: number) => { const j = idxByTime[z.time]; return `${i === 0 ? "M" : "L"} ${cx(j ?? 0)} ${y(z.price)}`; }).join(" ")}
                fill="none" stroke="#8e44ad" strokeWidth={1} opacity={0.28} />
        )}

        {/* VELAS reales (en vivo o sesión pasada) */}
        {realBars.map((b, i) => {
          const idx = idxByTime[b.time]; if (idx == null) return null;
          const up = b.close >= b.open; const col = up ? "#1e824c" : "#c0392b";
          const bt = y(Math.max(b.open, b.close)), bb = y(Math.min(b.open, b.close));
          return (<g key={`c${i}`}>
            <line x1={cx(idx)} x2={cx(idx)} y1={y(b.high)} y2={y(b.low)} stroke={col} strokeWidth={1} />
            <rect x={cx(idx) - cw * 0.32} y={bt} width={cw * 0.64} height={Math.max(bb - bt, 1.2)} fill={col} />
          </g>);
        })}

        {/* Snapshots guardados */}
        {snaps.map((s) => {
          const pts = [{ time: s.anchor_time, close: s.anchor_close }, ...(s.points || [])]
            .filter((p: any) => p.time && idxByTime[p.time] != null);
          if (pts.length < 2) return null;
          const d = pts.map((p: any, k: number) => `${k === 0 ? "M" : "L"} ${cx(idxByTime[p.time])} ${y(p.close)}`).join(" ");
          return <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray="3 3" opacity={0.85} />;
        })}

        {predLine && <path d={predLine} fill="none" stroke="#111" strokeWidth={2} strokeDasharray="5 4" opacity={0.85} />}

        {showElliott && wavesFull.map((w: any, k: number) => {
          const i = idxByTime[w.time]; if (i == null) return null;
          return (<g key={`ef${k}`}>
            <circle cx={cx(i)} cy={y(w.price)} r={6} fill="#fff" stroke="#e67e22" strokeWidth={2} />
            <text x={cx(i)} y={y(w.price) - 10} fontSize={12} fontWeight={700} fill="#e67e22" textAnchor="middle">{w.label}</text>
          </g>);
        })}
        {showElliott && abcFull.map((w: any, k: number) => {
          const i = idxByTime[w.time]; if (i == null) return null;
          return (<text key={`abc${k}`} x={cx(i)} y={y(w.price) + 18} fontSize={12} fontWeight={700} fill="#d35400" textAnchor="middle">{w.label}</text>);
        })}
        {showElliott && wavesReal.map((w: any, k: number) => {
          const i = idxByTime[w.time]; if (i == null) return null;
          return (<g key={`er${k}`}>
            <circle cx={cx(i)} cy={y(w.price)} r={4.5} fill="#8e44ad" />
            <text x={cx(i)} y={y(w.price) - 10} fontSize={12} fontWeight={800} fill="#8e44ad" textAnchor="middle">{w.label}</text>
          </g>);
        })}

        {/* Hover */}
        {times.map((_, i) => (
          <rect key={`h${i}`} x={padL + i * cw} y={padT} width={cw} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && (() => {
          const tHover = times[hover];
          const b = realBars.find((rb) => rb.time === tHover);
          const gx = cx(hover);
          const yv = b ? b.close : null;
          const lines = b
            ? [hm(tHover), `O ${b.open}  H ${b.high}`, `L ${b.low}  C ${b.close}`, `Vol ${b.volume.toLocaleString()}`]
            : [hm(tHover)];
          const boxW = 138, boxH = 14 + lines.length * 13;
          let bx = gx + 10; if (bx + boxW > W - padR) bx = gx - boxW - 10;
          const by = Math.max(padT, (yv != null ? y(yv) : padT + 20) - boxH - 8);
          return (
            <g pointerEvents="none">
              <line x1={gx} x2={gx} y1={padT} y2={H - padB} stroke="#bbb" strokeDasharray="2 2" />
              {yv != null && <circle cx={gx} cy={y(yv)} r={3.5} fill="#111" />}
              <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill="#111" opacity={0.9} />
              {lines.map((ln, k) => (
                <text key={k} x={bx + 8} y={by + 16 + k * 13} fontSize={11} fill={k === 0 ? "#fff" : "#e5e5e5"} fontWeight={k === 0 ? 700 : 400}>{ln}</text>
              ))}
            </g>
          );
        })()}
      </svg>
    );
  }

  const ell = data?.elliott_full?.elliott;
  const chg = quote?.change ?? null, chgPct = quote?.change_pct ?? null;
  const up = (chg ?? 0) >= 0;
  const sessionClosed = isLive && data && (!data.predicted || data.predicted.length === 0);
  const hayGrafica = (isLive && data) || (!isLive && (pastBars.length > 0 || snaps.length > 0));

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
              title={sessionClosed ? "La sesión ya cerró: no hay barras a predecir" : "Guarda la predicción actual"}
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
          <input type="checkbox" checked={showElliott} onChange={(e) => setShowElliott(e.target.checked)} />
          Elliott
        </label>
      </div>

      {isLive && quote && quote.price != null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{quote.ticker}</span>
          <span style={{ fontSize: 26, fontWeight: 700 }}>${Number(quote.price).toFixed(2)}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: up ? "#1e824c" : "#c0392b" }}>
            {up ? "▲" : "▼"} {chg != null ? `${up ? "+" : ""}${Number(chg).toFixed(2)}` : "—"}
            {chgPct != null ? ` (${up ? "+" : ""}${Number(chgPct).toFixed(2)}%)` : ""}
          </span>
          <span style={{ fontSize: 10, color: "#bbb" }}>⏱ ~15 min de retraso (Polygon)</span>
        </div>
      )}

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}
      {msg && <p style={{ color: "#1e824c", fontSize: 13 }}>{msg}</p>}
      {sessionClosed && !error && (
        <p style={{ fontSize: 12, color: "#b8860b" }}>ⓘ Sesión cerrada: se muestran las velas del día, pero no hay predicción que guardar (guarda durante la sesión abierta).</p>
      )}

      {!isLive && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: 8, fontSize: 12,
          background: "#eef2f6", borderLeft: "4px solid #2980b9", color: "#2c3e50" }}>
          📌 Sesión guardada del <b>{fechaCorta(selSession)}</b> — velas reales del día + {snaps.length} predicción(es) guardada(s). Pulsa 📊 para el scorecard.
        </div>
      )}

      {!hayGrafica && !loading && !error && (
        <div style={{ padding: "56px 20px", textAlign: "center", background: "#f7f9fb",
                      borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🕐</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>
            {isLive ? "Elige un ticker y pulsa «↻ Calcular»" : "No hay datos para esta sesión"}
          </div>
        </div>
      )}

      {hayGrafica && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 13, flexWrap: "wrap" }}>
            {isLive && data && <>
              <span>📅 Sesión: <strong>{fecha(data.full[0].time)}</strong></span>
              <span style={{ color: "#666" }}>{data.bars_real} velas · {data.bars_predicted} predichas</span>
              {ell?.found && <span style={{ color: "#8e44ad" }}>🌊 Elliott {ell.tentative ? "(tentativo)" : `(${ell.confidence}%)`}</span>}
            </>}
            {!isLive && <span style={{ color: "#666" }}>{realBars.length} velas reales · {snaps.length} guardadas</span>}
          </div>

          {render()}

          {snaps.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666" }}>Guardadas:</span>
              {snaps.map((s) => (
                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#777" }}>
                  <span style={{ width: 14, height: 3, background: s.color, display: "inline-block", borderRadius: 2 }} />
                  {hm(s.calc_time)}{(!s.points || s.points.length === 0) ? " (vacía)" : ""}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#1e824c" }}>▮ vela alcista</span>
            <span style={{ color: "#c0392b" }}>▮ vela bajista</span>
            <span style={{ color: "#111" }}>┈ predicción</span>
            <span style={{ color: "#8e44ad" }}>● Elliott (real)</span>
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
              ) : <p style={{ fontSize: 13, color: "#999" }}>Sin snapshots evaluables (los guardados tienen la curva vacía — se guardaron con la sesión cerrada).</p>}
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
