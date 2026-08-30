"""
train_xgb_1m.py — Modelo XGBoost INTRADÍA de 1 MINUTO
=====================================================
AISLADO de train_xgb_intraday.py (15 min) y de train_xgb.py (diario). No los
importa ni los modifica: comparte solo el cliente de Polygon.

QUÉ PREDICE:
    El retorno log de la SIGUIENTE barra de 1 min:  y_t = ln( C_{t+1} / C_t )
    En inferencia se aplica recursivamente 30 barras (media hora), NO hasta el
    cierre: 390 pasos encadenados de retorno acotado degeneran en una recta.

FEATURES (15): hora del día (sin/cos), barras restantes, retorno desde la
    apertura, distancia al VWAP, rango relativo, volumen relativo, gap overnight,
    5 retornos rezagados de 1 min, y retornos agregados de 5 y 15 min.

    Los dos agregados no están en el modelo de 15 min y aquí hacen falta: cinco
    barras de un minuto son cinco minutos de memoria, que a esta granularidad es
    casi solo ruido.

BLINDAJE: clamp del retorno a ±K·σ.

Ventana: 60 días de barras de 1 min (plan Starter de Polygon, paginado).

Uso:
    python training/train_xgb_1m.py --ticker NVDA --days 60
"""

from __future__ import annotations
import os
import sys
import json
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_paginated, TTL_INTRADAY  # noqa: E402

try:
    from xgboost import XGBRegressor
    from sklearn.metrics import mean_absolute_error, r2_score
    import joblib
except Exception:  # pragma: no cover
    XGBRegressor = None

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

# Sesión regular US: 9:30–16:00 ET = 6.5 h = 390 barras de 1 min
BARS_PER_SESSION = 390
CLAMP_K = 3.0
LOOKBACK_RETS = 5

SESSION_START_MIN = 9 * 60 + 30   # 09:30 -> 570
SESSION_END_MIN = 16 * 60         # 16:00 -> 960

FEATURE_COLS = [
    "tod_sin", "tod_cos", "bars_left",
    "ret_from_open", "dist_vwap", "range_rel", "vol_rel", "gap",
    "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_4", "ret_lag_5",
    "ret_5m", "ret_15m",
]


def filter_regular_session(df: pd.DataFrame) -> pd.DataFrame:
    """Conserva solo las barras cuyo INICIO cae en 09:30–15:59 ET (390 por día)."""
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    mask = (mins >= SESSION_START_MIN) & (mins < SESSION_END_MIN)
    cols = ["dt_et", "open", "high", "low", "close", "volume"]
    return df.loc[mask, cols].sort_values("dt_et").reset_index(drop=True)


def fetch_1m_polygon(ticker: str, days: int = 60) -> pd.DataFrame:
    """
    Descarga barras de 1 min de los últimos `days` días y filtra la sesión
    regular. Paginado: una sola página se queda corta y truncaría en silencio.
    """
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")

    end = dt.date.today()
    start = end - dt.timedelta(days=int(days * 1.5))  # margen por findes y feriados
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")

    page = get_paginated(url, ttl=TTL_INTRADAY)
    results = page["results"]
    if not results:
        raise ValueError(f"Polygon no devolvió barras de 1 min para {ticker}")
    if page["truncated"]:
        print(f"[aviso] descarga truncada para {ticker}: faltan páginas")

    df = pd.DataFrame(results).rename(columns={"o": "open", "h": "high", "l": "low",
                                               "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_utc"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df["dt_et"] = df["dt_utc"].dt.tz_convert("America/New_York")
    return filter_regular_session(df).tail(days * BARS_PER_SESSION).reset_index(drop=True)


def add_1m_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Features intradía de 1 min. Todo se reinicia por día: un retorno o un VWAP
    que cruce el cierre y la apertura siguiente mezcla dos sesiones distintas.
    """
    out = df.copy().sort_values("dt_et").reset_index(drop=True)
    out["day"] = out["dt_et"].dt.date

    out["ret"] = np.log(out["close"] / out["close"].shift(1))
    first_of_day = out["day"] != out["day"].shift(1)
    out.loc[first_of_day, "ret"] = np.nan

    out["bar_idx"] = out.groupby("day").cumcount()

    m = out["bar_idx"].clip(upper=BARS_PER_SESSION - 1)
    out["tod_sin"] = np.sin(2 * np.pi * m / BARS_PER_SESSION)
    out["tod_cos"] = np.cos(2 * np.pi * m / BARS_PER_SESSION)
    out["bars_left"] = (BARS_PER_SESSION - 1 - m).clip(lower=0) / BARS_PER_SESSION

    open_px = out.groupby("day")["open"].transform("first")
    out["ret_from_open"] = np.log(out["close"] / open_px)

    tp = (out["high"] + out["low"] + out["close"]) / 3
    pv = tp * out["volume"]
    cum_pv = pv.groupby(out["day"]).cumsum()
    cum_v = out["volume"].groupby(out["day"]).cumsum().replace(0, np.nan)
    vwap = cum_pv / cum_v
    out["dist_vwap"] = (out["close"] - vwap) / vwap

    out["range_rel"] = (out["high"] - out["low"]) / out["close"].replace(0, np.nan)
    vol_mean_day = out.groupby("day")["volume"].transform(lambda s: s.expanding().mean())
    out["vol_rel"] = out["volume"] / vol_mean_day.replace(0, np.nan)

    last_close_by_day = out.groupby("day")["close"].last()
    prev_close_by_day = last_close_by_day.shift(1)
    open_by_day = out.groupby("day")["open"].first()
    gap_by_day = (open_by_day / prev_close_by_day - 1.0)
    out["gap"] = out["day"].map(gap_by_day).fillna(0.0)

    for k in range(1, LOOKBACK_RETS + 1):
        out[f"ret_lag_{k}"] = out.groupby("day")["ret"].shift(k)

    # Contexto de medio plazo: sin esto el modelo solo ve microestructura.
    for window in (5, 15):
        prev = out.groupby("day")["close"].shift(window)
        out[f"ret_{window}m"] = np.log(out["close"] / prev)

    out["target"] = out.groupby("day")["ret"].shift(-1)
    return out


def train_from_df(df: pd.DataFrame, ticker: str):
    if XGBRegressor is None:
        raise RuntimeError("xgboost/sklearn no disponibles en el entorno.")

    feat = add_1m_features(df).dropna(subset=FEATURE_COLS + ["target"]).reset_index(drop=True)
    X = feat[FEATURE_COLS].values
    y = feat["target"].values
    if len(X) < 2000:
        raise ValueError(f"Muy pocas muestras de 1 min ({len(X)}) para entrenar.")

    # Corte temporal, no aleatorio: barajar filtraría el futuro al entrenamiento.
    split = int(len(X) * 0.8)
    model = XGBRegressor(
        n_estimators=300, max_depth=4, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
        objective="reg:squarederror", n_jobs=-1, random_state=42)
    model.fit(X[:split], y[:split])

    pred = model.predict(X[split:])
    mae = float(mean_absolute_error(y[split:], pred))
    r2 = float(r2_score(y[split:], pred))
    dir_acc = float(np.mean(np.sign(pred) == np.sign(y[split:])))
    sigma_1m = float(np.nanstd(feat["ret"].values))

    meta = {
        "ticker": ticker.upper(), "model": "XGBoost-intraday-1m",
        "interval_min": 1, "bars_per_session": BARS_PER_SESSION,
        "clamp_k": CLAMP_K, "sigma_1m": round(sigma_1m, 8),
        "trained_at": dt.datetime.utcnow().isoformat() + "Z",
        "n_samples": int(len(X)), "feature_cols": FEATURE_COLS,
        "metrics": {"mae": mae, "r2": r2, "directional_accuracy": dir_acc},
    }
    return model, meta


def train(ticker: str, days: int = 60) -> dict:
    print(f"[1/3] Descargando {days} días de barras de 1 min de {ticker}...")
    df = fetch_1m_polygon(ticker, days)
    print(f"      {len(df)} barras · {df['dt_et'].dt.date.nunique()} sesiones")

    print("[2/3] Entrenando XGBoost de 1 min...")
    model, meta = train_from_df(df, ticker)

    print("[3/3] Guardando artefactos...")
    joblib.dump(model, ARTIFACT_DIR / f"xgb_1m_{ticker.upper()}.joblib")
    with open(ARTIFACT_DIR / f"meta_1m_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)

    m = meta["metrics"]
    print(f"\n[OK] {ticker.upper()} 1m | Dir.Acc={m['directional_accuracy']:.1%} | "
          f"MAE={m['mae']:.6f} | σ1m={meta['sigma_1m']:.6f} | n={meta['n_samples']}")
    if m["directional_accuracy"] > 0.55:
        print("[!] Dir.Acc > 55% a 1 minuto es sospechoso: revisa fuga de datos "
              "antes de darlo por bueno.")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--days", type=int, default=60)
    args = ap.parse_args()
    train(args.ticker, args.days)
