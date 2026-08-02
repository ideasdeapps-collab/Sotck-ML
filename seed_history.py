"""
seed_history.py — Siembra inicial del histórico de forecasts en Supabase
========================================================================
Genera de golpe forecasts para toda la lista de tickers y los guarda en
Supabase, de modo que la gráfica de "predicciones pasadas" tenga datos desde
el día uno. También rellena precios reales (backfill) de días ya ocurridos.

Requiere modelos ya entrenados (api/artifacts/xgb_<T>.joblib) y las variables:
    POLYGON_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

Uso:
    python training/seed_history.py                 # lista completa
    python training/seed_history.py --tickers NVDA META
    python training/seed_history.py --horizon 30 --backfill-days 60
"""

import sys
import argparse
from pathlib import Path

# Permitir importar módulos de la carpeta api/
API_DIR = Path(__file__).resolve().parent.parent / "api"
sys.path.append(str(API_DIR))

import json  # noqa: E402
import joblib  # noqa: E402
from simulate import monte_carlo_gbm  # noqa: E402
import supabase_client as sb  # noqa: E402
from intraday import fetch_intraday  # noqa: E402 (solo para validar API key temprano)

# Importa la lógica de predicción de la API
import main as api  # noqa: E402

DEFAULT_TICKERS = [
    "SNDK", "SMH", "AMAT", "TSM", "QQQ", "NVDA", "MU", "XLI", "AVGO",
    "SPCX", "KOID", "BOTZ", "IGV", "ASML", "META", "SKHY", "SOXX", "IDGT",
]

ARTIFACT_DIR = API_DIR / "artifacts"


def seed(tickers, horizon=30, n_sims=10000, backfill_days=60):
    if not sb.enabled():
        print("[ERROR] Supabase no está configurado (SUPABASE_URL / "
              "SUPABASE_SERVICE_KEY). No hay dónde guardar el histórico.")
        return

    ok, skipped, failed = 0, 0, 0
    for t in tickers:
        model_path = ARTIFACT_DIR / f"xgb_{t}.joblib"
        if not model_path.exists():
            print(f"[SKIP] {t}: sin modelo entrenado. "
                  f"Corre train_xgb.py --ticker {t} primero.")
            skipped += 1
            continue
        try:
            print(f"[SEED] {t}: generando forecast ({horizon}d)...")
            pred = api.predict_curve(t, horizon)
            _, meta = api.load_model(t)
            sim = monte_carlo_gbm(
                s0=meta["last_close"], mu_daily=meta["mu_daily"],
                sigma_daily=meta["sigma_daily"], horizon=horizon, n_sims=n_sims)
            run_id = sb.save_forecast(pred, sim, meta)
            print(f"        guardado run_id={run_id}")

            # Backfill de precios reales para días ya ocurridos
            api.backfill_actuals(ticker=t, days=backfill_days)
            print(f"        backfill de {backfill_days} días OK")
            ok += 1
        except Exception as e:
            print(f"[FAIL] {t}: {e}")
            failed += 1

    print(f"\nResumen: {ok} sembrados | {skipped} sin modelo | {failed} fallidos")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="*", default=DEFAULT_TICKERS)
    ap.add_argument("--horizon", type=int, default=30)
    ap.add_argument("--n-sims", type=int, default=10000)
    ap.add_argument("--backfill-days", type=int, default=60)
    args = ap.parse_args()
    seed([t.upper() for t in args.tickers], args.horizon,
         args.n_sims, args.backfill_days)
