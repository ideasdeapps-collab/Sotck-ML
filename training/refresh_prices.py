"""
refresh_prices.py — Puebla/actualiza la caché de precios en Supabase (Fase 1)
=============================================================================
Descarga los precios diarios desde Polygon y los ESCRIBE en price_cache, para
que los usuarios los lean desde ahí (sin tocar Polygon). Pensado para correr en
el workflow diario, junto al reentrenamiento.

Uso:
    python training/refresh_prices.py                 # lista completa
    python training/refresh_prices.py --tickers NVDA META --years 2
"""

import os
import sys
import time
import argparse
from pathlib import Path

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
import price_store  # noqa: E402
# Fuerza la descarga desde Polygon (no desde caché) para refrescar de verdad
os.environ["USE_PRICE_CACHE"] = "0"
from train_xgb import _fetch_daily_polygon  # noqa: E402

DEFAULT_TICKERS = ["SNDK", "SMH", "AMAT", "TSM", "QQQ", "NVDA", "MU", "XLI", "AVGO",
                   "SPCX", "KOID", "BOTZ", "IGV", "ASML", "META", "SKHY", "SOXX", "IDGT"]


def refresh(tickers, years=2, sleep_s=13):
    if not price_store.enabled():
        print("[ERROR] Supabase no está configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).")
        return
    ok, fail = 0, 0
    for t in tickers:
        try:
            df = _fetch_daily_polygon(t, years)          # 1 llamada Polygon
            n = price_store.write_prices(t, df)
            print(f"[OK] {t}: {n} filas escritas en price_cache "
                  f"(hasta {df['date'].iloc[-1].date()})")
            ok += 1
        except Exception as e:
            print(f"[FAIL] {t}: {e}")
            fail += 1
        time.sleep(sleep_s)   # respeta 5 llamadas/min del plan gratuito
    print(f"\nResumen: {ok} ok · {fail} fallidos")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="*", default=DEFAULT_TICKERS)
    ap.add_argument("--years", type=int, default=2)
    args = ap.parse_args()
    refresh([t.upper() for t in args.tickers], args.years)
