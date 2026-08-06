"""
intraday_store.py — Persistencia de snapshots INTRADÍA en Supabase (Fase A)
==========================================================================
Guarda cada predicción intradía (curva del resto de la sesión) y la lee de vuelta
para, al cierre, medir su desempeño vs. el precio real y vs. el baseline
"sin cambio". No-op si Supabase no está configurado.
"""

from __future__ import annotations
import os
import json
import datetime as dt
from typing import Optional

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)


def enabled() -> bool:
    return _ENABLED


def _h(prefer: str | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    return h


def save_snapshot(ticker: str, session_date: str, bars_real: int,
                  anchor_time: str | None, anchor_close: float,
                  points: list[dict], dir_acc_model: float | None = None) -> Optional[str]:
    """
    points: [{"time": ISO, "close": float}, ...] de la curva PREDICHA.
    Devuelve el id del snapshot creado (o None si Supabase off).
    """
    if not _ENABLED:
        return None
    row = {
        "ticker": ticker.upper(),
        "session_date": session_date,
        "calc_time": dt.datetime.utcnow().isoformat() + "Z",
        "bars_real": int(bars_real),
        "anchor_time": anchor_time,
        "anchor_close": float(anchor_close),
        "points": points,
        "dir_acc_model": dir_acc_model,
    }
    r = requests.post(f"{SUPABASE_URL}/rest/v1/intraday_snapshots",
                      headers=_h("return=representation"), json=row, timeout=20)
    r.raise_for_status()
    return r.json()[0]["id"]


def get_snapshots(ticker: str, session_date: str | None = None,
                  limit: int = 50) -> list[dict]:
    """Lee snapshots de un ticker (opcionalmente de una sesión concreta)."""
    if not _ENABLED:
        return []
    params = {
        "ticker": f"eq.{ticker.upper()}",
        "order": "session_date.desc,calc_time.asc",
        "limit": str(limit),
        "select": "id,ticker,session_date,calc_time,bars_real,anchor_time,anchor_close,points,dir_acc_model",
    }
    if session_date:
        params["session_date"] = f"eq.{session_date}"
    r = requests.get(f"{SUPABASE_URL}/rest/v1/intraday_snapshots", headers=_h(),
                     params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def latest_session_date(ticker: str) -> str | None:
    """Fecha de sesión más reciente con snapshots para el ticker."""
    if not _ENABLED:
        return None
    r = requests.get(f"{SUPABASE_URL}/rest/v1/intraday_snapshots", headers=_h(),
                     params={"ticker": f"eq.{ticker.upper()}",
                             "order": "session_date.desc", "limit": "1",
                             "select": "session_date"}, timeout=15)
    if not r.ok or not r.json():
        return None
    return r.json()[0]["session_date"]


# --------------------------------------------------------------------------- #
# Scorecard: mide cada snapshot vs. real y vs. baseline "sin cambio"
# --------------------------------------------------------------------------- #
def score_snapshots(snapshots: list[dict], real_bars: list[dict]) -> dict:
    """
    snapshots: filas de get_snapshots (cada una con anchor_close + points).
    real_bars: barras REALES de la sesión completa [{time, close}, ...].
    Devuelve, por snapshot: MAPE, error de cierre, dir.acc, y SKILL vs baseline
    "sin cambio" (precio se queda en el ancla).
    """
    real_by_time = {b["time"]: float(b["close"]) for b in real_bars}
    real_close = float(real_bars[-1]["close"]) if real_bars else None
    rows = []
    for s in snapshots:
        anchor = float(s["anchor_close"])
        pts = s.get("points", []) or []
        # Solo puntos cuya fecha/hora ya ocurrió (hay real para comparar)
        matched = [(p, real_by_time[p["time"]]) for p in pts if p["time"] in real_by_time]
        n = len(matched)
        if n == 0:
            rows.append({"id": s["id"], "calc_time": s["calc_time"],
                         "evaluated_bars": 0, "mape": None, "close_err": None,
                         "dir_ok": None, "skill": None})
            continue

        # Error del modelo (MAPE sobre barras predichas ya ocurridas)
        ae_model = [abs(float(p["close"]) - r) / r for p, r in matched]
        mape_model = sum(ae_model) / n

        # Baseline "sin cambio": predice anchor para todas las barras
        ae_base = [abs(anchor - r) / r for _, r in matched]
        mape_base = sum(ae_base) / n
        skill = (1 - mape_model / mape_base) if mape_base > 1e-12 else 0.0

        # Error del cierre (si el snapshot llega hasta el cierre real)
        close_err = None
        if real_close is not None and pts:
            close_err = abs(float(pts[-1]["close"]) - real_close) / real_close

        # Acierto direccional hasta la última barra evaluada
        last_real = matched[-1][1]
        pred_dir = 1 if float(matched[-1][0]["close"]) >= anchor else -1
        real_dir = 1 if last_real >= anchor else -1
        dir_ok = pred_dir == real_dir

        rows.append({
            "id": s["id"], "calc_time": s["calc_time"], "bars_real": s["bars_real"],
            "evaluated_bars": n,
            "mape": round(mape_model, 5),
            "mape_baseline": round(mape_base, 5),
            "skill": round(skill, 4),
            "close_err": round(close_err, 5) if close_err is not None else None,
            "dir_ok": bool(dir_ok),
        })

    scored = [r for r in rows if r["evaluated_bars"] > 0]
    verdict = None
    if scored:
        avg_skill = sum(r["skill"] for r in scored) / len(scored)
        improves = (len(scored) >= 2 and scored[-1]["mape"] is not None
                    and scored[0]["mape"] is not None
                    and scored[-1]["mape"] < scored[0]["mape"])
        if avg_skill > 0.05:
            verdict = ("El modelo APORTA hoy: gana al baseline 'sin cambio'"
                       + (" y mejora conforme avanza la sesión." if improves else "."))
        elif avg_skill > -0.05:
            verdict = "Empate con el baseline: el modelo no aporta señal clara en esta sesión."
        else:
            verdict = "El baseline 'sin cambio' gana: el modelo no aportó valor hoy."

    return {"rows": rows, "avg_skill": round(sum(r["skill"] for r in scored) / len(scored), 4) if scored else None,
            "n_scored": len(scored), "verdict": verdict}
    def list_sessions(ticker: str, limit: int = 60) -> list[dict]:
    """Fechas de sesión distintas que tienen snapshots para el ticker,
    con cuántos snapshots hay en cada una (para el dropdown)."""
    if not _ENABLED:
        return []
    r = requests.get(f"{SUPABASE_URL}/rest/v1/intraday_snapshots", headers=_h(),
                     params={"ticker": f"eq.{ticker.upper()}",
                             "order": "session_date.desc,calc_time.asc",
                             "select": "session_date"}, timeout=20)
    if not r.ok:
        return []
    counts: dict = {}
    for row in r.json():
        d = row["session_date"]
        counts[d] = counts.get(d, 0) + 1
    # orden descendente por fecha
    sessions = sorted(counts.items(), key=lambda kv: kv[0], reverse=True)[:limit]
    return [{"session_date": d, "count": c} for d, c in sessions]


--- 2) En api/main.py, junto a los otros endpoints intradía, añade: ---

    @app.get("/intraday-sessions")
    def list_intraday_sessions(ticker: str):
        """Sesiones (fechas) que tienen snapshots guardados para el ticker."""
        if not intraday_store.enabled():
            raise HTTPException(503, "Supabase no está configurado.")
        return {"ticker": ticker.upper(),
                "sessions": intraday_store.list_sessions(ticker)}
