"use client";

/**
 * IntradayChart.tsx — Velas + Elliott + ZONAS DE TRADING + Premarket
 * ==================================================================
 * ✅ Eje X con hora + fecha de sesión
 * ✅ Ondas de Elliott (0-5) + ZigZag sobre las velas
 * ✅ NUEVO: zona de ENTRADA (banda), STOP LOSS (rojo) y TAKE PROFIT 1/2 (verde),
 *    derivados de Elliott+Fibonacci (campo "trade_setup" de /intraday).
 * ✅ NUEVO: panel PREMARKET (GET /premarket) — objetivo diario de XGBoost y MLP
 *    anclado al precio premarket, con confirmación/contradicción.
 *
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
  const [showLevels, setShowLevels] = useState(true);
  const [data, setData] = useState<any>(null);
  const [pm, setPm] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const [iRes, pRes] = await Promise.all([
        fetch(`${API_URL}/intraday?ticker=${ticker}&interval=${interval}&days=${days}`),
        fetch(`${API_URL}/premarket?ticker=${ticker}`),
      ]);
      if (!iRes.ok) throw new Error((await iRes.json()).detail || "Error API intradía");
      setData(await iRes.json());
      setPm(pRes.ok ? await pRes.json() : null);
    } catch (e: any) { setError(e.message); setData(null); setPm(null); }
    finally { setLoading(false); }
  }

  const W = 940, H = 480, padL = 50, padR = 70, padT = 20, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function render() {
    const candles = data.candles_ohlc as any[];
    if (!candles.length) return null;
    const setup = data.trade_setup;
    // rango Y incluye niveles de trading para que quepan
    const extra: number[] = [];
    if (setup?.found) {
      extra.push(setup.stop_loss, ...setup.take_profit, ...setup.entry_zone);
    }
    const yMax = Math.max(...candles.map((c) => c.high), ...extra) * 1.002;
    const yMin = Math.min(...candles.map((c) => c.low), ...extra) * 0.998;
    const y = (p: number) => padT + (yMax - p) / (yMax - yMin) * plotH;
    const cw = plotW / candles.length;
    const x = (i: number) => padL + i * cw + cw / 2;
    const tIndex: Record<string, number> = {};
    candles.forEach((c, i) => (tIndex[c.time] = i));

    const support = data.chartism.support || [];
    const resistance = data.chartism.resistance || [];
    const patterns = data.price_action || [];
    const breakouts = data.chartism.breakouts || [];
    const ell = data.elliott || {};
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

        {/* ===== ZONAS DE TRADING (entrada / SL / TP) ===== */}
        {showLevels && setup?.found && (() => {
          const ez = setup.entry_zone, tp = setup.take_profit, sl = setup.stop_loss;
          const yEzTop = y(Math.max(ez[0], ez[1])), yEzBot = y(Math.min(ez[0], ez[1]));
          return (
            <g>
              {/* Zona de entrada (banda azul) */}
              <rect x={padL} y={yEzTop} width={plotW} height={Math.max(yEzBot - yEzTop, 2)}
                    fill="#2980b9" fillOpacity={0.12} />
              <text x={W - padR + 4} y={(yEzTop + yEzBot) / 2 + 3} fontSize={9} fill="#2980b9">ENTRADA</text>
              {/* Stop loss (rojo) */}
              <line x1={padL} x2={W - padR} y1={y(sl)} y2={y(sl)} stroke="#c0392b" strokeWidth={1.5} strokeDasharray="6 3" />
              <text x={W - padR + 4} y={y(sl) + 3} fontSize={9} fill="#c0392b">SL {sl}</text>
              {/* Take profit 1 y 2 (verde) */}
              {tp.map((v: number, k: number) => (
                <g key={k}>
                  <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#1e824c" strokeWidth={1.3} strokeDasharray="6 3" />
                  <text x={W - padR + 4} y={y(v) + 3} fontSize={9} fill="#1e824c">TP{k + 1} {v}</text>
                </g>
              ))}
            </g>
          );
        })()}

        {support.map((s: any, k: number) => (
          <line key={`s${k}`} x1={padL} x2={W - padR} y1={y(s.level)} y2={y(s.level)} stroke="#1e824c" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.4} />
        ))}
        {resistance.map((r: any, k: number) => (
          <line key={`r${k}`} x1={padL} x2={W - padR} y1={y(r.level)} y2={y(r.level)} stroke="#c0392b" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.4} />
        ))}

        {/* Velas */}
        {candles.map((c, i) => {
          const up = c.close >= c.open; const col = up ? "#1e824c" : "#c0392b";
          const bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close));
          return (<g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1} />
            <rect x={x(i) - cw * 0.3} y={bt} width={cw * 0.6} height={Math.max(bb - bt, 1)} fill={col}>
              <title>{`${hm(c.time)}  O:${c.open} H:${c.high} L:${c.low} C:${c.close}`}</title>
            </rect>
          </g>);
        })}

        {/* Elliott */}
        {showElliott && zz.length > 1 && (
          <path d={zz.map((z: any, i: number) => `${i === 0 ? "M" : "L"} ${x(tIndex[z.time] ?? 0)} ${y(z.price)}`).join(" ")}
                fill="none" stroke="#8e44ad" strokeWidth={1.3} opacity={0.7} />
        )}
        {showElliott && waves.map((w: any, k: number) => {
          const i = tIndex[w.time]; if (i == null) return null;
          return (<g key={`w${k}`}>
            <circle cx={x(i)} cy={y(w.price)} r={4} fill="#8e44ad" />
            <text x={x(i)} y={y(w.price) - 9} fontSize={13} fontWeight={700} fill="#8e44ad" textAnchor="middle">{w.label}</text>
          </g>);
        })}

        {patterns.map((p: any, k: number) => {
          const i = tIndex[p.time]; if (i == null) return null;
          const m = BIAS_MARK[p.bias] || BIAS_MARK.indecision;
          const yy = p.bias === "bajista" ? y(candles[i].high) - 8 : y(candles[i].low) + 14;
          return (<text key={`p${k}`} x={x(i)} y={yy} fontSize={11} fill={m.color} textAnchor="middle"><title>{`${hm(p.time)} · ${p.pattern}`}</title>{m.sym}</text>);
        })}
        {breakouts.map((b: any, k: number) => {
          const i = tIndex[b.time]; if (i == null) return null;
          const bull = b.type.includes("alcista");
          return (<circle key={`b${k}`} cx={x(i)} cy={y(b.price)} r={4} fill="none" stroke={bull ? "#1e824c" : "#c0392b"} strokeWidth={2}><title>{`${b.type} @ ${b.level}`}</title></circle>);
        })}
      </svg>
    );
  }

  const sessionDate = data?.candles_ohlc?.length ? fecha(data.candles_ohlc[0].time) : null;
  const setup = data?.trade_setup;

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
          <input type="number" value={days} min={1} max={10} onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: 8, width: 70, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Analizar intradía"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={showElliott} onChange={(e) => setShowElliott(e.target.checked)} /> Elliott
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} /> Niveles
        </label>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span><strong>{data.ticker}</strong> · ${data.last_price}</span>
            {sessionDate && <span>📅 {sessionDate}</span>}
            <span>Tendencia: <strong>{data.chartism.structure.trend}</strong></span>
            {data.elliott?.elliott?.found && <span style={{ color: "#8e44ad" }}>🌊 Elliott {data.elliott.elliott.confidence}%</span>}
          </div>

          {render()}

          {/* ===== Tarjeta de setup operativo ===== */}
          {setup?.found ? (
            <div style={{ marginTop: 14, padding: 14, background: "#f7f9fb", borderRadius: 8, borderLeft: "4px solid #2980b9" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                🎯 Setup operativo ({setup.direction === "long" ? "LARGO" : "CORTO"}) · {setup.phase.replace(/_/g, " ")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <Box label="Entrada" value={`$${setup.entry_zone[0]} – $${setup.entry_zone[1]}`} color="#2980b9" />
                <Box label="Stop Loss" value={`$${setup.stop_loss}`} color="#c0392b" />
                <Box label="Take Profit" value={`$${setup.take_profit[0]} / $${setup.take_profit[1]}`} color="#1e824c" />
                <Box label="Riesgo/Beneficio" value={`1 : ${setup.risk_reward}`} color="#111" />
              </div>
              <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>{setup.rationale}</p>
              <p style={{ fontSize: 11, color: "#b8860b", marginTop: 4 }}>⚠️ Guía educativa basada en Elliott+Fibonacci; no es recomendación de inversión.</p>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#999", marginTop: 10 }}>Sin setup operativo claro en esta sesión (estructura insuficiente).</p>
          )}

          {/* ===== Panel PREMARKET ===== */}
          <PremarketPanel pm={pm} />

          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            <span style={{ color: "#2980b9" }}>▮ zona entrada</span>
            <span style={{ color: "#c0392b" }}>— stop loss</span>
            <span style={{ color: "#1e824c" }}>— take profit</span>
            <span style={{ color: "#8e44ad" }}>● ondas Elliott</span>
          </div>
        </>
      )}
    </div>
  );
}

function Box({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 10, background: "#fff", borderRadius: 6, border: "1px solid #eee" }}>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function PremarketPanel({ pm }: { pm: any }) {
  if (!pm) return null;
  const m = pm.models || {};
  const badge = (c: string | null) =>
    c === "confirma" ? { t: "✓ confirma", col: "#1e824c" }
      : c === "contradice" ? { t: "✗ contradice", col: "#c0392b" }
        : { t: "— neutral", col: "#888" };
  return (
    <div style={{ marginTop: 14, padding: 14, background: "#fffdf6", borderRadius: 8, borderLeft: "4px solid #f39c12" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        🌅 Premarket → objetivo del día {pm.premarket_available ? "" : "(sin sesión premarket activa)"}
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap", marginBottom: 8 }}>
        <span>Cierre previo: <b>${pm.prev_close}</b> ({pm.prev_date})</span>
        {pm.premarket_available && <span>Premarket: <b>${pm.premarket_last}</b> · gap <b style={{ color: (pm.gap_pct ?? 0) >= 0 ? "#1e824c" : "#c0392b" }}>{pm.gap_pct >= 0 ? "+" : ""}{pm.gap_pct}%</b></span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {(["xgb", "mlp"] as const).map((k) => {
          const t = m[k];
          const title = k === "xgb" ? "XGBoost" : "Red Neuronal (MLP)";
          const color = k === "xgb" ? "#e67e22" : "#16a085";
          if (!t) return <div key={k} style={{ padding: 10, background: "#fff", borderRadius: 6, border: "1px solid #eee", borderLeft: `4px solid ${color}` }}>
            <b>{title}</b><div style={{ fontSize: 12, color: "#999" }}>Sin modelo entrenado</div></div>;
          const b = badge(t.confirmation);
          return (
            <div key={k} style={{ padding: 10, background: "#fff", borderRadius: 6, border: "1px solid #eee", borderLeft: `4px solid ${color}` }}>
              <div style={{ fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: 13 }}>Objetivo día: <b>${t.target_price}</b> ({t.pct >= 0 ? "+" : ""}{t.pct}%)</div>
              {pm.premarket_available && <div style={{ fontSize: 12, color: b.col }}>Premarket {b.t}</div>}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>ⓘ {pm.note}</p>
    </div>
  );
}
