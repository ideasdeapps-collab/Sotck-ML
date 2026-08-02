"""
supabase_client.py
------------------
Cliente ligero para persistir y recuperar forecasts en Supabase vía la API REST
(PostgREST). No requiere el SDK; solo 'requests'. Usa la SERVICE KEY en el backend.

Variables de entorno:
    SUPABASE_URL          https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  (service_role key — solo en el servidor)

Si no están configuradas, las funciones se vuelven no-op (devuelven None) para
que la API siga funcionando sin Supabase.
"""

from __future__ import annotations
import os
import datetime as dt
from typing import Optional

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)


def enabled() -> bool:
    return _ENABLED


def _headers(prefer: str | None = None) -> dict:
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


# --------------------------------------------------------------------------- #
# Guardar un forecast completo (corrida + puntos)
# --------------------------------------------------------------------------- #
def save_forecast(prediction: dict, simulation: dict, meta: dict) -> Optional[str]:
    """
    Inserta una corrida en forecast_runs y sus puntos en forecast_points.
    Devuelve el run_id (uuid) o None si Supabase está deshabilitado.
    """
    if not _ENABLED:
        return None

    ticker = prediction["ticker"]
    run_date = dt.date.today().isoformat()

    # 1) Insertar la corrida
    run_payload = {
        "ticker": ticker,
        "run_date": run_date,
        "last_close": prediction["last_close"],
        "horizon": len(prediction["prediction"]),
        "model_version": meta.get("trained_at"),
        "mu_daily": meta.get("mu_daily"),
        "sigma_daily": meta.get("sigma_daily"),
        "directional_accuracy": meta.get("metrics", {}).get("directional_accuracy"),
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/forecast_runs",
        headers=_headers("return=representation"),
        json=run_payload,
        timeout=20,
    )
    r.raise_for_status()
    run_id = r.json()[0]["id"]

    # 2) Insertar los puntos (bulk)
    pred = prediction["prediction"]
    sim = simulation
    points = []
    for i, p in enumerate(pred):
        points.append({
            "run_id": run_id,
            "ticker": ticker,
            "target_date": p["date"],
            "predicted": p["close"],
            "mc_median": sim["median"][i],
            "mc_p5": sim["p5"][i],
            "mc_p25": sim["p25"][i],
            "mc_p75": sim["p75"][i],
            "mc_p95": sim["p95"][i],
        })
    r2 = requests.post(
        f"{SUPABASE_URL}/rest/v1/forecast_points",
        headers=_headers("return=minimal"),
        json=points,
        timeout=30,
    )
    r2.raise_for_status()
    return run_id


# --------------------------------------------------------------------------- #
# Recuperar forecasts pasados de un ticker (para graficar predicciones previas)
# --------------------------------------------------------------------------- #
def get_forecast_history(ticker: str, limit_runs: int = 5) -> list[dict]:
    """Devuelve las últimas corridas con sus puntos, para el ticker dado."""
    if not _ENABLED:
        return []

    # Últimas corridas
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/forecast_runs",
        headers=_headers(),
        params={
            "ticker": f"eq.{ticker.upper()}",
            "order": "run_date.desc",
            "limit": str(limit_runs),
            "select": "id,run_date,last_close,horizon,model_version",
        },
        timeout=20,
    )
    r.raise_for_status()
    runs = r.json()
    if not runs:
        return []

    run_ids = ",".join(run["id"] for run in runs)
    p = requests.get(
        f"{SUPABASE_URL}/rest/v1/forecast_points",
        headers=_headers(),
        params={
            "run_id": f"in.({run_ids})",
            "order": "target_date.asc",
            "select": "run_id,target_date,predicted,mc_median,mc_p5,mc_p95,actual_close",
        },
        timeout=20,
    )
    p.raise_for_status()
    points = p.json()

    # Agrupar puntos por corrida
    by_run: dict[str, list] = {}
    for pt in points:
        by_run.setdefault(pt["run_id"], []).append(pt)

    out = []
    for run in runs:
        out.append({
            "run_id": run["id"],
            "run_date": run["run_date"],
            "last_close": run["last_close"],
            "points": by_run.get(run["id"], []),
        })
    return out


# --------------------------------------------------------------------------- #
# Backfill de precios reales (para comparar predicción vs realidad)
# --------------------------------------------------------------------------- #
def update_actuals(ticker: str, date_close_map: dict[str, float]) -> int:
    """
    Actualiza actual_close en forecast_points para fechas ya ocurridas.
    date_close_map: { 'YYYY-MM-DD': precio_real }
    Devuelve el número de fechas actualizadas.
    """
    if not _ENABLED:
        return 0
    updated = 0
    for target_date, close in date_close_map.items():
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/forecast_points",
            headers=_headers("return=minimal"),
            params={
                "ticker": f"eq.{ticker.upper()}",
                "target_date": f"eq.{target_date}",
            },
            json={"actual_close": close},
            timeout=20,
        )
        if r.ok:
            updated += 1
    return updated
