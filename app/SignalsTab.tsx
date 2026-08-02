"use client";

/**
 * SignalsTab.tsx — Señales combinadas (XGBoost diario × estructura intradía)
 * ==========================================================================
 * ✅ FIX eje X: la curva de señal ahora muestra la HORA en el eje X y la
 *    FECHA DE EVALUACIÓN en el encabezado.
 *
 * Fuente: GET /signals?ticker=NVDA&interval=15&days=2
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
const MIN_REFRESH_MIN = 15;

const VERDICT_COLOR: Record<string, string> = {
  "STRONG BUY": "#0b6b3a", "BUY": "#1e824c", "NEUTRAL": "#7f8c8d",
  "SELL": "#c0392b", "STRONG SELL": "#7b241c",
};

function hm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

export default function SignalsTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [interval, setIntervalMin] = useState(15);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const timer = useRef<any>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/signals?ticker=${ticker}&interval=${interval}&days=2`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      setData(await res.json());
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh) timer.current = setInterval(run, MIN_REFRESH_MIN * 60 * 1000);
    return () => timer.current && clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, ticker, interval]);

  const W = 940, H = 260, padL = 40, padR = 20, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  function renderCurve() {
    const curve = data.signal_curve as any[];
    if (!curve.length) return null;
    const scores = curve.map((c) => c.score_ema);
    const yMax = Math.max(2, ...scores) * 1.1;
    const yMin = Math.min(-2, ...scores) * 1.1;
    const y = (v: number) => padT + (yMax - v) / (yMax - yMin) * plotH;
    const x = (i: number) => padL + (i / (curve.length - 1)) * plotW;
    const zeroY = y(0);

    const alerts = (data.alerts || []) as any[];
    const tindex: Record<string, number> = {};
    curve.forEach((c, i) => (tindex[c.time] = i));

    const areaPath = (positive: boolean) => {
      let d = `M ${x(0)} ${zeroY}`;
      curve.forEach((c, i) => {
        const v = positive ? Math.max(c.score_ema, 0) : Math.min(c.score_ema, 0);
        d += ` L ${x(i)} ${y(v)}`;
      });
      d += ` L ${x(curve.length - 1)} ${zeroY} Z`;
      return d;
    };
    const linePath = curve.map((c, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(c.score_ema)}`).join(" ");

    // Ticks de HORA en X (7 etiquetas)
    const xticks = Array.from({ length: 7 }).map((_, k) => {
      const i = Math.round((curve.length - 1) * (k / 6));
      return { i, time: curve[i].time };
    });

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
           style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8 }}>
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#ccc" strokeDasharray="4 3" />
        <text x={padL - 6} y={zeroY + 3} fontSize={9} fill="#999" textAnchor="end">0</text>
        <path d={areaPath(true)} fill="#1e824c" fillOpacity={0.15} />
        <path d={areaPath(false)} fill="#c0392b" fillOpacity={0.15} />
        <path d={linePath} fill="none" stroke="#2c3e50" strokeWidth={1.8} />

        {/* Eje X con HORA (✅ el fix) */}
        {xticks.map((t, k) => (
          <text key={k} x={x(t.i)} y={H - padB + 16} fontSize={10} fill="#888" textAnchor="middle">
            {hm(t.time)}
          </text>
        ))}

        {alerts.map((a, k) => {
          const i = tindex[a.time];
          if (i == null) return null;
          const buy = a.direction === "COMPRA";
          return (
            <g key={k}>
              <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB}
                    stroke={buy ? "#1e824c" : "#c0392b"}
                    strokeWidth={a.aligned_with_daily ? 1.5 : 0.8}
                    strokeDasharray={a.aligned_with_daily ? "0" : "3 3"} opacity={0.5} />
              <text x={x(i)} y={padT + 2} fontSize={11} fill={buy ? "#1e824c" : "#c0392b"} textAnchor="middle">
                <title>{`${hm(a.time)} · ${a.reasons.join(" · ")}`}</title>{buy ? "▲" : "▼"}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const v = data?.verdict;
  const evalDate = data?.signal_curve?.length ? fecha(data.signal_curve[data.signal_curve.length - 1].time) : null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ padding: 8, width: 90, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Intervalo</div>
          <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}
            style={{ padding: 9, border: "1px solid #ddd", borderRadius: 6 }}>
            {[15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <button onClick={run} disabled={loading}
          style={{ padding: "10px 20px", background: "#111", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando..." : "Generar señales"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refrescar (cada {MIN_REFRESH_MIN} min)
        </label>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && v && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 18px", borderRadius: 8, color: "#fff", fontWeight: 700,
              fontSize: 18, background: VERDICT_COLOR[v.label] || "#7f8c8d" }}>{v.label}</div>
            <div style={{ fontSize: 13, color: "#555" }}>Confluencia: <strong>{v.score}</strong></div>
            <div style={{ fontSize: 13 }}>{data.ticker} · ${data.last_price}</div>
            {/* ✅ Fecha de evaluación */}
            {evalDate && <div style={{ fontSize: 13 }}>📅 Sesión: <strong>{evalDate}</strong></div>}
            {lastUpdated && <div style={{ fontSize: 11, color: "#999" }}>Actualizado {lastUpdated}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>SESGO DIARIO (XGBoost)</div>
              <div style={{ fontSize: 15, fontWeight: 600,
                color: data.daily_bias.sign > 0 ? "#1e824c" : data.daily_bias.sign < 0 ? "#c0392b" : "#7f8c8d" }}>
                {data.daily_bias.label} ({data.daily_bias.predicted_next_pct >= 0 ? "+" : ""}
                {data.daily_bias.predicted_next_pct}%)
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                Confianza: {(data.daily_bias.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>ESTRUCTURA INTRADÍA</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{data.intraday_structure.trend}</div>
              <div style={{ fontSize: 11, color: "#888" }}>
                VWAP: {data.session_vwap ? `$${data.session_vwap}` : "—"}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Curva de señal combinada (EMA del score por vela):
          </div>
          {renderCurve()}

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🔔 Alertas ({data.alerts.length})</div>
            {data.alerts.length === 0 && (
              <p style={{ fontSize: 13, color: "#999" }}>Sin breakouts confirmados en la sesión.</p>
            )}
            {data.alerts.map((a: any, k: number) => (
              <div key={k} style={{ padding: 10, marginBottom: 8, borderRadius: 8,
                background: a.aligned_with_daily ? "#eafaf1" : "#fbeeee",
                borderLeft: `4px solid ${a.direction === "COMPRA" ? "#1e824c" : "#c0392b"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <strong style={{ color: a.direction === "COMPRA" ? "#1e824c" : "#c0392b" }}>
                    {a.direction} · fuerza {a.strength}{a.aligned_with_daily && " ✓ alineada con diario"}
                  </strong>
                  <span style={{ fontSize: 11, color: "#888" }}>{new Date(a.time).toLocaleString()}</span>
                </div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#555" }}>
                  {a.reasons.map((r: string, j: number) => <li key={j}>{r}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>ⓘ {data.note}</p>
        </>
      )}
    </div>
  );
}
