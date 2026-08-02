"""
technical.py — Análisis técnico avanzado (sección mixta diario × intradía)
=========================================================================
Combina el histórico diario con la predicción XGBoost y superpone herramientas
de análisis técnico clásico:

  - ZigZag (pivotes por % mínimo)  -> estructura limpia de swings
  - Ondas de Elliott (EXPERIMENTAL): busca un candidato de impulso 1-2-3-4-5
    validando las 3 reglas cardinales; luego marca un ABC correctivo tentativo.
  - Fibonacci: retrocesos (0.236/0.382/0.5/0.618/0.786) y extensiones (1.272/1.618)
    del último swing dominante.
  - Medias móviles (SMA20/50/200) y línea de tendencia del tramo reciente.

⚠️ Elliott es intrínsecamente subjetivo/probabilístico. Aquí se implementa como
un CANDIDATO basado en reglas, con score de confianza — NO como verdad absoluta.

Reglas cardinales de Elliott validadas:
  R1: onda 2 no retrocede más del 100% de onda 1.
  R2: onda 3 no es la más corta entre 1, 3 y 5.
  R3: onda 4 no solapa el territorio de precio de onda 1.
"""

from __future__ import annotations
import datetime as dt

import numpy as np
import pandas as pd

FIB_RETR = [0.236, 0.382, 0.5, 0.618, 0.786]
FIB_EXT = [1.272, 1.618, 2.618]


# --------------------------------------------------------------------------- #
# 1. ZigZag: pivotes por movimiento mínimo porcentual
# --------------------------------------------------------------------------- #
def zigzag(closes: np.ndarray, dates: list[str], pct: float = 0.03) -> list[dict]:
    """
    Devuelve una secuencia alternada de pivotes (máx/mín) filtrando movimientos
    menores a 'pct'. Base para Elliott y Fibonacci.
    """
    if len(closes) < 3:
        return []
    pivots = [{"idx": 0, "date": dates[0], "price": float(closes[0]), "type": "start"}]
    last_idx = 0
    trend = 0  # 1 sube, -1 baja
    last_ext = closes[0]

    for i in range(1, len(closes)):
        change = (closes[i] - last_ext) / last_ext
        if trend >= 0 and change <= -pct:
            pivots.append({"idx": last_idx if trend == 0 else i,
                           "date": dates[i], "price": float(closes[i]), "type": "low"})
            trend = -1; last_ext = closes[i]; last_idx = i
        elif trend <= 0 and change >= pct:
            pivots.append({"idx": i, "date": dates[i],
                           "price": float(closes[i]), "type": "high"})
            trend = 1; last_ext = closes[i]; last_idx = i
        else:
            # Extiende el extremo actual si el precio sigue en la dirección
            if trend == 1 and closes[i] > last_ext:
                last_ext = closes[i]; last_idx = i
                pivots[-1] = {"idx": i, "date": dates[i],
                              "price": float(closes[i]), "type": "high"}
            elif trend == -1 and closes[i] < last_ext:
                last_ext = closes[i]; last_idx = i
                pivots[-1] = {"idx": i, "date": dates[i],
                              "price": float(closes[i]), "type": "low"}
    return pivots


# --------------------------------------------------------------------------- #
# 2. Ondas de Elliott (candidato por reglas)
# --------------------------------------------------------------------------- #
def elliott_candidate(pivots: list[dict]) -> dict:
    """
    Busca en los últimos pivotes un candidato de impulso alcista 1-2-3-4-5
    (6 puntos: P0..P5) validando las 3 reglas. Devuelve el mejor por confianza.
    """
    if len(pivots) < 6:
        return {"found": False, "reason": "Pocos pivotes para un conteo 1-5."}

    best = None
    pts = pivots[-8:]  # ventana reciente
    n = len(pts)
    for s in range(0, n - 5):
        p = pts[s:s + 6]
        P = [x["price"] for x in p]
        # Impulso alcista: P0<P1, P2>P0, P3>P1, P4<P3 y P4>P1(no solapa), P5>P3
        w1 = P[1] - P[0]
        w2 = P[1] - P[2]
        w3 = P[3] - P[2]
        w4 = P[3] - P[4]
        w5 = P[5] - P[4]
        if not (w1 > 0 and w3 > 0 and w5 > 0):
            continue
        # R1: onda 2 no retrocede >100% de onda 1
        r1 = P[2] > P[0]
        # R2: onda 3 no es la más corta
        r2 = not (w3 < w1 and w3 < w5)
        # R3: onda 4 no solapa onda 1 (en alcista, P4 > P1)
        r3 = P[4] > P[1]
        if not (r1 and r2 and r3):
            continue
        # Confianza por cercanía a ratios Fibonacci ideales
        retr2 = w2 / w1 if w1 else 0
        ext3 = w3 / w1 if w1 else 0
        conf = 100
        conf -= min(abs(retr2 - 0.618), abs(retr2 - 0.5)) * 100
        conf -= abs(ext3 - 1.618) * 20
        conf = float(max(0, min(100, conf)))
        cand = {"found": True, "direction": "alcista",
                "points": [{"date": x["date"], "price": x["price"],
                            "label": lbl} for x, lbl in
                           zip(p, ["0", "1", "2", "3", "4", "5"])],
                "confidence": round(conf, 1),
                "rules": {"R1_wave2<100%": r1, "R2_wave3_not_shortest": r2,
                          "R3_wave4_no_overlap": r3}}
        if best is None or conf > best["confidence"]:
            best = cand
    return best or {"found": False,
                    "reason": "No se encontró un impulso 1-5 válido reciente."}


# --------------------------------------------------------------------------- #
# 3. Fibonacci del último swing dominante
# --------------------------------------------------------------------------- #
def fibonacci_levels(pivots: list[dict]) -> dict:
    if len(pivots) < 2:
        return {}
    a, b = pivots[-2], pivots[-1]
    lo, hi = min(a["price"], b["price"]), max(a["price"], b["price"])
    up = b["price"] >= a["price"]
    diff = hi - lo
    retr = {f"{int(r*1000)/10}%": round(hi - diff * r, 4) if up
            else round(lo + diff * r, 4) for r in FIB_RETR}
    ext = {f"{int(e*1000)/10}%": round(lo + diff * e, 4) if up
           else round(hi - diff * e, 4) for e in FIB_EXT}
    return {"swing_low": round(lo, 4), "swing_high": round(hi, 4),
            "direction": "alcista" if up else "bajista",
            "retracements": retr, "extensions": ext}


# --------------------------------------------------------------------------- #
# 4. Orquestador
# --------------------------------------------------------------------------- #
def technical_analysis(predict_curve_fn, ticker: str, horizon: int = 20,
                       zigzag_pct: float = 0.03) -> dict:
    pred = predict_curve_fn(ticker, horizon)

    hist = pred["history"]
    closes = np.array([h["close"] for h in hist], dtype=float)
    dates = [h["date"] for h in hist]

    # Medias móviles
    def sma(w):
        if len(closes) < w:
            return None
        return round(float(pd.Series(closes).rolling(w).mean().iloc[-1]), 4)

    piv = zigzag(closes, dates, pct=zigzag_pct)
    elliott = elliott_candidate(piv)
    fib = fibonacci_levels(piv)

    # Línea de tendencia simple (regresión sobre los últimos 30 cierres)
    tl = None
    if len(closes) >= 10:
        k = min(30, len(closes))
        x = np.arange(k)
        y = closes[-k:]
        m, c = np.polyfit(x, y, 1)
        tl = {"start": {"date": dates[-k], "price": round(float(c), 4)},
              "end": {"date": dates[-1], "price": round(float(m * (k - 1) + c), 4)},
              "slope_per_day": round(float(m), 4),
              "direction": "alcista" if m > 0 else "bajista"}

    return {
        "ticker": ticker.upper(),
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "last_close": pred["last_close"],
        "history": hist,
        "prediction": pred["prediction"],     # curva XGBoost (diario)
        "zigzag": piv,
        "elliott": elliott,
        "fibonacci": fib,
        "moving_averages": {"sma20": sma(20), "sma50": sma(50), "sma200": sma(200)},
        "trendline": tl,
        "disclaimer": "Conteo de Elliott experimental y probabilístico; "
                      "úsalo como apoyo, no como certeza.",
    }
