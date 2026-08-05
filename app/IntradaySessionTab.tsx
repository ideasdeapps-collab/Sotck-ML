"use client";

/**
 * IntradaySessionTab.tsx — 🕐 Sesión intradía (ML 15 min) + Elliott
 * ================================================================
 * • Botón «Calcular» → GET /predict-intraday?ticker=XXX
 * • Dibuja las barras REALES de la sesión (línea sólida) + la curva PREDICHA del
 *   resto del día (punteada), con una línea vertical "ahora" en la frontera.
 * • Superpone Elliott (opción C): sobre las barras REALES (morado sólido) y sobre
 *   la sesión COMPLETA real+predicha (naranja, estilo distinto).
 * • Auto-recálculo cada 15 min (casilla), además del botón manual.
 *
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
const REFRESH_MIN = 15;

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });

export default function IntradaySessionTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [showElliott, setShowElliott] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCalc, setLastCalc] = useState<string | null>(null);
  const timer = useRef<any>(null);

  // Poblar el desplegable (intenta modelos intradía; si no, todos).
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

  async function calcular(tk: string) {
    if (!tk) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/predict-intraday?ticker=${tk}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API intradía");
      setData(await res.json());
      setLastCalc(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  // Auto-recálculo cada 15 min
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh && ticker) {
      timer.current = setInterval(() => calcular(ticker), REFRESH_MIN * 60 * 1000);
    }
    return () => timer.current && clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, ticker]);

  // ---------- Render SVG ----------
  const W = 940, H = 470, padL = 50, padR = 60, padT = 20, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const full = data.full as { time: string; close: number }[];
    if (!full.length) return null;
    const nReal = data.bars_real as number;

    const closes = full.map((p) => p.close);
    const yMax = Math.max(...closes) * 1.002;
    const yMin = Math.min(...closes) * 0.998;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;
    const x = (i: number) => padL + (i / (full.length - 1)) * plotW;
    const timeIndex: Record<string, number> = {};
    full.forEach((p, i) => (timeIndex[p.time] = i));

    // Ticks de hora (7)
    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((full.length - 1) * (k / 6));
      return { i, time: full[i].time };
    });

    const boundaryX = x(Math.max(0, nReal - 1));   // frontera real|predicho

    const eReal = data.elliott_real || {};
    const eFull = data.elliott_full || {};
    const zzFull = (eFull.zigzag || []) as any[];
    const wavesReal = eReal.elliott?.found ? eReal.elliott.points.filter((w: any) => w.label !== "0") : [];
    const wavesFull = eFull.elliott?.found ? eFull.elliott.points.filter((w: any) => w.label !== "0") : [];
    const abcFull = eFull.abc?.found ? eFull.abc.points : [];

    // Rutas real (0..nReal-1) y predicho (nReal-1..end)
    const realPath = full.slice(0, nReal).map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.close)}`).join(" ");
    const predPath = full.slice(Math.max(0, nReal - 1)).map((p, k) => {
      const i = (nReal - 1) + k; return `${k === 0 ? "M" : "L"} ${x(i)} ${y(p.close)}`;
    }).join(" ");

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}>
        {/* Eje Y */}
        {Array.from({ length: 5 }).map((_, k) => {
          const p = yMin + (yMax - yMin) * (k / 4);
          return (<g key={k}>
            <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="#f2f2f2" />
            <text x={W - padR + 4} y={y(p) + 3} fontSize={10} fill="#999">{p.toFixed(2)}</text>
          </g>);
        })}
        {/* Eje X (horas) */}
        {xticks.map((t, k) => (
          <text key={k} x={x(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">{hm(t.time)}</text>
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="#bbb">Hora ({fecha(full[0].time)})</text>

        {/* Frontera "ahora" */}
        <line x1={boundaryX} x2={boundaryX} y1={padT} y2={H - padB} stroke="#e67e22" strokeDasharray="4 3" opacity={0.7} />
        <text x={boundaryX} y={padT - 4} fontSize={9} fill="#e67e22" textAnchor="middle">ahora</text>

        {/* ZigZag de la sesión completa (tenue) */}
        {showElliott && zzFull.length > 1 && (
          <path d={zzFull.map((z: any, i: number) => `${i === 0 ? "M" : "L"} ${x(timeIndex[z.time] ?? 0)} ${y(z.price)}`).join(" ")}
                fill="none" stroke="#8e44ad" strokeWidth={1} opacity={0.35} />
        )}

        {/* Curva REAL (sólida oscura) */}
        <path d={realPath} fill="none" stroke="#111" strokeWidth={2.2} />
        {/* Curva PREDICHA (punteada naranja) */}
        <path d={predPath} fill="none" stroke="#e67e22" strokeWidth={2} strokeDasharray="5 4" />

        {/* Elliott sobre la sesión COMPLETA (real+predicha) — naranja, hueco */}
        {showElliott && wavesFull.map((w: any, k: number) => {
          const i = timeIndex[w.time]; if (i == null) return null;
          return (<g key={`f${k}`}>
            <circle cx={x(i)} cy={y(w.price)} r={5} fill="none" stroke="#e67e22" strokeWidth={2} />
            <text x={x(i)} y={y(w.price) - 9} fontSize={12} fontWeight={700} fill="#e67e22" textAnchor="middle">{w.label}</text>
          </g>);
        })}
        {showElliott && abcFull.map((w: any, k: number) => {
          const i = timeIndex[w.time]; if (i == null) return null;
          return (<text key={`abc${k}`} x={x(i)} y={y(w.price) + 16} fontSize={12} fontWeight={700} fill="#d35400" textAnchor="middle">{w.label}</text>);
        })}

        {/* Elliott sobre las barras REALES — morado sólido (encima) */}
        {showElliott && wavesReal.map((w: any, k: number) => {
          const i = timeIndex[w.time]; if (i == null) return null;
          return (<g key={`r${k}`}>
            <circle cx={x(i)} cy={y(w.price)} r={4} fill="#8e44ad" />
            <text x={x(i)} y={y(w.price) - 9} fontSize={12} fontWeight={800} fill="#8e44ad" textAnchor="middle">{w.label}</text>
          </g>);
        })}
      </svg>
    );
  }

  const ell = data?.elliott_full?.elliott;

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
        {lastCalc && <span style={{ fontSize: 11, color: "#999" }}>Calculado {lastCalc}</span>}
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {!data && !loading && !error && (
        <div style={{ padding: "56px 20px", textAlign: "center", background: "#f7f9fb",
                      borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🕐</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>Elige un ticker y pulsa «↻ Calcular»</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Proyecta el resto de la sesión (barras de 15 min) y superpone Elliott.</div>
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong></span>
            <span>📅 Sesión: <strong>{fecha(data.full[0].time)}</strong></span>
            <span>Último real: <strong>${data.last_real_close}</strong></span>
            <span style={{ color: "#666" }}>{data.bars_real} reales · {data.bars_predicted} predichas</span>
            {ell?.found && <span style={{ color: "#e67e22" }}>🌊 Elliott 1-5 {ell.tentative ? "(tentativo)" : `(${ell.confidence}%)`}</span>}
          </div>

          {render()}

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#111" }}>— sesión real</span>
            <span style={{ color: "#e67e22" }}>— predicción del resto</span>
            <span style={{ color: "#8e44ad" }}>● Elliott (real)</span>
            <span style={{ color: "#e67e22" }}>◯ Elliott (sesión proyectada)</span>
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>ⓘ {data.note}</p>
        </>
      )}
    </div>
  );
}
