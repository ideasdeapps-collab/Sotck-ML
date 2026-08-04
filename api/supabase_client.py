"""
supabase_client.py — Persistencia de forecasts en Supabase (todas las curvas)
=============================================================================
No-op si SUPABASE_URL / SUPABASE_SERVICE_KEY no están configuradas.

Guarda TODAS las curvas por punto: predicted(XGBoost), mlp, ml_sentiment,
sentiment_only, psy_a, psy_b, y bandas Monte Carlo (mc_median/p5/p25/p75/p95).
Requiere haber corrido supabase/schema_v2_curvas.sql (añade las columnas nuevas).
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


def _h(prefer: str | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    return h


# --------------------------------------------------------------------------- #
# Guardado clásico (XGBoost + Monte Carlo) — se conserva por compatibilidad
# --------------------------------------------------------------------------- #
def save_forecast(prediction: dict, simulation: dict, meta: dict) -> Optional[str]:
    if not _ENABLED:
        return None
    tk = prediction["ticker"]
    run = {"ticker": tk, "run_date": dt.date.today().isoformat(),
           "last_close": prediction["last_close"], "horizon": len(prediction["prediction"]),
           "model_version": meta.get("trained_at"), "mu_daily": meta.get("mu_daily"),
           "sigma_daily": meta.get("sigma_daily"),
           "directional_accuracy": meta.get("metrics", {}).get("directional_accuracy")}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/forecast_runs",
                      headers=_h("return=representation"), json=run, timeout=20)
    r.raise_for_status()
    rid = r.json()[0]["id"]
    sim = simulation
    pts = [{"run_id": rid, "ticker": tk, "target_date": p["date"], "predicted": p["close"],
            "mc_median": sim["median"][i], "mc_p5": sim["p5"][i], "mc_p25": sim["p25"][i],
            "mc_p75": sim["p75"][i], "mc_p95": sim["p95"][i]} for i, p in enumerate(prediction["prediction"])]
    requests.post(f"{SUPABASE_URL}/rest/v1/forecast_points",
                  headers=_h("return=minimal"), json=pts, timeout=30).raise_for_status()
    return rid


# --------------------------------------------------------------------------- #
# Guardado COMPLETO (todas las curvas) — usado por /save-snapshot
# --------------------------------------------------------------------------- #
def save_full_snapshot(ticker: str, last_close: float, horizon: int,
                       points: list[dict], meta: dict | None = None) -> Optional[str]:
    """
    points: lista de dicts con claves opcionales por punto:
      target_date, xgb, mlp, ml_sentiment, sentiment_only, psy_a, psy_b,
      mc_median, mc_p5, mc_p25, mc_p75, mc_p95
    """
    if not _ENABLED:
        return None
    meta = meta or {}
    run = {"ticker": ticker.upper(), "run_date": dt.date.today().isoformat(),
           "last_close": last_close, "horizon": horizon,
           "model_version": meta.get("trained_at"), "mu_daily": meta.get("mu_daily"),
           "sigma_daily": meta.get("sigma_daily"),
           "directional_accuracy": meta.get("metrics", {}).get("directional_accuracy")}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/forecast_runs",
                      headers=_h("return=representation"), json=run, timeout=20)
    r.raise_for_status()
    rid = r.json()[0]["id"]
    pts = [{"run_id": rid, "ticker": ticker.upper(), "target_date": p["target_date"],
            "predicted": p.get("xgb"), "mlp": p.get("mlp"),
            "ml_sentiment": p.get("ml_sentiment"), "sentiment_only": p.get("sentiment_only"),
            "psy_a": p.get("psy_a"), "psy_b": p.get("psy_b"),
            "mc_median": p.get("mc_median"), "mc_p5": p.get("mc_p5"),
            "mc_p25": p.get("mc_p25"), "mc_p75": p.get("mc_p75"), "mc_p95": p.get("mc_p95")}
           for p in points]
    requests.post(f"{SUPABASE_URL}/rest/v1/forecast_points",
                  headers=_h("return=minimal"), json=pts, timeout=30).raise_for_status()
    return rid


# --------------------------------------------------------------------------- #
# Lectura del histórico (ahora incluye todas las curvas)
# --------------------------------------------------------------------------- #
_POINT_COLS = ("run_id,target_date,predicted,mlp,ml_sentiment,sentiment_only,"
               "psy_a,psy_b,mc_median,mc_p5,mc_p25,mc_p75,mc_p95,actual_close")


def get_forecast_history(ticker: str, limit_runs: int = 10) -> list[dict]:
    if not _ENABLED:
        return []
    r = requests.get(f"{SUPABASE_URL}/rest/v1/forecast_runs", headers=_h(),
                     params={"ticker": f"eq.{ticker.upper()}", "order": "run_date.desc,created_at.desc",
                             "limit": str(limit_runs),
                             "select": "id,run_date,last_close,horizon,model_version,created_at"}, timeout=20)
    r.raise_for_status()
    runs = r.json()
    if not runs:
        return []
    ids = ",".join(x["id"] for x in runs)
    p = requests.get(f"{SUPABASE_URL}/rest/v1/forecast_points", headers=_h(),
                     params={"run_id": f"in.({ids})", "order": "target_date.asc",
                             "select": _POINT_COLS}, timeout=20)
    p.raise_for_status()
    by: dict = {}
    for pt in p.json():
        by.setdefault(pt["run_id"], []).append(pt)
    return [{"run_id": rn["id"], "run_date": rn["run_date"], "last_close": rn["last_close"],
             "horizon": rn.get("horizon"), "created_at": rn.get("created_at"),
             "points": by.get(rn["id"], [])} for rn in runs]


# --------------------------------------------------------------------------- #
# Backfill de precios reales (rellena actual_close para todas las corridas)
# --------------------------------------------------------------------------- #
def update_actuals(ticker: str, date_close_map: dict) -> int:
    if not _ENABLED:
        return 0
    n = 0
    for d, c in date_close_map.items():
        r = requests.patch(f"{SUPABASE_URL}/rest/v1/forecast_points",
                           headers=_h("return=minimal"),
                           params={"ticker": f"eq.{ticker.upper()}", "target_date": f"eq.{d}"},
                           json={"actual_close": c}, timeout=20)
        if r.ok:
            n += 1
    return n
