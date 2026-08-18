"use client";

/**
 * LiveTradingTab.tsx — 🤖 AI Live Trading (monitor en vivo + simulación paper)
 * ============================================================================
 * Une el módulo /ai/* del backend en una sola vista:
 *   • MONITOR EN VIVO  → GET  /quote  +  POST /ai/live-monitor
 *       - Precio en vivo (Polygon, ~15 min de retraso en plan free).
 *       - Señal del agente (BUY/SELL/HOLD) con confianza y razones.
 *       - Portafolio paper acumulado (cash + posiciones + trades).
 *       - Auto-refresh opcional (mínimo 60 s, respeta el rate-limit).
 *   • SIMULACIÓN AI   → POST /ai/simulate-trading-ai
 *       - Capital, días y estrategia (AUTO usa la recomendada).
 *       - Curva de equity, métricas (retorno, win-rate, Sharpe, drawdown),
 *         parámetros optimizados y bitácora de trades.
 *
 * Ticker como desplegable poblado desde /models (igual que los demás tabs).
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";
const MIN_REFRESH_S = 60;

type Mode = "live" | "sim";

const ACTION_COLOR: Record<string, string> = {
  BUY: "#1e824c",
  SELL: "#c0392b",
  HOLD: "#7f8c8d",
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;
const hm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

export default function LiveTradingTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState("");
  const [mode, setMode] = useState<Mode>("live");

  // Simulación
  const [capital, setCapital] = useState(10000);
  const [days, setDays] = useState(30);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [strategy, setStrategy] = useState("AUTO");

  // Estado
  const [live, setLive] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [sim, setSim] = useState<any>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const timer = useRef<any>(null);

  // Poblar tickers + estrategias
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`);
        const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail);
        setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch {
        setError("No se pudo cargar la lista de modelos (/models).");
      }
      try {
        const r = await fetch(`${API_URL}/ai/strategies`);
        if (r.ok) setStrategies((await r.json()).strategies || []);
      } catch {
        /* silencioso: el desplegable usará solo AUTO */
      }
    })();
  }, []);

  // Monitor en vivo (precio + señal + portafolio paper)
  async function monitor(silent = false) {
    if (!ticker) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const [qRes, mRes] = await Promise.all([
        fetch(`${API_URL}/quote?ticker=${ticker}`),
        fetch(`${API_URL}/ai/live-monitor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker }),
        }),
      ]);
      setQuote(qRes.ok ? await qRes.json() : null);
      if (!mRes.ok) throw new Error((await mRes.json()).detail || "Error en /ai/live-monitor");
      setLive(await mRes.json());
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e: any) {
      if (!silent) { setError(e.message); setLive(null); }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Simulación AI paper-trading
  async function simulate() {
    if (!ticker) return;
    setLoading(true); setError(null); setSim(null);
    try {
      const res = await fetch(`${API_URL}/ai/simulate-trading-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, capital, days, strategy }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Error en /ai/simulate-trading-ai");
      setSim(await res.json());
    } catch (e: any) {
      setError(e.message); setSim(null);
    } finally {
      setLoading(false);
    }
  }

  // Auto-refresh solo en modo "live"
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh && mode === "live" && ticker) {
      timer.current = setInterval(() => monitor(true), MIN_REFRESH_S * 1000);
    }
    return () => timer.current && clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, mode, ticker]);

  const signal = live?.signal;
  const portfolio = live?.portfolio;
  const positions = portfolio?.positions ? Object.entries(portfolio.positions) : [];

  const equityData = useMemo(() => {
    const curve: number[] = sim?.equity_curve || [];
    return curve.map((v, i) => ({ i, equity: v }));
  }, [sim]);

  const chg = quote?.change_pct ?? null;
  const up = (quote?.change ?? 0) >= 0;
  const shownPrice = quote?.price ?? live?.price;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      {/* Controles */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#666" }}>
          Ticker
          <br />
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 110, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option>Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        {/* Selector de modo */}
        <div style={{ display: "inline-flex", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          {([["live", "🔴 Monitor en vivo"], ["sim", "🧪 Simulación AI"]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                padding: "9px 14px", border: "none", cursor: "pointer", fontSize: 13,
                background: mode === m ? "#111" : "#fff",
                color: mode === m ? "#fff" : "#555", fontWeight: mode === m ? 700 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "live" ? (
          <>
            <button onClick={() => monitor()} disabled={loading || !ticker}
              style={{ padding: "10px 18px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {loading ? "Analizando…" : "Actualizar señal"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refrescar ({MIN_REFRESH_S}s)
            </label>
          </>
        ) : (
          <>
            <label style={{ fontSize: 12, color: "#666" }}>
              Capital ($)
              <br />
              <input type="number" value={capital} min={100} step={1000}
                onChange={(e) => setCapital(Math.max(100, Number(e.target.value)))}
                style={{ padding: 8, width: 120, border: "1px solid #ddd", borderRadius: 6 }} />
            </label>
            <label style={{ fontSize: 12, color: "#666" }}>
              Días
              <br />
              <input type="number" value={days} min={1} max={365}
                onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value))))}
                style={{ padding: 8, width: 80, border: "1px solid #ddd", borderRadius: 6 }} />
            </label>
            <label style={{ fontSize: 12, color: "#666" }}>
              Estrategia
              <br />
              <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
                style={{ padding: 9, border: "1px solid #ddd", borderRadius: 6 }}>
                <option value="AUTO">AUTO (recomendada)</option>
                {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button onClick={simulate} disabled={loading || !ticker}
              style={{ padding: "10px 18px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {loading ? "Simulando…" : "▶ Ejecutar simulación"}
            </button>
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fdecea", color: "#c0392b", borderRadius: 8, marginBottom: 12 }}>
          ⚠️ {error}
        </div>
      )}

      {/* ---------------- MODO EN VIVO ---------------- */}
      {mode === "live" && live && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#888" }}>{live.ticker} · precio</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{money(shownPrice)}</div>
              {chg != null && (
                <div style={{ fontSize: 13, color: up ? "#1e824c" : "#c0392b" }}>
                  {up ? "▲" : "▼"} {chg.toFixed(2)}%
                </div>
              )}
            </div>
            {signal && (
              <div style={{
                padding: "10px 18px", borderRadius: 10, color: "#fff",
                background: ACTION_COLOR[signal.action] || "#7f8c8d", minWidth: 130,
              }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>Señal del agente</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{signal.action}</div>
                <div style={{ fontSize: 12 }}>confianza {pct(signal.confidence, 0)} · score {signal.score}</div>
              </div>
            )}
            {lastUpdated && <div style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>Actualizado {lastUpdated}</div>}
          </div>

          {signal?.reason?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Razones</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {signal.reason.map((r: string, k: number) => (
                  <span key={k} style={{ fontSize: 12, background: "#eef2f5", padding: "4px 10px", borderRadius: 999 }}>{r}</span>
                ))}
              </div>
            </div>
          )}

          {/* Features técnicas */}
          {live.features && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
              <Stat label="Tendencia" value={live.features.trend ?? "—"} />
              <Stat label="RSI(14)" value={String(live.features.rsi ?? "—")} />
              <Stat label="Vol. ratio" value={String(live.features.volume_ratio ?? "—")} />
              <Stat label="Momentum" value={live.features.momentum != null ? pct(live.features.momentum, 2) : "—"} />
            </div>
          )}

          {/* Portafolio paper */}
          <div style={{ padding: 14, background: "#f7f9fb", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Portafolio paper (acumulado)</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14, marginBottom: 8 }}>
              <span>Cash: <b>{money(portfolio?.cash)}</b></span>
              {portfolio?.equity != null && <span>Equity: <b>{money(portfolio.equity)}</b></span>}
              <span>Posiciones: <b>{positions.length}</b></span>
              <span>Trades: <b>{portfolio?.trades?.length ?? 0}</b></span>
            </div>
            {positions.length > 0 && (
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#888" }}>
                    <th>Ticker</th><th>Shares</th><th>Entrada</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(([tk, p]: any) => (
                    <tr key={tk} style={{ borderTop: "1px solid #eee" }}>
                      <td>{tk}</td>
                      <td>{Number(p.shares).toFixed(4)}</td>
                      <td>{money(p.entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
            ⓘ Señal educativa basada en el agente técnico (ML + tendencia + RSI + volumen). Plan gratuito de Polygon:
            el precio viene diferido ~15 min. No es consejo de inversión.
          </p>
        </>
      )}

      {/* ---------------- MODO SIMULACIÓN ---------------- */}
      {mode === "sim" && sim && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
            <Stat label="Capital inicial" value={money(sim.initial_capital)} />
            <Stat label="Equity final" value={money(sim.final_equity)} />
            <Stat label="Retorno" value={sim.return_pct != null ? `${sim.return_pct}%` : "—"}
              color={(sim.return_pct ?? 0) >= 0 ? "#1e824c" : "#c0392b"} />
            <Stat label="Win-rate" value={sim.win_rate != null ? `${sim.win_rate}%` : "—"} />
            <Stat label="Sharpe" value={String(sim.sharpe_ratio ?? "—")} />
            <Stat label="Max drawdown" value={sim.max_drawdown != null ? `${sim.max_drawdown}%` : "—"} />
            <Stat label="Trades" value={String(sim.total_trades ?? sim.trades?.length ?? 0)} />
          </div>

          {/* Estrategia + parámetros */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8, flex: "1 1 240px" }}>
              <div style={{ fontSize: 12, color: "#888" }}>Estrategia usada</div>
              <div style={{ fontWeight: 700 }}>{sim.strategy}</div>
              {sim.strategy_recommendation && (
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Recomendada: <b>{sim.strategy_recommendation.recommended_strategy}</b>{" "}
                  ({pct(sim.strategy_recommendation.confidence, 0)})
                </div>
              )}
            </div>
            {sim.optimized_parameters && (
              <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8, flex: "1 1 240px" }}>
                <div style={{ fontSize: 12, color: "#888" }}>Parámetros optimizados</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  SL {pct(sim.optimized_parameters.stop_loss, 1)} · TP {pct(sim.optimized_parameters.take_profit, 1)} ·
                  tamaño {pct(sim.optimized_parameters.position_size, 0)}
                </div>
              </div>
            )}
          </div>

          {/* Curva de equity */}
          {equityData.length > 1 && (
            <div style={{ height: 300, marginBottom: 14 }}>
              <ResponsiveContainer>
                <ComposedChart data={equityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="i" tick={{ fontSize: 11 }} label={{ value: "vela", position: "insideBottom", offset: -2, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={70}
                    tickFormatter={(v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
                  <Tooltip formatter={(v: any) => money(v)} labelFormatter={(l) => `Vela ${l}`} />
                  <ReferenceLine y={sim.initial_capital} stroke="#bbb" strokeDasharray="4 3" />
                  <Area type="monotone" dataKey="equity" stroke="#8e44ad" fill="#8e44ad" fillOpacity={0.08} />
                  <Line type="monotone" dataKey="equity" stroke="#8e44ad" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Trades */}
          {sim.trades?.length > 0 && (
            <div style={{ padding: 14, background: "#f7f9fb", borderRadius: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Bitácora de trades ({sim.trades.length})</div>
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "right", color: "#888" }}>
                      <th style={{ textAlign: "left" }}>#</th>
                      <th>Entrada</th><th>Salida</th><th>Resultado</th><th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.trades.map((t: any, k: number) => (
                      <tr key={k} style={{ borderTop: "1px solid #eee", textAlign: "right" }}>
                        <td style={{ textAlign: "left" }}>{k + 1}</td>
                        <td>{money(t.entry)}</td>
                        <td>{money(t.exit)}</td>
                        <td style={{ color: t.result === "WIN" ? "#1e824c" : "#c0392b", fontWeight: 600 }}>{t.result}</td>
                        <td style={{ color: (t.pnl ?? 0) >= 0 ? "#1e824c" : "#c0392b" }}>
                          {(t.pnl ?? 0) >= 0 ? "+" : "-"}{money(Math.abs(t.pnl ?? 0)).slice(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
            ⓘ Simulación paper vela a vela con costos de ejecución y gestión de riesgo (SL/TP + tamaño de posición).
            Resultados pasados no garantizan rendimiento futuro.
          </p>
        </>
      )}

      {/* Estado vacío */}
      {((mode === "live" && !live) || (mode === "sim" && !sim)) && !loading && !error && (
        <div style={{
          padding: "60px 20px", textAlign: "center", background: "#f7f9fb",
          borderRadius: 12, border: "1px dashed #d5dce3", color: "#7f8c8d", marginTop: 8,
        }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5a6b7b" }}>
            {mode === "live" ? "Pulsa «Actualizar señal» para monitorear en vivo" : "Configura y pulsa «Ejecutar simulación»"}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: 12, background: "#f7f7f8", borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color || "#111" }}>{value}</div>
    </div>
  );
}
