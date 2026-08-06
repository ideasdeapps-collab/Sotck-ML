"use client";

/**
 * AnalysisChart.tsx — Gráfica de análisis técnico interactiva (SVG propio)
 * =======================================================================
 * Reemplaza a Recharts para dar CONTROL TOTAL de interacción:
 *
 *   ZOOM / PAN
 *     • Rueda del ratón → zoom hacia el cursor (Shift = solo X, Alt = solo Y)
 *     • Herramienta "pan" (✋) → arrastrar para desplazar
 *     • Herramienta "zoom-caja" (▣) → arrastrar un rectángulo para acercar
 *     • Doble clic o ⟲ → reset a la vista completa
 *
 *   HERRAMIENTAS DE DIBUJO (para análisis propio)
 *     • Tendencia (📈) : línea entre 2 puntos
 *     • Horizontal (➖): soporte/resistencia
 *     • Vertical (↕)   : marca temporal
 *     • Fibonacci (🌀) : arrastra máx→mín → 0/23.6/38.2/50/61.8/78.6/100%
 *     • Rectángulo (▭) : zona de precio
 *     • Borrar (🧽)     : clic sobre un dibujo para eliminarlo
 *   Los dibujos se guardan por 'storageKey' (localStorage) y persisten.
 *
 *   CROSSHAIR con lectura de valores + tooltip del punto más cercano.
 *
 * Uso:
 *   <AnalysisChart data={series} lines={[{key,color,label,width?,dash?}]}
 *                  band={{lowerKey:'bandBase', spanKey:'band', color:'#3498db'}}
 *                  markers={[{date, label, color}]} storageKey={`draw_${ticker}`} />
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

type LineCfg = { key: string; color: string; label: string; width?: number; dash?: string };
type BandCfg = { lowerKey: string; spanKey: string; color: string; label?: string };
type Marker = { date: string; label?: string; color?: string };
type Row = Record<string, any> & { date: string };

type Tool = "cursor" | "pan" | "zoombox" | "trend" | "hline" | "vline" | "fib" | "rect" | "erase";
type Drawing = { id: string; type: Tool; color: string; pts: { i: number; v: number }[] };
type View = { i0: number; i1: number; y0: number; y1: number };

const DRAW_COLORS = ["#111", "#c0392b", "#2980b9", "#1e824c", "#8e44ad", "#e67e22"];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const load = (k: string): Drawing[] => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
const save = (k: string, v: Drawing[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

export default function AnalysisChart({
  data, lines, band, markers = [], height = 460, storageKey,
}: {
  data: Row[]; lines: LineCfg[]; band?: BandCfg; markers?: Marker[];
  height?: number; storageKey: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cw, setCw] = useState(900);
  const ch = height;
  const padL = 54, padR = 16, padT = 14, padB = 30;
  const plotW = cw - padL - padR, plotH = ch - padT - padB;

  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [view, setView] = useState<View | null>(null);      // null = auto
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pan = useRef<{ px: number; py: number; view: View } | null>(null);
  const pinch = useRef<{ d: number; cx: number; cy: number; view: View } | null>(null);
  const [cross, setCross] = useState<{ px: number; py: number } | null>(null);

  const N = data.length;
  const allKeys = useMemo(() => lines.map((l) => l.key), [lines]);

  // Medir ancho real del contenedor (para mapping pixel↔dato 1:1)
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setCw(Math.max(360, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Cargar/guardar dibujos por ticker
  useEffect(() => { setDrawings(load(storageKey)); setView(null); setDraft(null); }, [storageKey]);
  useEffect(() => { save(storageKey, drawings); }, [drawings, storageKey]);

  // Vista automática (fit) a partir de los datos
  const autoView = useMemo<View>(() => {
    const vals: number[] = [];
    data.forEach((r) => allKeys.forEach((k) => { if (r[k] != null) vals.push(r[k]); }));
    if (band) data.forEach((r) => { if (r[band.lowerKey] != null) { vals.push(r[band.lowerKey]); if (r[band.spanKey] != null) vals.push(r[band.lowerKey] + r[band.spanKey]); } });
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
    const pad = (hi - lo) * 0.05 || 1;
    return { i0: 0, i1: Math.max(1, N - 1), y0: lo - pad, y1: hi + pad };
  }, [data, allKeys, band, N]);

  const v = view ?? autoView;

  // Mapeos
  const xToPx = useCallback((i: number) => padL + (i - v.i0) / (v.i1 - v.i0 || 1) * plotW, [v, plotW, padL]);
  const yToPx = useCallback((val: number) => padT + (v.y1 - val) / (v.y1 - v.y0 || 1) * plotH, [v, plotH, padT]);
  const pxToI = (px: number) => v.i0 + (px - padL) / (plotW || 1) * (v.i1 - v.i0);
  const pxToV = (py: number) => v.y1 - (py - padT) / (plotH || 1) * (v.y1 - v.y0);

  const svgXY = (e: React.MouseEvent | WheelEvent) => {
    const rect = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return { px: (e as any).clientX - rect.left, py: (e as any).clientY - rect.top };
  };

  // ---------- ZOOM con rueda ----------
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { px, py } = svgXY(e);
      const ci = pxToI(px), cv = pxToV(py);
      const f = e.deltaY > 0 ? 1.12 : 0.89;
      const onlyX = e.shiftKey, onlyY = e.altKey;
      let { i0, i1, y0, y1 } = v;
      if (!onlyY) { i0 = ci - (ci - i0) * f; i1 = ci + (i1 - ci) * f; }
      if (!onlyX) { y0 = cv - (cv - y0) * f; y1 = cv + (y1 - cv) * f; }
      // límites suaves
      i0 = Math.max(-2, i0); i1 = Math.min(N + 1, i1);
      if (i1 - i0 < 2) return;
      setView({ i0, i1, y0, y1 });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [v, N]); // eslint-disable-line

  // ---------- Ratón: dibujar / pan / zoom-caja ----------
  function down(e: React.MouseEvent) {
    const { px, py } = svgXY(e);
    const p = { i: pxToI(px), v: pxToV(py) };
    if (tool === "erase") { eraseAt(px, py); return; }
    if (tool === "pan") { pan.current = { px, py, view: v }; return; }
    if (tool === "zoombox") { setBox({ x0: px, y0: py, x1: px, y1: py }); return; }
    if (tool === "hline") { commit({ id: uid(), type: "hline", color, pts: [p] }); return; }
    if (tool === "vline") { commit({ id: uid(), type: "vline", color, pts: [p] }); return; }
    if (tool === "trend" || tool === "fib" || tool === "rect") {
      setDraft({ id: uid(), type: tool, color, pts: [p, p] });
    }
  }
  function move(e: React.MouseEvent) {
    const { px, py } = svgXY(e);
    setCross({ px, py });
    if (pan.current) {
      const { px: sx, py: sy, view: sv } = pan.current;
      const di = (px - sx) / (plotW || 1) * (sv.i1 - sv.i0);
      const dv = (py - sy) / (plotH || 1) * (sv.y1 - sv.y0);
      setView({ i0: sv.i0 - di, i1: sv.i1 - di, y0: sv.y0 + dv, y1: sv.y1 + dv });
      return;
    }
    if (box) { setBox({ ...box, x1: px, y1: py }); return; }
    if (draft) {
      const p = { i: pxToI(px), v: pxToV(py) };
      setDraft({ ...draft, pts: [draft.pts[0], p] });
    }
  }
  function up() {
    if (pan.current) { pan.current = null; return; }
    if (box) {
      const { x0, y0, x1, y1 } = box; setBox(null);
      if (Math.abs(x1 - x0) > 8 && Math.abs(y1 - y0) > 8) {
        const i0 = pxToI(Math.min(x0, x1)), i1 = pxToI(Math.max(x0, x1));
        const yTop = pxToV(Math.min(y0, y1)), yBot = pxToV(Math.max(y0, y1));
        setView({ i0, i1, y0: yBot, y1: yTop });
      }
      return;
    }
    if (draft) { commit(draft); setDraft(null); }
  }
  function commit(d: Drawing) { setDrawings((prev) => [...prev, d]); }
  const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // ---------- TÁCTIL (móvil): 1 dedo = pan/dibujo · 2 dedos = pinch-zoom ----------
  const touchXY = (t: React.Touch) => ({ clientX: t.clientX, clientY: t.clientY } as any);
  function touchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const rect = (svgRef.current as SVGSVGElement).getBoundingClientRect();
      pinch.current = {
        d: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        cx: (t1.clientX + t2.clientX) / 2 - rect.left,
        cy: (t1.clientY + t2.clientY) / 2 - rect.top,
        view: v,
      };
      pan.current = null; setDraft(null); setBox(null);
      return;
    }
    if (e.touches.length === 1) down(touchXY(e.touches[0]));
  }
  function touchMove(e: React.TouchEvent) {
    if (pinch.current && e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const nd = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const f = pinch.current.d / (nd || 1);     // separar dedos (nd↑) ⇒ f<1 ⇒ acercar
      const sv = pinch.current.view;
      const ci = sv.i0 + (pinch.current.cx - padL) / (plotW || 1) * (sv.i1 - sv.i0);
      const cv = sv.y1 - (pinch.current.cy - padT) / (plotH || 1) * (sv.y1 - sv.y0);
      let i0 = ci - (ci - sv.i0) * f, i1 = ci + (sv.i1 - ci) * f;
      let y0 = cv - (cv - sv.y0) * f, y1 = cv + (sv.y1 - cv) * f;
      i0 = Math.max(-2, i0); i1 = Math.min(N + 1, i1);
      if (i1 - i0 >= 2) setView({ i0, i1, y0, y1 });
      return;
    }
    if (e.touches.length === 1) move(touchXY(e.touches[0]));
  }
  function touchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinch.current = null;
    if (e.touches.length === 0) { up(); setCross(null); }
  }

  function eraseAt(px: number, py: number) {
    const near = (d: Drawing) => {
      if (d.type === "hline") return Math.abs(yToPx(d.pts[0].v) - py) < 6;
      if (d.type === "vline") return Math.abs(xToPx(d.pts[0].i) - px) < 6;
      const [a, b] = [d.pts[0], d.pts[1] || d.pts[0]];
      const ax = xToPx(a.i), ay = yToPx(a.v), bx = xToPx(b.i), by = yToPx(b.v);
      // distancia punto-segmento
      const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx, qy = ay + t * dy;
      return Math.hypot(px - qx, py - qy) < 7;
    };
    setDrawings((prev) => { const idx = prev.findIndex(near); return idx >= 0 ? prev.filter((_, k) => k !== idx) : prev; });
  }

  // ---------- Construcción de paths ----------
  const linePath = (key: string) => {
    let d = "", started = false;
    for (let i = 0; i < N; i++) {
      const val = data[i][key]; if (val == null) continue;
      const cmd = started ? "L" : "M"; started = true;
      d += `${cmd} ${xToPx(i).toFixed(1)} ${yToPx(val).toFixed(1)} `;
    }
    return d;
  };
  const bandPath = () => {
    if (!band) return "";
    const up: string[] = [], lo: string[] = [];
    for (let i = 0; i < N; i++) {
      const b = data[i][band.lowerKey]; const sp = data[i][band.spanKey];
      if (b == null || sp == null) continue;
      up.push(`${xToPx(i).toFixed(1)} ${yToPx(b + sp).toFixed(1)}`);
      lo.push(`${xToPx(i).toFixed(1)} ${yToPx(b).toFixed(1)}`);
    }
    if (up.length < 2) return "";
    return `M ${up.join(" L ")} L ${lo.reverse().join(" L ")} Z`;
  };

  // Ticks
  const xticks = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    for (let k = 0; k <= 6; k++) {
      const i = Math.round(v.i0 + (v.i1 - v.i0) * (k / 6));
      if (i >= 0 && i < N) out.push({ i, label: data[i]?.date?.slice(5) ?? "" });
    }
    return out;
  }, [v, N, data]);
  const yticks = useMemo(() => Array.from({ length: 5 }, (_, k) => v.y0 + (v.y1 - v.y0) * (k / 4)), [v]);

  // Punto más cercano al crosshair (para tooltip)
  const nearIdx = cross ? Math.round(pxToI(cross.px)) : -1;
  const nearRow = nearIdx >= 0 && nearIdx < N ? data[nearIdx] : null;

  const TOOLS: { id: Tool; icon: string; title: string }[] = [
    { id: "cursor", icon: "✛", title: "Cursor / crosshair" },
    { id: "pan", icon: "✋", title: "Mover (pan)" },
    { id: "zoombox", icon: "▣", title: "Zoom por caja" },
    { id: "trend", icon: "📈", title: "Línea de tendencia" },
    { id: "hline", icon: "➖", title: "Línea horizontal (soporte/resistencia)" },
    { id: "vline", icon: "↕", title: "Línea vertical (marca temporal)" },
    { id: "fib", icon: "🌀", title: "Retroceso Fibonacci (arrastra máx→mín)" },
    { id: "rect", icon: "▭", title: "Rectángulo (zona)" },
    { id: "erase", icon: "🧽", title: "Borrar (clic sobre un dibujo)" },
  ];

  const cursorStyle = tool === "pan" ? (pan.current ? "grabbing" : "grab")
    : tool === "cursor" ? "crosshair" : "crosshair";

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        {TOOLS.map((t) => (
          <button key={t.id} title={t.title} onClick={() => setTool(t.id)}
            style={{ width: 32, height: 30, border: "1px solid #ddd", borderRadius: 6, cursor: "pointer",
              background: tool === t.id ? "#2c3e50" : "#fff", color: tool === t.id ? "#fff" : "#333", fontSize: 14 }}>
            {t.icon}
          </button>
        ))}
        <span style={{ width: 1, height: 22, background: "#ddd", margin: "0 4px" }} />
        {/* Color */}
        <div style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
          {DRAW_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} title="Color de dibujo"
              style={{ width: 18, height: 18, borderRadius: "50%", background: c, cursor: "pointer",
                border: color === c ? "2px solid #111" : "1px solid #ccc" }} />
          ))}
        </div>
        <span style={{ width: 1, height: 22, background: "#ddd", margin: "0 4px" }} />
        <button onClick={() => setView(null)} title="Restablecer zoom"
          style={{ height: 30, padding: "0 10px", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", background: "#fff", fontSize: 13 }}>⟲ Vista</button>
        {drawings.length > 0 && (
          <button onClick={() => setDrawings((p) => p.slice(0, -1))} title="Deshacer último dibujo"
            style={{ height: 30, padding: "0 8px", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", background: "#fff", fontSize: 12 }}>↶ Deshacer</button>
        )}
        {drawings.length > 0 && (
          <button onClick={() => setDrawings([])} title="Borrar todos los dibujos"
            style={{ height: 30, padding: "0 8px", border: "1px solid #eecccc", borderRadius: 6, cursor: "pointer", background: "#fff", color: "#c0392b", fontSize: 12 }}>🗑️ {drawings.length}</button>
        )}
        <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>
          rueda: zoom · Shift: solo X · Alt: solo Y · doble-clic: reset
        </span>
      </div>

      <div ref={wrapRef} style={{ width: "100%" }}>
        <svg ref={svgRef} width={cw} height={ch} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, cursor: cursorStyle, touchAction: "none", display: "block", maxWidth: "100%" }}
             onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={() => { setCross(null); if (!draft && !box) pan.current = null; }}
             onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}
             onDoubleClick={() => setView(null)}>
          {/* Rejilla Y */}
          {yticks.map((yv, k) => (
            <g key={k}>
              <line x1={padL} x2={cw - padR} y1={yToPx(yv)} y2={yToPx(yv)} stroke="#f2f2f2" />
              <text x={padL - 6} y={yToPx(yv) + 3} fontSize={10} fill="#999" textAnchor="end">{yv.toFixed(2)}</text>
            </g>
          ))}
          {/* Rejilla X */}
          {xticks.map((t, k) => (
            <g key={k}>
              <line x1={xToPx(t.i)} x2={xToPx(t.i)} y1={padT} y2={ch - padB} stroke="#fafafa" />
              <text x={xToPx(t.i)} y={ch - padB + 14} fontSize={10} fill="#888" textAnchor="middle">{t.label}</text>
            </g>
          ))}

          {/* Banda Monte Carlo */}
          {band && bandPath() && <path d={bandPath()} fill={band.color} fillOpacity={0.10} stroke="none" />}

          {/* Marcadores verticales (ej. "congelado") */}
          {markers.map((mk, k) => {
            const i = data.findIndex((r) => r.date === mk.date); if (i < 0) return null;
            return (<g key={k}>
              <line x1={xToPx(i)} x2={xToPx(i)} y1={padT} y2={ch - padB} stroke={mk.color || "#bbb"} strokeDasharray="3 3" />
              {mk.label && <text x={xToPx(i)} y={padT + 10} fontSize={9} fill={mk.color || "#aaa"} textAnchor="middle">{mk.label}</text>}
            </g>);
          })}

          {/* Curvas */}
          {lines.map((l) => (
            <path key={l.key} d={linePath(l.key)} fill="none" stroke={l.color}
                  strokeWidth={l.width ?? 1.6} strokeDasharray={l.dash ?? ""} strokeLinejoin="round" />
          ))}

          {/* Dibujos del usuario */}
          {[...drawings, ...(draft ? [draft] : [])].map((d) => (
            <DrawingSVG key={d.id} d={d} xToPx={xToPx} yToPx={yToPx} padL={padL} right={cw - padR} top={padT} bottom={ch - padB} />
          ))}

          {/* Caja de zoom en progreso */}
          {box && (
            <rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)}
                  width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)}
                  fill="#2980b9" fillOpacity={0.08} stroke="#2980b9" strokeDasharray="4 3" />
          )}

          {/* Crosshair + tooltip */}
          {cross && tool !== "zoombox" && (
            <g pointerEvents="none">
              <line x1={cross.px} x2={cross.px} y1={padT} y2={ch - padB} stroke="#ccc" strokeDasharray="2 2" />
              <line x1={padL} x2={cw - padR} y1={cross.py} y2={cross.py} stroke="#ccc" strokeDasharray="2 2" />
              <rect x={cw - padR - 62} y={cross.py - 9} width={60} height={16} fill="#111" opacity={0.85} rx={3} />
              <text x={cw - padR - 32} y={cross.py + 3} fontSize={10} fill="#fff" textAnchor="middle">{pxToV(cross.py).toFixed(2)}</text>
            </g>
          )}
          {nearRow && cross && (() => {
            const rows = lines.filter((l) => nearRow[l.key] != null);
            const bw = 150, bh = 16 + rows.length * 13;
            let bx = cross.px + 12; if (bx + bw > cw - padR) bx = cross.px - bw - 12;
            const by = Math.min(Math.max(padT, cross.py - bh / 2), ch - padB - bh);
            return (
              <g pointerEvents="none">
                <rect x={bx} y={by} width={bw} height={bh} rx={5} fill="#111" opacity={0.9} />
                <text x={bx + 8} y={by + 14} fontSize={11} fill="#fff" fontWeight={700}>{nearRow.date}</text>
                {rows.map((l, k) => (
                  <text key={l.key} x={bx + 8} y={by + 27 + k * 13} fontSize={10} fill={l.color}>
                    {l.label}: {Number(nearRow[l.key]).toFixed(2)}
                  </text>
                ))}
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}

/** Renderiza un dibujo (línea, horizontal, vertical, fibonacci, rectángulo). */
function DrawingSVG({ d, xToPx, yToPx, padL, right, top, bottom }: {
  d: Drawing; xToPx: (i: number) => number; yToPx: (v: number) => number;
  padL: number; right: number; top: number; bottom: number;
}) {
  const a = d.pts[0], b = d.pts[1] || d.pts[0];
  if (d.type === "hline") {
    const y = yToPx(a.v);
    return (<g>
      <line x1={padL} x2={right} y1={y} y2={y} stroke={d.color} strokeWidth={1.4} />
      <text x={padL + 3} y={y - 3} fontSize={10} fill={d.color}>{a.v.toFixed(2)}</text>
    </g>);
  }
  if (d.type === "vline") {
    const x = xToPx(a.i);
    return <line x1={x} x2={x} y1={top} y2={bottom} stroke={d.color} strokeWidth={1.4} />;
  }
  if (d.type === "rect") {
    const x0 = Math.min(xToPx(a.i), xToPx(b.i)), x1 = Math.max(xToPx(a.i), xToPx(b.i));
    const y0 = Math.min(yToPx(a.v), yToPx(b.v)), y1 = Math.max(yToPx(a.v), yToPx(b.v));
    return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={d.color} fillOpacity={0.08} stroke={d.color} strokeWidth={1.2} />;
  }
  if (d.type === "fib") {
    const hi = Math.max(a.v, b.v), lo = Math.min(a.v, b.v), span = hi - lo;
    const x0 = Math.min(xToPx(a.i), xToPx(b.i)), x1 = Math.max(xToPx(a.i), xToPx(b.i));
    return (<g>
      {FIB.map((f, k) => {
        const price = hi - span * f; const y = yToPx(price);
        return (<g key={k}>
          <line x1={x0} x2={Math.max(x1, right)} y1={y} y2={y} stroke={d.color} strokeWidth={0.9} strokeDasharray="4 3" opacity={0.8} />
          <text x={x0 + 2} y={y - 2} fontSize={9} fill={d.color}>{(f * 100).toFixed(1)}% · {price.toFixed(2)}</text>
        </g>);
      })}
    </g>);
  }
  // trend
  return (<g>
    <line x1={xToPx(a.i)} y1={yToPx(a.v)} x2={xToPx(b.i)} y2={yToPx(b.v)} stroke={d.color} strokeWidth={1.6} />
    <circle cx={xToPx(a.i)} cy={yToPx(a.v)} r={2.5} fill={d.color} />
    <circle cx={xToPx(b.i)} cy={yToPx(b.v)} r={2.5} fill={d.color} />
  </g>);
}
