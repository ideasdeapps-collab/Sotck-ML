"""
elliott.py — ZigZag + Elliott (impulso 1-5) + corrección A-B-C + Fibonacci
==========================================================================
Reutilizable para intradía y diario. Además del impulso motriz 0-1-2-3-4-5,
ahora detecta la corrección A-B-C que suele seguirlo (usando los pivotes
posteriores a la onda 5).
"""

from __future__ import annotations
import numpy as np

FIB_RETR = [0.236, 0.382, 0.5, 0.618, 0.786]


def zigzag(closes, times, pct: float = 0.005):
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
    """
    Busca un impulso alcista 1-2-3-4-5 validando las 3 reglas. Devuelve también
    el índice del pivote de la onda 5 dentro de 'pivots' (para buscar el ABC).
    """
    if len(pivots) < 6:
        return {"found": False, "reason": "Pocos pivotes para un conteo 1-5."}
    best, best_end = None, None
    n = len(pivots)
    # ventana amplia para poder localizar el índice real del pivote 5
    start_min = max(0, n - 9)
    for s in range(start_min, n - 5):
        p = pivots[s:s + 6]
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
            best_end = s + 5   # índice del pivote de la onda 5
    if best is None:
        return {"found": False, "reason": "No se encontró un impulso 1-5 válido reciente."}
    best["_wave5_idx"] = best_end
    return best


def abc_correction(pivots, elliott):
    """
    Etiqueta la corrección A-B-C con los 3 pivotes que siguen a la onda 5.
    Para un impulso alcista, la corrección típica es A(baja)-B(sube)-C(baja).
    """
    if not elliott or not elliott.get("found"):
        return {"found": False}
    idx5 = elliott.get("_wave5_idx")
    if idx5 is None or idx5 + 3 >= len(pivots):
        return {"found": False, "reason": "Aún no hay pivotes suficientes tras la onda 5."}
    a, b, c = pivots[idx5 + 1], pivots[idx5 + 2], pivots[idx5 + 3]
    p5 = pivots[idx5]["price"]
    # Validación laxa: A por debajo de 5, C por debajo de A (corrección bajista)
    valid = a["price"] < p5 and c["price"] < b["price"]
    return {
        "found": bool(valid),
        "points": [{"time": a["time"], "price": a["price"], "label": "A"},
                   {"time": b["time"], "price": b["price"], "label": "B"},
                   {"time": c["time"], "price": c["price"], "label": "C"}],
    }


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
    """Calcula ZigZag + Elliott (1-5) + A-B-C + Fibonacci desde las velas."""
    if not candles:
        return {"zigzag": [], "elliott": {"found": False}, "abc": {"found": False}, "fibonacci": {}}
    closes = [c["close"] for c in candles]
    times = [c["time"] for c in candles]
    piv = zigzag(np.array(closes, dtype=float), times, pct=pct)
    ell = elliott_candidate(piv)
    abc = abc_correction(piv, ell)
    # limpia el índice interno antes de exponer
    if isinstance(ell, dict):
        ell.pop("_wave5_idx", None)
    return {"zigzag": piv, "elliott": ell, "abc": abc, "fibonacci": fibonacci_levels(piv)}
