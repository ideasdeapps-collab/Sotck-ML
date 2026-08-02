"use client";

/**
 * IntradayChart.tsx — Velas intradía + chartismo + price action
 * =============================================================
 * ✅ FIX eje X: ahora muestra la HORA en el eje X y la FECHA DE EVALUACIÓN
 *    (sesión) en el encabezado. Antes el eje X no tenía tiempo indicado.
 *
 * Fuente: GET /intraday?ticker=NVDA&interval=15&days=1
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

const BIAS_MARK: Record<string, { sym: string; color: string }> = {
  alcista: { sym: "▲", color: "#1e824c" },
  bajista: { sym: "▼", color: "#c0392b" },
  indecision: { sym: "◆", color: "#f39c12" },
};

// Formatea ISO -> "HH:MM" en hora local del navegador
function hm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
// Formatea ISO -> "DD MMM YYYY"
function fecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

export default function IntradayChart() {
  const [ticker, setTicker] = useState("NVDA");
  const [interval, setIntervalMin] = useState(15);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/intraday?ticker=${ticker}&interval=${interval}&days=${days}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      setData(await res.json());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  const W = 940, H = 470, padL = 50, padR = 60, padT = 20, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const candles = data.candles_ohlc as any[];
    if (!candles.length) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const yMax = Math.max(...highs) * 1.001;
    const yMin = Math.min(...lows) * 0.999;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;
    const cw = plotW / candles.length;
    const x = (i: number) => padL + i * cw + cw / 2;

    const timeIndex: Record<string, number> = {};
    candles.forEach((c, i) => (timeIndex[c.time] = i));

    const support = data.chartism.support || [];
    const resistance = data.chartism.resistance || [];
    const patterns = data.price_action || [];
    const breakouts = data.chartism.breakouts || [];

    // Ticks de HORA en X (7 etiquetas, detectando cambio de día)
    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((candles.length - 1) * (k / 6));
      return { i, time: candles[i].time };
    });

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
           style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}>
        {/* Eje Y */}
        {Array.from({ length: 5 }).map((_, k) => {
          const p = yMin + (yMax - yMin) * (k / 4);
          return (
            <g key={k}>
              <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="#f2f2f2" />
              <text x={W - padR + 4} y={y(p) + 3} fontSize={10} fill="#999">{p.toFixed(2)}</text>
            </g>
          );
        })}
        {/* Eje X con HORA (✅ el fix) */}
        {xticks.map((t, k) => (
          <g key={k}>
            <line x1={x(t.i)} x2={x(t.i)} y1={padT} y2={H - padB} stroke="#f7f7f7" />
            <text x={x(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">{hm(t.time)}</text>
          </g>
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="#bbb">Hora ({fecha(candles[0].time)})</text>

        {/* Soportes / resistencias */}
        {support.map((s: any, k: number) => (
          <g key={`s${k}`}>
            <line x1={padL} x2={W - padR} y1={y(s.level)} y2={y(s.level)}
                  stroke="#1e824c" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
            <text x={padL + 2} y={y(s.level) - 3} fontSize={9} fill="#1e824c">S {s.level} ({s.touches})</text>
          </g>
        ))}
        {resistance.map((r: any, k: number) => (
          <g key={`r${k}`}>
            <line x1={padL} x2={W - padR} y1={y(r.level)} y2={y(r.level)}
                  stroke="#c0392b" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
            <text x={padL + 2} y={y(r.level) - 3} fontSize={9} fill="#c0392b">R {r.level} ({r.touches})</text>
          </g>
        ))}

        {/* Velas */}
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const col = up ? "#1e824c" : "#c0392b";
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyBot = y(Math.min(c.open, c.close));
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw * 0.3} y={bodyTop} width={cw * 0.6}
                    height={Math.max(bodyBot - bodyTop, 1)} fill={col}>
                <title>{`${hm(c.time)}  O:${c.open} H:${c.high} L:${c.low} C:${c.close}`}</title>
              </rect>
            </g>
          );
        })}

        {/* Marcadores price action */}
        {patterns.map((p: any, k: number) => {
          const i = timeIndex[p.time];
          if (i == null) return null;
          const m = BIAS_MARK[p.bias] || BIAS_MARK.indecision;
          const yy = p.bias === "bajista" ? y(candles[i].high) - 8 : y(candles[i].low) + 14;
          return (
            <text key={`p${k}`} x={x(i)} y={yy} fontSize={11} fill={m.color} textAnchor="middle">
              <title>{`${hm(p.time)} · ${p.pattern} (${p.bias})`}</title>{m.sym}
            </text>
          );
        })}

        {/* Breakouts */}
        {breakouts.map((b: any, k: number) => {
          const i = timeIndex[b.time];
          if (i == null) return null;
          const bull = b.type.includes("alcista");
          return (
            <circle key={`b${k}`} cx={x(i)} cy={y(b.price)} r={4}
                    fill="none" stroke={bull ? "#1e824c" : "#c0392b"} strokeWidth={2}>
              <title>{`${hm(b.time)} · ${b.type} @ ${b.level}`}</title>
            </circle>
          );
        })}
      </svg>
    );
  }

  const sessionDate = data?.candles_ohlc?.length ? fecha(data.candles_ohlc[0].time) : null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 90, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Intervalo</div>
          <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}
            style={{ padding: 9, border: "1px solid #ddd", borderRadius: 6 }}>
            {[1, 5, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Días</div>
          <input type="number" value={days} min={1} max={10}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: 8, width: 70, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Analizar intradía"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong> · ${data.last_price}</span>
            {/* ✅ Fecha de evaluación */}
            {sessionDate && <span>📅 Sesión: <strong>{sessionDate}</strong></span>}
            <span>Tendencia: <strong>{data.chartism.structure.trend}</strong></span>
            {data.session_vwap && <span>VWAP: ${data.session_vwap}</span>}
            <span style={{ color: "#666" }}>{data.candles_ohlc.length} velas de {data.interval_min}m</span>
          </div>

          {render()}

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#1e824c" }}>▲ alcista</span>
            <span style={{ color: "#c0392b" }}>▼ bajista</span>
            <span style={{ color: "#f39c12" }}>◆ indecisión</span>
            <span style={{ color: "#1e824c" }}>— soporte</span>
            <span style={{ color: "#c0392b" }}>— resistencia</span>
            <span>◯ breakout</span>
          </div>
        </>
      )}
    </div>
  );
}
