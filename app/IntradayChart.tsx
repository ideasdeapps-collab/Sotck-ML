"use client";

/**
 * IntradayChart.tsx — Velas intradía + chartismo + price action + ELLIOTT
 * =======================================================================
 * ✅ Eje X con hora + fecha de sesión
 * ✅ NUEVO: superpone ondas de Elliott (0-1-2-3-4-5) y línea ZigZag calculadas
 *    sobre las velas intradía (campo "elliott" del endpoint /intraday).
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

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });

export default function IntradayChart() {
  const [ticker, setTicker] = useState("NVDA");
  const [interval, setIntervalMin] = useState(15);
  const [days, setDays] = useState(1);
  const [showElliott, setShowElliott] = useState(true);
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

  const W = 940, H = 480, padL = 50, padR = 60, padT = 20, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const candles = data.candles_ohlc as any[];
    if (!candles.length) return null;
    const yMax = Math.max(...candles.map((c) => c.high)) * 1.001;
    const yMin = Math.min(...candles.map((c) => c.low)) * 0.999;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;
    const cw = plotW / candles.length;
    const x = (i: number) => padL + i * cw + cw / 2;
    const tIndex: Record<string, number> = {};
    candles.forEach((c, i) => (tIndex[c.time] = i));

    const support = data.chartism.support || [];
    const resistance = data.chartism.resistance || [];
    const patterns = data.price_action || [];
    const breakouts = data.chartism.breakouts || [];
    const ell = data.elliott || {};          // { zigzag, elliott, fibonacci }
    const zz = (ell.zigzag || []) as any[];
    const waves = ell.elliott?.found ? ell.elliott.points : [];

    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((candles.length - 1) * (k / 6));
      return { i, time: candles[i].time };
    });

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}>
        {Array.from({ length: 5 }).map((_, k) => {
          const p = yMin + (yMax - yMin) * (k / 4);
          return (<g key={k}>
            <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="#f2f2f2" />
            <text x={W - padR + 4} y={y(p) + 3} fontSize={10} fill="#999">{p.toFixed(2)}</text>
          </g>);
        })}
        {xticks.map((t, k) => (
          <text key={k} x={x(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">{hm(t.time)}</text>
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="#bbb">Hora ({fecha(candles[0].time)})</text>

        {support.map((s: any, k: number) => (
          <line key={`s${k}`} x1={padL} x2={W - padR} y1={y(s.level)} y2={y(s.level)}
                stroke="#1e824c" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
        ))}
        {resistance.map((r: any, k: number) => (
          <line key={`r${k}`} x1={padL} x2={W - padR} y1={y(r.level)} y2={y(r.level)}
                stroke="#c0392b" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
        ))}

        {/* Velas */}
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const col = up ? "#1e824c" : "#c0392b";
          const bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close));
          return (<g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1} />
            <rect x={x(i) - cw * 0.3} y={bt} width={cw * 0.6} height={Math.max(bb - bt, 1)} fill={col}>
              <title>{`${hm(c.time)}  O:${c.open} H:${c.high} L:${c.low} C:${c.close}`}</title>
            </rect>
          </g>);
        })}

        {/* ===== ELLIOTT (ZigZag + ondas 0-5) ===== */}
        {showElliott && zz.length > 1 && (
          <path d={zz.map((z: any, i: number) => {
            const idx = tIndex[z.time]; return `${i === 0 ? "M" : "L"} ${x(idx ?? 0)} ${y(z.price)}`;
          }).join(" ")} fill="none" stroke="#8e44ad" strokeWidth={1.3} opacity={0.7} />
        )}
        {showElliott && waves.map((w: any, k: number) => {
          const i = tIndex[w.time]; if (i == null) return null;
          return (<g key={`w${k}`}>
            <circle cx={x(i)} cy={y(w.price)} r={4} fill="#8e44ad" />
            <text x={x(i)} y={y(w.price) - 9} fontSize={13} fontWeight={700} fill="#8e44ad" textAnchor="middle">{w.label}</text>
          </g>);
        })}

        {/* Price action */}
        {patterns.map((p: any, k: number) => {
          const i = tIndex[p.time]; if (i == null) return null;
          const m = BIAS_MARK[p.bias] || BIAS_MARK.indecision;
          const yy = p.bias === "bajista" ? y(candles[i].high) - 8 : y(candles[i].low) + 14;
          return (<text key={`p${k}`} x={x(i)} y={yy} fontSize={11} fill={m.color} textAnchor="middle">
            <title>{`${hm(p.time)} · ${p.pattern} (${p.bias})`}</title>{m.sym}</text>);
        })}
        {breakouts.map((b: any, k: number) => {
          const i = tIndex[b.time]; if (i == null) return null;
          const bull = b.type.includes("alcista");
          return (<circle key={`b${k}`} cx={x(i)} cy={y(b.price)} r={4} fill="none"
            stroke={bull ? "#1e824c" : "#c0392b"} strokeWidth={2}>
            <title>{`${hm(b.time)} · ${b.type} @ ${b.level}`}</title></circle>);
        })}
      </svg>
    );
  }

  const sessionDate = data?.candles_ohlc?.length ? fecha(data.candles_ohlc[0].time) : null;
  const ellFound = data?.elliott?.elliott?.found;

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
          style={{ padding: "10px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Analizar intradía"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={showElliott} onChange={(e) => setShowElliott(e.target.checked)} />
          Mostrar Elliott
        </label>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong> · ${data.last_price}</span>
            {sessionDate && <span>📅 Sesión: <strong>{sessionDate}</strong></span>}
            <span>Tendencia: <strong>{data.chartism.structure.trend}</strong></span>
            {data.session_vwap && <span>VWAP: ${data.session_vwap}</span>}
            {ellFound && <span style={{ color: "#8e44ad" }}>🌊 Elliott: impulso {data.elliott.elliott.confidence}%</span>}
          </div>

          {render()}

          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#1e824c" }}>▲ alcista</span>
            <span style={{ color: "#c0392b" }}>▼ bajista</span>
            <span style={{ color: "#f39c12" }}>◆ indecisión</span>
            <span style={{ color: "#8e44ad" }}>● ondas Elliott (0–5) + ZigZag</span>
            <span>◯ breakout</span>
          </div>

          {ellFound && (
            <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
              🌊 Conteo experimental. Reglas: R1 {data.elliott.elliott.rules["R1_wave2<100%"] ? "✓" : "✗"} ·
              R2 {data.elliott.elliott.rules["R2_wave3_not_shortest"] ? "✓" : "✗"} ·
              R3 {data.elliott.elliott.rules["R3_wave4_no_overlap"] ? "✓" : "✗"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
