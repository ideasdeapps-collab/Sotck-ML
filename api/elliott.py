"""
elliott.py — ZigZag + ondas de Elliott (reutilizable para intradía y diario)
============================================================================
Módulo autocontenido para superponer análisis de Elliott sobre CUALQUIER serie
de precios (velas intradía o cierres diarios). Reutiliza la misma metodología del
análisis técnico: pivotes ZigZag + validación por las 3 reglas cardinales.

Función principal:
    elliott_from_candles(candles) -> dict con zigzag, elliott y fibonacci,
    listo para añadir a la respuesta de /intraday.
"""

from __future__ import annotations
import numpy as np

FIB_RETR = [0.236, 0.382, 0.5, 0.618, 0.786]


def zigzag(closes, times, pct: float = 0.005):
    """Pivotes por movimiento mínimo % (intradía usa un pct más pequeño)."""
    if len(closes) < 3:
        return []
    piv = [{"time": times[0], "price": float(closes[0]), "type": "start"}]
    trend, last_ext = 0, closes[0]
    for i in range(1, len(closes)):
        change = (closes[i] - last_ext) / last_ext
        if trend >= 0 and change <= -pct:
            piv.append({"time": times[i], "price": float(closes[i]), "type": "low"})
            trend, last_ext = -1, closes[i]
        elif trend <= 0 and change >= pct:
            piv.append({"time": times[i], "price": float(closes[i]), "type": "high"})
            trend, last_ext = 1, closes[i]
        else:
            if trend == 1 and closes[i] > last_ext:
                last_ext = closes[i]; piv[-1] = {"time": times[i], "price": float(closes[i]), "type": "high"}
            elif trend == -1 and closes[i] < last_ext:
                last_ext = closes[i]; piv[-1] = {"time": times[i], "price": float(closes[i]), "type": "low"}
    return piv


def elliott_candidate(pivots):
    """Busca un impulso alcista 1-2-3-4-5 validando las 3 reglas cardinales."""
    if len(pivots) < 6:
        return {"found": False, "reason": "Pocos pivotes para un conteo 1-5."}
    best, pts = None, pivots[-8:]
    for s in range(0, len(pts) - 5):
        p = pts[s:s + 6]
        P = [x["price"] for x in p]
        w1, w2, w3 = P[1] - P[0], P[1] - P[2], P[3] - P[2]
        w5 = P[5] - P[4]
        if not (w1 > 0 and w3 > 0 and w5 > 0):
            continue
        r1, r2, r3 = P[2] > P[0], not (w3 < w1 and w3 < w5), P[4] > P[1]
        if not (r1 and r2 and r3):
            continue
        retr2 = w2 / w1 if w1 else 0
        ext3 = w3 / w1 if w1 else 0
        conf = 100 - min(abs(retr2 - 0.618), abs(retr2 - 0.5)) * 100 - abs(ext3 - 1.618) * 20
        conf = float(max(0, min(100, conf)))
        cand = {"found": True, "direction": "alcista",
                "points": [{"time": x["time"], "price": x["price"], "label": lbl}
                           for x, lbl in zip(p, ["0", "1", "2", "3", "4", "5"])],
                "confidence": round(conf, 1),
                "rules": {"R1_wave2<100%": r1, "R2_wave3_not_shortest": r2, "R3_wave4_no_overlap": r3}}
        if best is None or conf > best["confidence"]:
            best = cand
    return best or {"found": False, "reason": "No se encontró un impulso 1-5 válido reciente."}


def fibonacci_levels(pivots):
    if len(pivots) < 2:
        return {}
    a, b = pivots[-2], pivots[-1]
    lo, hi = min(a["price"], b["price"]), max(a["price"], b["price"])
    up = b["price"] >= a["price"]; diff = hi - lo
    retr = {f"{int(r*1000)/10}%": round(hi - diff * r, 4) if up else round(lo + diff * r, 4)
            for r in FIB_RETR}
    return {"swing_low": round(lo, 4), "swing_high": round(hi, 4),
            "direction": "alcista" if up else "bajista", "retracements": retr}


def elliott_from_candles(candles, pct: float = 0.005) -> dict:
    """
    Calcula ZigZag + Elliott + Fibonacci desde las velas intradía.
    'candles' = lista de dicts con al menos {'time','close'}.
    """
    if not candles:
        return {"zigzag": [], "elliott": {"found": False}, "fibonacci": {}}
    closes = [c["close"] for c in candles]
    times = [c["time"] for c in candles]
    piv = zigzag(np.array(closes, dtype=float), times, pct=pct)
    return {"zigzag": piv, "elliott": elliott_candidate(piv), "fibonacci": fibonacci_levels(piv)}
