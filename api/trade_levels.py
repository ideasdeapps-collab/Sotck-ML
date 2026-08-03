"""
trade_levels.py — Zona de entrada, Take Profit y Stop Loss desde Elliott + Fibonacci
====================================================================================
A partir del conteo de Elliott (0-1-2-3-4-5) y los niveles Fibonacci que YA
calcula elliott.py, deriva un setup operativo con:
  - entry_zone   : [bajo, alto]  zona sugerida de entrada
  - stop_loss    : nivel de invalidación
  - take_profit  : [TP1, TP2]    objetivos
  - risk_reward  : ratio beneficio/riesgo del TP1
  - phase        : en qué punto del ciclo estamos
  - rationale    : explicación en texto

Lógica (impulso alcista P0..P5):
  • Onda 5 en progreso (precio entre P4 y P5): comprar cerca del fin de onda 4.
      entry ≈ P4 ;  SL bajo P4 (invalida) ;  TP = proyección de onda 5.
  • Impulso completo (precio ≈ o supera P5): esperar corrección → re-entrada en
      retrocesos Fibonacci del impulso; SL en invalidación (bajo P0); TP retesteo/extensión.
  • Sin Elliott válido: fallback Fibonacci del último swing.

⚠️ Es una guía educativa basada en reglas, NO una recomendación de inversión.
"""

from __future__ import annotations


def _rr(entry_mid: float, sl: float, tp1: float) -> float:
    risk = abs(entry_mid - sl)
    reward = abs(tp1 - entry_mid)
    return round(reward / risk, 2) if risk > 1e-9 else 0.0


def compute_trade_levels(elliott: dict, fibonacci: dict, last_price: float,
                         buffer: float = 0.005) -> dict:
    """
    elliott   = dict de elliott_from_candles()['elliott']  (found, points, ...)
    fibonacci = dict de elliott_from_candles()['fibonacci'] (retracements, swing_*)
    last_price = último precio (cierre de la última vela)
    """
    if not last_price or last_price <= 0:
        return {"found": False, "reason": "Sin precio de referencia."}

    # -------- Caso con impulso de Elliott válido --------
    if elliott and elliott.get("found") and len(elliott.get("points", [])) == 6:
        P = [p["price"] for p in elliott["points"]]           # P0..P5
        w1 = P[1] - P[0]
        impulse_complete = last_price >= P[5] * (1 - buffer)

        if not impulse_complete and last_price > P[4]:
            # --- Onda 5 en progreso: comprar cerca del fin de onda 4 ---
            entry_lo = round(P[4], 4)
            entry_hi = round(P[4] * (1 + buffer), 4)
            entry_mid = (entry_lo + entry_hi) / 2
            stop_loss = round(P[4] * (1 - 2 * buffer), 4)      # bajo onda 4 = invalida
            tp1 = round(P[4] + w1, 4)                          # onda5 ≈ onda1
            tp2 = round(P[4] + 1.618 * w1, 4)                  # extensión 1.618
            return {
                "found": True, "direction": "long", "phase": "onda_5_en_progreso",
                "entry_zone": [entry_lo, entry_hi], "stop_loss": stop_loss,
                "take_profit": [tp1, tp2], "risk_reward": _rr(entry_mid, stop_loss, tp1),
                "rationale": ("Onda 5 en desarrollo tras completar 1-2-3-4. Entrada cerca "
                              "del fin de la onda 4; invalida si el precio la perfora. "
                              "Objetivos por proyección de onda 5 (1.0× y 1.618× de onda 1)."),
            }
        else:
            # --- Impulso completo: esperar corrección, re-entrada en Fibonacci ---
            retr = fibonacci.get("retracements", {}) if fibonacci else {}
            f382 = retr.get("38.2%")
            f618 = retr.get("61.8%")
            lo = min(x for x in (f382, f618) if x) if (f382 or f618) else P[0]
            hi = max(x for x in (f382, f618) if x) if (f382 or f618) else P[3]
            entry_lo, entry_hi = round(min(lo, hi), 4), round(max(lo, hi), 4)
            entry_mid = (entry_lo + entry_hi) / 2
            stop_loss = round(P[0] * (1 - buffer), 4)          # retroceso total invalida
            tp1 = round(P[5], 4)                               # retesteo del máximo
            tp2 = round(P[5] + 0.618 * (P[5] - P[0]), 4)       # nueva extensión
            return {
                "found": True, "direction": "long", "phase": "impulso_completo_correccion",
                "entry_zone": [entry_lo, entry_hi], "stop_loss": stop_loss,
                "take_profit": [tp1, tp2], "risk_reward": _rr(entry_mid, stop_loss, tp1),
                "rationale": ("Impulso 1-5 completo: se anticipa corrección A-B-C. "
                              "Re-entrada alcista en retrocesos Fibonacci (38.2%–61.8%); "
                              "invalida si retrocede todo el impulso. Objetivos: retesteo "
                              "del máximo y extensión."),
            }

    # -------- Fallback: solo Fibonacci del último swing --------
    if fibonacci and fibonacci.get("retracements"):
        up = fibonacci.get("direction") == "alcista"
        retr = fibonacci["retracements"]
        f382, f618 = retr.get("38.2%"), retr.get("61.8%")
        lo_hi = [x for x in (f382, f618) if x]
        if lo_hi and up:
            entry_lo, entry_hi = round(min(lo_hi), 4), round(max(lo_hi), 4)
            entry_mid = (entry_lo + entry_hi) / 2
            stop_loss = round(fibonacci["swing_low"] * (1 - buffer), 4)
            hi = fibonacci["swing_high"]
            tp1 = round(hi, 4)
            tp2 = round(hi + 0.618 * (hi - fibonacci["swing_low"]), 4)
            return {
                "found": True, "direction": "long", "phase": "fibonacci_swing",
                "entry_zone": [entry_lo, entry_hi], "stop_loss": stop_loss,
                "take_profit": [tp1, tp2], "risk_reward": _rr(entry_mid, stop_loss, tp1),
                "rationale": ("Sin conteo de Elliott claro. Setup por Fibonacci del último "
                              "swing alcista: entrada en 38.2%–61.8%, stop bajo el mínimo, "
                              "objetivos en el máximo y su extensión."),
            }

    return {"found": False, "reason": "Estructura insuficiente para un setup operativo."}
