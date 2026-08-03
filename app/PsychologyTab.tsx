"use client";

/**
 * PsychologyTab.tsx — Panel de Análisis Psicológico (IPM)
 * =======================================================
 * Muestra el Índice de Psicología de Mercado:
 *   • Oscilador IPM histórico (-100..+100) con bandas euforia/pánico
 *   • Veredicto de zona + ΔIPM
 *   • Los 7 sensores actuales (barras -1..+1)
 *   • Curvas de proyección: Contrarian directa (A) y Aprendida ML (B)
 *
 * Fuente: GET /psychology?ticker=NVDA&horizon=21
 * Env: NEXT_PUBLIC_ML_API_URL
 */

import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Area, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_ML_API_URL || "http://localhost:8000";

const ZONE_COLOR: Record<string, string> = {
  "euforia extrema": "#c0392b", "optimismo": "#e67e22", "neutral": "#7f8c8d",
  "pesimismo": "#27ae60", "pánico extremo": "#1e824c",
};
const SENSOR_LABEL: Record<string, string> = {
  S1: "RSI (miedo/codicia)", S2: "Sentimiento", S3: "Manada (volumen)",
  S4: "Momentum (racha)", S5: "FOMO/capitulación", S6: "Indecisión", S7: "Anclaje a rango",
};

export default function PsychologyTab() {
  const [models, setModels] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [horizon, setHorizon] = useState(21);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/models`); const j = await r.json();
        const avail: string[] = j.available || [];
        setModels(avail); setTicker(avail.includes("NVDA") ? "NVDA" : avail[0] || "");
      } catch { setError("No se pudo cargar la lista de modelos (/models)."); }
    })();
  }, []);

  useEffect(() => { if (ticker) run(ticker); /* eslint-disable-next-line */ }, [ticker]);

  async function run(tk: string) {
    if (!tk) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/psychology?ticker=${tk}&horizon=${horizon}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Error API");
      setData(await res.json());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  const zoneColor = data ? ZONE_COLOR[data.zone] || "#7f8c8d" : "#7f8c8d";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Ticker</div>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ padding: 9, minWidth: 110, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {models.length === 0 && <option value="">Cargando…</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#666" }}>Horizonte (días)</div>
          <input type="number" value={horizon} min={5} max={120}
            onChange={(e) => setHorizon(Number(e.target.value))}
            style={{ padding: 8, width: 120, border: "1px solid #ddd", borderRadius: 6 }} />
        </label>
        <button onClick={() => ticker && run(ticker)} disabled={loading || !ticker}
          style={{ padding: "10px 18px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          {loading ? "Analizando…" : "🧠 Analizar psicología"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b" }}>⚠️ {error}</p>}

      {data && (
        <>
          {/* Veredicto */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 18px", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 18, background: zoneColor }}>
              IPM {data.ipm_now >= 0 ? "+" : ""}{data.ipm_now}
            </div>
            <div style={{ fontSize: 15 }}>Zona: <strong style={{ color: zoneColor }}>{data.zone}</strong></div>
            <div style={{ fontSize: 13, color: "#555" }}>ΔIPM: <b>{data.delta_ipm >= 0 ? "+" : ""}{data.delta_ipm}</b></div>
            <div style={{ fontSize: 13 }}>{data.ticker} · ${data.last_close}</div>
          </div>

          {/* Oscilador IPM histórico */}
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Oscilador IPM (histórico): euforia arriba, pánico abajo.</div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data.ipm_history} margin={{ top: 6, right: 20, bottom: 6, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis domain={[-100, 100]} ticks={[-100, -70, -30, 0, 30, 70, 100]} tick={{ fontSize: 10 }} width={38} />
              <Tooltip />
              {/* Bandas de referencia */}
              <ReferenceLine y={70} stroke="#c0392b" strokeDasharray="4 3" label={{ value: "euforia +70", position: "insideTopRight", fontSize: 9, fill: "#c0392b" }} />
              <ReferenceLine y={-70} stroke="#1e824c" strokeDasharray="4 3" label={{ value: "pánico -70", position: "insideBottomRight", fontSize: 9, fill: "#1e824c" }} />
              <ReferenceLine y={0} stroke="#bbb" />
              <Line dataKey="ipm" stroke="#8e44ad" dot={false} strokeWidth={1.8} name="IPM" />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Sensores actuales */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Sensores psicológicos actuales</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {Object.keys(SENSOR_LABEL).map((k) => {
                const v = data.sensors_last[k] ?? 0;
                const w = data.weights[k];
                const pct = Math.abs(v) * 50; // -1..1 -> 0..50% desde el centro
                const pos = v >= 0;
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <div style={{ width: 150, color: "#555" }}>{SENSOR_LABEL[k]} <span style={{ color: "#aaa" }}>(w{w})</span></div>
                    <div style={{ flex: 1, height: 16, background: "#f2f2f2", borderRadius: 4, position: "relative" }}>
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#ccc" }} />
                      <div style={{ position: "absolute", top: 2, bottom: 2, borderRadius: 3,
                        left: pos ? "50%" : `${50 - pct}%`, width: `${pct}%`,
                        background: pos ? "#27ae60" : "#c0392b" }} />
                    </div>
                    <div style={{ width: 44, textAlign: "right", fontWeight: 600, color: pos ? "#27ae60" : "#c0392b" }}>
                      {v >= 0 ? "+" : ""}{v}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Curvas de proyección psicológica */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Proyección psicológica</div>
            <PsychProjection data={data} />
          </div>

          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>ⓘ {data.note}</p>
        </>
      )}
    </div>
  );
}

function PsychProjection({ data }: { data: any }) {
  const rows: Record<string, any> = {};
  (data.contrarian?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), contrarian: p.close }));
  (data.learned?.curve || []).forEach((p: any) => (rows[p.date] = { ...(rows[p.date] || { date: p.date }), learned: p.close }));
  const series = Object.values(rows).sort((a: any, b: any) => a.date.localeCompare(b.date));
  const hasLearned = !!data.learned?.curve;
  const active = data.contrarian?.active;

  return (
    <>
      {!active && (
        <p style={{ fontSize: 12, color: "#b8860b", marginBottom: 6 }}>
          ⓘ IPM no está en zona extrema (|IPM| &le; {data.contrarian?.theta}); la curva contrarian queda plana (la psicología "calla").
        </p>
      )}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={series} margin={{ top: 6, right: 20, bottom: 6, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
          <Tooltip /><Legend />
          <Line dataKey="contrarian" stroke="#8e44ad" dot={false} strokeWidth={2} name="Contrarian directa (A)" connectNulls />
          {hasLearned && <Line dataKey="learned" stroke="#16a085" dot={false} strokeWidth={2} strokeDasharray="5 4" name="Psicología ML (B)" connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
      {!hasLearned && (
        <p style={{ fontSize: 12, color: "#b8860b", marginTop: 6 }}>
          ⓘ Curva aprendida (B) no disponible: entrena el modelo con <code>train_psych.py --ticker {data.ticker}</code>.
        </p>
      )}
      {hasLearned && data.learned?.predicted_total_return != null && (
        <p style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
          Modelo ML → retorno previsto a horizonte: <b>{(data.learned.predicted_total_return * 100).toFixed(2)}%</b>
        </p>
      )}
    </>
  );
}
