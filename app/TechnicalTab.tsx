"use client";

/**
 * TechnicalTab.tsx — 4ª sección: Análisis técnico mixto (diario × predicción)
 * ===========================================================================
 * Combina histórico + predicción XGBoost y superpone:
 *   - ZigZag (estructura de swings)
 *   - Ondas de Elliott (candidato 1-2-3-4-5, EXPERIMENTAL) con etiquetas
 *   - Fibonacci (retrocesos y extensiones del último swing)
 *   - Medias móviles (SMA20/50/200) y línea de tendencia
 *
 * SVG nativo para poder dibujar etiquetas de onda y líneas Fibonacci libremente.
 * Fuente: GET /technical?ticker=NVDA&horizon=20&zigzag=0.03
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

export default function TechnicalTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [zz, setZz] = useState(0.03);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/technical?ticker=${ticker}&horizon=20&zigzag=${zz}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      setData(await res.json());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  const W = 940, H = 460, padL = 46, padR = 70, padT = 20, padB = 54;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const hist = data.history as any[];
    const pred = data.prediction as any[];
    const all = [
      ...hist.map((h) => ({ date: h.date, price: h.close, kind: "h" })),
      ...pred.map((p) => ({ date: p.date, price: p.close, kind: "p" })),
    ];
    if (!all.length) return null;

    const prices = all.map((d) => d.price);
    const fib = data.fibonacci || {};
    const extra = [fib.swing_low, fib.swing_high,
      ...Object.values(fib.retracements || {}),
      ...Object.values(fib.extensions || {})].filter((x) => typeof x === "number") as number[];
    const yMax = Math.max(...prices, ...extra) * 1.01;
    const yMin = Math.min(...prices, ...extra) * 0.99;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;
    const x = (i: number) => padL + (i / (all.length - 1)) * plotW;
    const dateIndex: Record<string, number> = {};
    all.forEach((d, i) => (dateIndex[d.date] = i));

    const splitIdx = hist.length - 1; // frontera histórico/predicción

    // Ticks de fecha en X (6 etiquetas)
    const xticks = Array.from({ length: 6 }).map((_, k) => {
      const i = Math.round((all.length - 1) * (k / 5));
      return { i, date: all[i].date };
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
        {/* Eje X con FECHAS */}
        {xticks.map((t, k) => (
          <g key={k}>
            <line x1={x(t.i)} x2={x(t.i)} y1={padT} y2={H - padB} stroke="#f7f7f7" />
            <text x={x(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">{t.date}</text>
          </g>
        ))}

        {/* Niveles Fibonacci (retrocesos) */}
        {Object.entries(fib.retracements || {}).map(([lvl, val]: any, k) => (
          <g key={`f${k}`}>
            <line x1={padL} x2={W - padR} y1={y(val)} y2={y(val)}
                  stroke="#b8860b" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.7} />
            <text x={padL + 2} y={y(val) - 2} fontSize={8} fill="#b8860b">Fib {lvl} · {val}</text>
          </g>
        ))}

        {/* Línea de tendencia */}
        {data.trendline && (() => {
          const a = dateIndex[data.trendline.start.date] ?? 0;
          const b = dateIndex[data.trendline.end.date] ?? splitIdx;
          return <line x1={x(a)} y1={y(data.trendline.start.price)}
                       x2={x(b)} y2={y(data.trendline.end.price)}
                       stroke="#3498db" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.7} />;
        })()}

        {/* Frontera histórico/predicción */}
        <line x1={x(splitIdx)} x2={x(splitIdx)} y1={padT} y2={H - padB}
              stroke="#ccc" strokeDasharray="3 3" />
        <text x={x(splitIdx)} y={padT - 4} fontSize={9} fill="#aaa" textAnchor="middle">hoy</text>

        {/* Serie histórica */}
        <path d={hist.map((h, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(h.close)}`).join(" ")}
              fill="none" stroke="#111" strokeWidth={1.8} />
        {/* Serie predicción */}
        <path d={pred.map((p, i) => `${i === 0 ? "M" : "L"} ${x(splitIdx + i)} ${y(p.close)}`).join(" ")}
              fill="none" stroke="#e67e22" strokeWidth={1.8} strokeDasharray="5 4" />

        {/* ZigZag */}
        {data.zigzag?.length > 1 && (
          <path d={data.zigzag.map((z: any, i: number) =>
            `${i === 0 ? "M" : "L"} ${x(dateIndex[z.date] ?? 0)} ${y(z.price)}`).join(" ")}
            fill="none" stroke="#9b59b6" strokeWidth={1} opacity={0.5} />
        )}

        {/* Ondas de Elliott */}
        {data.elliott?.found && data.elliott.points.map((pt: any, k: number) => {
          const i = dateIndex[pt.date];
          if (i == null) return null;
          return (
            <g key={`e${k}`}>
              <circle cx={x(i)} cy={y(pt.price)} r={3} fill="#c0392b" />
              <text x={x(i)} y={y(pt.price) - 8} fontSize={12} fontWeight={700}
                    fill="#c0392b" textAnchor="middle">{pt.label}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 90, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Sensibilidad ZigZag</div>
          <select value={zz} onChange={(e) => setZz(Number(e.target.value))}
            style={{ padding: 9, border: "1px solid #ddd", borderRadius: 6 }}>
            <option value={0.02}>2% (más ondas)</option>
            <option value={0.03}>3% (equilibrado)</option>
            <option value={0.05}>5% (solo grandes)</option>
          </select>
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Analizar técnico"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 14, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong> · ${data.last_close}</span>
            {data.trendline && <span>Tendencia: <strong>{data.trendline.direction}</strong></span>}
            {data.moving_averages?.sma20 && <span>SMA20: {data.moving_averages.sma20}</span>}
            {data.moving_averages?.sma50 && <span>SMA50: {data.moving_averages.sma50}</span>}
            {data.moving_averages?.sma200 && <span>SMA200: {data.moving_averages.sma200}</span>}
          </div>

          {render()}

          {/* Leyenda */}
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#111" }}>— histórico</span>
            <span style={{ color: "#e67e22" }}>— predicción XGBoost</span>
            <span style={{ color: "#9b59b6" }}>— ZigZag</span>
            <span style={{ color: "#b8860b" }}>— Fibonacci</span>
            <span style={{ color: "#3498db" }}>— tendencia</span>
            <span style={{ color: "#c0392b" }}>● ondas Elliott (0–5)</span>
          </div>

          {/* Panel Elliott */}
          <div style={{ marginTop: 14, padding: 12, background: "#f7f7f8", borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              🌊 Ondas de Elliott (experimental)
            </div>
            {data.elliott?.found ? (
              <div style={{ fontSize: 13 }}>
                Candidato de impulso <strong>{data.elliott.direction}</strong> ·
                confianza <strong>{data.elliott.confidence}%</strong>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Reglas: R1 (onda 2 &lt;100%) {data.elliott.rules["R1_wave2<100%"] ? "✓" : "✗"} ·
                  R2 (onda 3 no la más corta) {data.elliott.rules["R2_wave3_not_shortest"] ? "✓" : "✗"} ·
                  R3 (onda 4 sin solape) {data.elliott.rules["R3_wave4_no_overlap"] ? "✓" : "✗"}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#888" }}>
                {data.elliott?.reason || "Sin candidato válido en la ventana reciente."}
              </div>
            )}
          </div>

          {/* Fibonacci */}
          {data.fibonacci?.retracements && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
              <strong>Fibonacci ({data.fibonacci.direction})</strong> · swing {data.fibonacci.swing_low}–{data.fibonacci.swing_high}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                {Object.entries(data.fibonacci.retracements).map(([k, v]: any) => (
                  <span key={k} style={{ padding: "2px 8px", background: "#fff8e1", borderRadius: 4 }}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
            ⚠️ {data.disclaimer}
          </p>
        </>
      )}
    </div>
  );
}
