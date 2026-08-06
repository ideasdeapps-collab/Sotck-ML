"use client";

/**
 * IntradaySessionTab.tsx — 🕐 Sesión intradía (ML 15 min) + velas + Elliott
 * =========================================================================
 * FIXES (feedback de Luis):
 *   1) SNAPSHOTS PERSISTENTES: cada «Calcular» (manual o auto) AÑADE una curva
 *      predicha con color propio (no reemplaza). Se comparan contra el precio
 *      real conforme avanza la sesión.
 *   2) Persistencia por ticker en localStorage: al cambiar de ticker se muestran
 *      las curvas guardadas de ese ticker (no se borran). Nueva sesión (otra
 *      fecha) reinicia la acumulación.
 *   3) Auto cada 15 min: ahora sí se ven las curvas nuevas (se acumulan).
 *   4) Velas reales + tooltip + Elliott real/proyectado (se conserva).
 *
 * Fuente: GET /predict-intraday?ticker=XXX   Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
const REFRESH_MIN = 15;

// Paleta para distinguir cada predicción guardada
const PALETTE = ["#e67e22", "#2980b9", "#16a085", "#8e44ad", "#c0392b",
                 "#27ae60", "#d35400", "#2c3e50", "#f39c12", "#7f8c8d"];

type Snap = {
  id: string;
  calcTime: string;       // "HH:MM:SS" (label local)
  sessionDate: string;    // fecha de la sesión (para reiniciar si cambia el día)
  barsReal: number;
  color: string;
  anchor: { time: string; close: number };   // último real cuando se calculó
  points: { time: string; close: number }[]; // curva predicha
};

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });

const loadLS = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const saveLS = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };
const dataKey = (t: string) => `intr_data::${t}`;
const snapsKey = (t: string) => `intr_snaps::${t}`;

export default function IntradaySessionTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [data, setData] = useState<any>(null);          // última respuesta (velas/Elliott/meta)
  const [snaps, setSnaps] = useState<Snap[]>([]);        // predicciones acumuladas del ticker
  const [showElliott, setShowElliott] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCalc, setLastCalc] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef<any>(null);
  const tickerRef = useRef<string>("");                  // evita stale-closure en el auto-refresh

  useEffect(() => { tickerRef.current = ticker; }, [ticker]);

  // Poblar desplegable de tickers
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

  // Al cambiar de TICKER → restaurar lo guardado (SIN recalcular)
  useEffect(() => {
    if (!ticker) return;
    setError(null); setHover(null);
    setData(loadLS(dataKey(ticker)));
    setSnaps(loadLS(snapsKey(ticker)) || []);
    setLastCalc(null);
  }, [ticker]);

  async function calcular(tk: string) {
    if (!tk) return;
    setLoading(true); setError(null); setHover(null);
    try {
      const res = await fetch(`${API_URL}/predict-intraday?ticker=${tk}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API intradía");
      const resp = await res.json();
      setData(resp);
      saveLS(dataKey(tk), resp);
      setLastCalc(new Date().toLocaleTimeString());

      // Acumular como snapshot con color propio (reinicia si cambió la sesión)
      setSnaps((prev) => {
        let base = prev;
        if (prev.length && prev[0].sessionDate !== resp.session_date) base = [];
        const color = PALETTE[base.length % PALETTE.length];
        const lastReal = resp.real?.[resp.real.length - 1];
        const snap: Snap = {
          id: `${Date.now()}`,
          calcTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sessionDate: resp.session_date,
          barsReal: resp.bars_real,
          color,
          anchor: { time: lastReal?.time, close: resp.last_real_close },
          points: (resp.predicted || []).map((p: any) => ({ time: p.time, close: p.close })),
        };
        const next = [...base, snap];
        saveLS(snapsKey(tk), next);
        return next;
      });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  function limpiar() {
    setSnaps([]);
    saveLS(snapsKey(ticker), []);
  }

  // Auto cada 15 min — usa tickerRef para no capturar un ticker viejo
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh) {
      timer.current = setInterval(() => {
        if (tickerRef.current && !loading) calcular(tickerRef.current);
      }, REFRESH_MIN * 60 * 1000);
    }
    return () => timer.current && clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // ---------- Geometría ----------
  const W = 960, H = 480, padL = 52, padR = 62, padT = 22, padB = 48;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const full = data.full as { time: string; close: number }[];
    if (!full?.length) return null;
    const nReal = data.bars_real as number;
    const realBars = data.real as any[];

    const idxByTime: Record<string, number> = {};
    full.forEach((p, i) => (idxByTime[p.time] = i));

    // Rango Y: velas reales + curvas de TODOS los snapshots + Elliott
    const vals: number[] = [];
    realBars.forEach((b) => { vals.push(b.high, b.low); });
    snaps.forEach((s) => s.points.forEach((p) => vals.push(p.close)));
    full.slice(nReal).forEach((p) => vals.push(p.close));
    const eReal = data.elliott_real || {}, eFull = data.elliott_full || {};
    [...(eReal.elliott?.points || []), ...(eFull.elliott?.points || []),
     ...(eFull.abc?.points || [])].forEach((w: any) => vals.push(w.price));
    if (!vals.length) return null;
    const yMax = Math.max(...vals) * 1.001;
    const yMin = Math.min(...vals) * 0.999;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;

    const n = full.length;
    const cw = plotW / n;
    const cx = (i: number) => padL + i * cw + cw / 2;
    const boundaryX = padL + nReal * cw;

    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((n - 1) * (k / 6));
      return { i, time: full[i].time };
    });

    const zzFull = (eFull.zigzag || []) as any[];
    const wavesReal = eReal.elliott?.found ? eReal.elliott.points.filter((w: any) => w.label !== "0") : [];
    const wavesFull = eFull.elliott?.found ? eFull.elliott.points.filter((w: any) => w.label !== "0") : [];
    const abcFull = eFull.abc?.found ? eFull.abc.points : [];

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
        <text x={padL} y={H - 6} fontSize={10} fill="#bbb">Hora ({fecha(full[0].time)})</text>

        {/* Frontera "ahora" */}
        <line x1={boundaryX} x2={boundaryX} y1={padT} y2={H - padB} stroke="#999" strokeDasharray="4 3" opacity={0.5} />
        <text x={boundaryX} y={padT - 5} fontSize={9} fill="#999" textAnchor="middle">ahora</text>

        {/* ZigZag de la sesión completa (tenue) */}
        {showElliott && zzFull.length > 1 && (
          <path d={zzFull.map((z: any, i: number) => {
            const j = idxByTime[z.time]; return `${i === 0 ? "M" : "L"} ${cx(j ?? 0)} ${y(z.price)}`;
          }).join(" ")} fill="none" stroke="#8e44ad" strokeWidth={1} opacity={0.28} />
        )}

        {/* VELAS reales (OHLC) */}
        {realBars.map((b, i) => {
          const up = b.close >= b.open;
          const col = up ? "#1e824c" : "#c0392b";
          const bodyTop = y(Math.max(b.open, b.close));
          const bodyBot = y(Math.min(b.open, b.close));
          return (<g key={`c${i}`}>
            <line x1={cx(i)} x2={cx(i)} y1={y(b.high)} y2={y(b.low)} stroke={col} strokeWidth={1} />
            <rect x={cx(i) - cw * 0.32} y={bodyTop} width={cw * 0.64}
                  height={Math.max(bodyBot - bodyTop, 1.2)} fill={col} />
          </g>);
        })}

        {/* ── CURVAS PREDICHAS ACUMULADAS (una por snapshot, cada una su color) ── */}
        {snaps.map((s, si) => {
          const pts = [s.anchor, ...s.points].filter((p) => p && idxByTime[p.time] != null);
          if (pts.length < 2) return null;
          const d = pts.map((p, k) => `${k === 0 ? "M" : "L"} ${cx(idxByTime[p.time])} ${y(p.close)}`).join(" ");
          const isLast = si === snaps.length - 1;
          return (
            <g key={`snap${s.id}`}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={isLast ? 2.2 : 1.5}
                    strokeDasharray={isLast ? "5 4" : "3 3"} opacity={isLast ? 1 : 0.75} />
              {isLast && s.points.map((p, k) => {
                const i = idxByTime[p.time]; if (i == null) return null;
                return <circle key={`sp${k}`} cx={cx(i)} cy={y(p.close)} r={1.6} fill={s.color} />;
              })}
            </g>
          );
        })}

        {/* Elliott sobre la sesión COMPLETA — naranja hueco */}
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

        {/* Elliott sobre las barras REALES — morado sólido (encima) */}
        {showElliott && wavesReal.map((w: any, k: number) => {
          const i = idxByTime[w.time]; if (i == null) return null;
          return (<g key={`er${k}`}>
            <circle cx={cx(i)} cy={y(w.price)} r={4.5} fill="#8e44ad" />
            <text x={cx(i)} y={y(w.price) - 10} fontSize={12} fontWeight={800} fill="#8e44ad" textAnchor="middle">{w.label}</text>
          </g>);
        })}

        {/* Capa de HOVER + tooltip */}
        {full.map((_, i) => (
          <rect key={`h${i}`} x={padL + i * cw} y={padT} width={cw} height={plotH}
                fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && (() => {
          const i = hover;
          const isReal = i < nReal;
          const b = isReal ? realBars[i] : null;
          const yv = isReal ? b.close : full[i].close;
          const gx = cx(i);
          const lines = isReal
            ? [hm(full[i].time), `O ${b.open}  H ${b.high}`, `L ${b.low}  C ${b.close}`, `Vol ${b.volume.toLocaleString()}`]
            : [hm(full[i].time), `Predicho: ${full[i].close}`];
          const boxW = 138, boxH = 14 + lines.length * 13;
          let bx = gx + 10; if (bx + boxW > W - padR) bx = gx - boxW - 10;
          const by = Math.max(padT, y(yv) - boxH - 8);
          return (
            <g pointerEvents="none">
              <line x1={gx} x2={gx} y1={padT} y2={H - padB} stroke="#bbb" strokeDasharray="2 2" />
              <circle cx={gx} cy={y(yv)} r={3.5} fill={isReal ? "#111" : "#e67e22"} />
              <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill="#111" opacity={0.9} />
              {lines.map((ln, k) => (
                <text key={k} x={bx + 8} y={by + 16 + k * 13} fontSize={11}
                      fill={k === 0 ? "#fff" : "#e5e5e5"} fontWeight={k === 0 ? 700 : 400}>{ln}</text>
              ))}
            </g>
          );
        })()}
      </svg>
    );
  }

  const ell = data?.elliott_full?.elliott;
  const dirAcc = data?.model_meta?.directional_accuracy;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 100, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button onClick={() => calcular(ticker)} disabled={loading || !ticker}
          style={{ padding: "10px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Calculando…" : "↻ Calcular"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto cada {REFRESH_MIN} min
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={showElliott} onChange={(e) => setShowElliott(e.target.checked)} />
          Mostrar Elliott
        </label>
        {snaps.length > 0 && (
          <button onClick={limpiar}
            style={{ padding: "8px 12px", background: "#fff", color: "#c0392b", border: "1px solid #eecccc", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            🗑️ Limpiar guardadas ({snaps.length})
          </button>
        )}
        {lastCalc && <span style={{ fontSize: 11, color: "#999" }}>Calculado {lastCalc}</span>}
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && dirAcc != null && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: 8, fontSize: 12,
          background: "#fff8e1", borderLeft: "4px solid #f39c12", color: "#7a5c00" }}>
          ⚠️ <b>Señal intradía experimental</b> — precisión direccional del modelo: {(dirAcc * 100).toFixed(0)}%.
          Úsala como <b>contexto de la sesión</b> (forma y estructura), no como pronóstico de precio.
        </div>
      )}

      {!data && !loading && !error && (
        <div style={{ padding: "56px 20px", textAlign: "center", background: "#f7f9fb",
                      borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🕐</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>Elige un ticker y pulsa «↻ Calcular»</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Cada cálculo guarda su predicción con un color; se comparan contra el precio real que avanza.</div>
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong></span>
            <span>📅 Sesión: <strong>{fecha(data.full[0].time)}</strong></span>
            <span>Último real: <strong>${data.last_real_close}</strong></span>
            <span style={{ color: "#666" }}>{data.bars_real} velas · {data.bars_predicted} predichas</span>
            {ell?.found && <span style={{ color: "#8e44ad" }}>🌊 Elliott {ell.tentative ? "(tentativo)" : `(${ell.confidence}%)`}</span>}
          </div>

          {render()}

          {/* Leyenda de predicciones guardadas (multicolor) */}
          {snaps.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666" }}>Predicciones guardadas:</span>
              {snaps.map((s, i) => (
                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                  color: i === snaps.length - 1 ? "#111" : "#777", fontWeight: i === snaps.length - 1 ? 700 : 400 }}>
                  <span style={{ width: 14, height: 3, background: s.color, display: "inline-block", borderRadius: 2 }} />
                  {s.calcTime}{i === snaps.length - 1 ? " (última)" : ""}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#1e824c" }}>▮ vela alcista</span>
            <span style={{ color: "#c0392b" }}>▮ vela bajista</span>
            <span style={{ color: "#8e44ad" }}>● Elliott (real)</span>
            <span style={{ color: "#e67e22" }}>◯ Elliott (sesión proyectada)</span>
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>ⓘ {data.note}</p>
        </>
      )}
    </div>
  );
}
