"""
signal_1m_store.py — Registro en Supabase de las señales de dirección de 1 min
=============================================================================
Cada respuesta de /signal-1m se guarda (una fila por horizonte disponible) para
medir el acierto REAL, no solo el del backtest. El polling del Lab repite la
misma última barra muchas veces: la clave única (ticker, as_of, h) las colapsa.
No-op si Supabase no está configurado, igual que intraday_store.py.
"""

from __future__ import annotations
import os

import numpy as np
import pandas as pd
import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)
SIGNALS_LIMIT = 20000


def enabled() -> bool:
    return _ENABLED


def _h(prefer: str | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    return h


def save_signal(sig: dict) -> int:
    if not _ENABLED:
        return 0
    rows = [{"ticker": sig["ticker"], "as_of": sig["as_of"], "h": h["h"], "p_up": h["p_up"],
             "confident": h["confident"], "has_edge": h["has_edge"],
             "anchor_close": sig["last_close"], "dead_band": h["dead_band"],
             "momentum_up": sig.get("momentum_up")}
            for h in sig["horizons"] if h["available"]]
    if not rows:
        return 0
    r = requests.post(f"{SUPABASE_URL}/rest/v1/signals_1m?on_conflict=ticker,as_of,h",
                      headers=_h("resolution=ignore-duplicates,return=minimal"),
                      json=rows, timeout=15)
    r.raise_for_status()
    return len(rows)


def get_signals(ticker: str, since_iso: str, limit: int = SIGNALS_LIMIT) -> list[dict]:
    if not _ENABLED:
        return []
    # Pedimos las MÁS RECIENTES primero (desc) para que un truncado por `limit`
    # descarte las filas más viejas, no las más relevantes; reordenamos a asc al volver.
    r = requests.get(f"{SUPABASE_URL}/rest/v1/signals_1m", headers=_h(), timeout=20, params={
        "ticker": f"eq.{ticker.upper()}", "as_of": f"gte.{since_iso}",
        "order": "as_of.desc", "limit": str(limit),
        "select": "ticker,as_of,h,p_up,confident,has_edge,anchor_close,dead_band,momentum_up"})
    r.raise_for_status()
    rows = r.json()
    return sorted(rows, key=lambda row: row["as_of"])


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def score_signals(rows: list[dict], bars: pd.DataFrame, truncated: bool = False) -> dict:
    """Resuelve cada señal con el cierre real de la barra as_of + h.
    'Plana' = |r| dentro de la banda muerta: no cuenta ni como acierto ni como fallo.
    `truncated`: True si `rows` pudo haber perdido filas por el límite de get_signals."""
    if not rows:
        return {"n_signals": 0, "horizons": {}, "truncated": truncated}
    # Claves en UTC: Supabase devuelve `as_of` en +00:00 y las barras vienen en ET.
    close_at = {pd.Timestamp(t).tz_convert("UTC"): float(c)
                for t, c in zip(bars["dt_et"], bars["close"])}
    by_h: dict[int, dict] = {}
    for row in rows:
        h = int(row["h"])
        s = by_h.setdefault(h, {"resolved": 0, "pending": 0, "flat": 0, "hit": 0, "decided": 0,
                                "conf": 0, "conf_hit": 0, "mom_hit": 0, "mom_n": 0})
        target = (pd.Timestamp(row["as_of"]) + pd.Timedelta(minutes=h)).tz_convert("UTC")
        if target not in close_at:
            s["pending"] += 1
            continue
        s["resolved"] += 1
        r = float(np.log(close_at[target] / float(row["anchor_close"])))
        if abs(r) <= float(row["dead_band"]):
            s["flat"] += 1
            continue
        up = r > 0
        hit = (float(row["p_up"]) >= 0.5) == up
        s["decided"] += 1
        s["hit"] += hit
        if row["confident"]:
            s["conf"] += 1
            s["conf_hit"] += hit
        if row.get("momentum_up") is not None:
            s["mom_n"] += 1
            s["mom_hit"] += bool(row["momentum_up"]) == up

    return {"n_signals": len(rows), "truncated": truncated, "horizons": {str(h): {
        "resolved": s["resolved"], "pending": s["pending"],
        "flat_share": _ratio(s["flat"], s["resolved"]),
        "acc_all": _ratio(s["hit"], s["decided"]),
        "acc_confident": _ratio(s["conf_hit"], s["conf"]),
        "coverage": _ratio(s["conf"], s["decided"]),
        "acc_momentum": _ratio(s["mom_hit"], s["mom_n"]),
    } for h, s in sorted(by_h.items())}}
