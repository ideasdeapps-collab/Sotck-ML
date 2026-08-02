"use client";

/**
 * IntradayChart.tsx
 * -----------------
 * Curva INTRADÍA con CHARTISMO + PRICE ACTION.
 * Fuente: GET /intraday?ticker=NVDA&interval=5&days=1
 *
 * Dibuja (SVG nativo, sin librerías de velas):
 *   - Velas japonesas (verde/rojo)
 *   - Líneas horizontales de soporte (verde) y resistencia (rojo)
 *   - Marcadores de patrones de price action (▲ alcista, ▼ bajista, ◆ indecisión)
 *   - Marcadores de breakout con volumen
 *   - Etiqueta de estructura de mercado (tendencia) y VWAP
 *
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
type Level = { level: number; touches: number };
type Pattern = { time: string; pattern: string; bias: string };
type Breakout = { time: string; type: string; level: number; price: number };

const BIAS_MARK: Record<string, { sym: string; color: string }> = {
  alcista: { sym: "▲", color: "#1e824c" },
  bajista: { sym: "▼", color: "#c0392b" },
  indecision: { sym: "◆", color: "#f39c12" },
};

export default function IntradayChart() {
  const [ticker, setTicker] = useState("NVDA");
  const [interval, setIntervalMin] = useState(5);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `${API_URL}/intraday?ticker=${ticker}&interval=${interval}&days=${days}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      setData(await res.json());
    } catch (e: any) {
      setError(e.message); setData(null);
    } finally {
      setLoading(false);
    }
  }

  // ---- Geometría del SVG ----
  const W = 940, H = 460, padL = 50, padR = 60, padT = 20, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const candles: Candle[] = data.candles_ohlc;
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

    const support: Level[] = data.chartism.support || [];
    const resistance: Level[] = data.chartism.resistance || [];
    const patterns: Pattern[] = data.price_action || [];
    const breakouts: Breakout[] = data.chartism.breakouts || [];

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}>
        {/* Eje Y (precios) */}
        {Array.from({ length: 5 }).map((_, k) => {
          const p = yMin + (yMax - yMin) * (k / 4);
          return (
            <g key={k}>
              <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="#f0f0f0" />
              <text x={W - padR + 4} y={y(p) + 3} fontSize={10} fill="#999">
                {p.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Soportes (verde) y resistencias (rojo) */}
        {support.map((s, k) => (
          <g key={`s${k}`}>
            <line x1={padL} x2={W - padR} y1={y(s.level)} y2={y(s.level)}
                  stroke="#1e824c" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
            <text x={padL + 2} y={y(s.level) - 3} fontSize={9} fill="#1e824c">
              S {s.level.toFixed(2)} ({s.touches})
            </text>
          </g>
        ))}
        {resistance.map((r, k) => (
          <g key={`r${k}`}>
            <line x1={padL} x2={W - padR} y1={y(r.level)} y2={y(r.level)}
                  stroke="#c0392b" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
            <text x={padL + 2} y={y(r.level) - 3} fontSize={9} fill="#c0392b">
              R {r.level.toFixed(2)} ({r.touches})
            </text>
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
                    height={Math.max(bodyBot - bodyTop, 1)} fill={col} />
            </g>
          );
        })}

        {/* Marcadores de price action */}
        {patterns.map((p, k) => {
          const i = timeIndex[p.time];
          if (i == null) return null;
          const m = BIAS_MARK[p.bias] || BIAS_MARK.indecision;
          const yy = p.bias === "bajista"
            ? y(candles[i].high) - 8 : y(candles[i].low) + 14;
          return (
            <text key={`p${k}`} x={x(i)} y={yy} fontSize={11}
                  fill={m.color} textAnchor="middle">
              <title>{`${p.pattern} (${p.bias})`}</title>
              {m.sym}
            </text>
          );
        })}

        {/* Marcadores de breakout */}
        {breakouts.map((b, k) => {
          const i = timeIndex[b.time];
          if (i == null) return null;
          const bull = b.type.includes("alcista");
          return (
            <circle key={`b${k}`} cx={x(i)} cy={y(b.price)} r={4}
                    fill="none" stroke={bull ? "#1e824c" : "#c0392b"} strokeWidth={2}>
              <title>{`${b.type} @ ${b.level}`}</title>
            </circle>
          );
        })}
      </svg>
    );
  }

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
            <span>Tendencia: <strong>{data.chartism.structure.trend}</strong></span>
            {data.session_vwap && <span>VWAP: ${data.session_vwap}</span>}
            <span style={{ color: "#666" }}>{data.candles_ohlc.length} velas de {data.interval_min}m</span>
          </div>

          {render()}

          {/* Leyenda */}
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, flexWrap: "wrap", color: "#555" }}>
            <span style={{ color: "#1e824c" }}>▲ alcista</span>
            <span style={{ color: "#c0392b" }}>▼ bajista</span>
            <span style={{ color: "#f39c12" }}>◆ indecisión (doji)</span>
            <span style={{ color: "#1e824c" }}>— soporte</span>
            <span style={{ color: "#c0392b" }}>— resistencia</span>
            <span>◯ breakout con volumen</span>
          </div>

          {/* Últimos patrones detectados */}
          {data.price_action.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                Últimos patrones de price action:
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {data.price_action.slice(-10).reverse().map((p: Pattern, k: number) => {
                  const m = BIAS_MARK[p.bias] || BIAS_MARK.indecision;
                  return (
                    <span key={k} style={{
                      padding: "4px 8px", background: "#f7f7f8", borderRadius: 6,
                      fontSize: 12, borderLeft: `3px solid ${m.color}` }}>
                      {m.sym} {p.pattern.replace(/_/g, " ")}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
