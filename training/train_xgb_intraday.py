"""
train_xgb_intraday.py — Modelo XGBoost INTRADÍA (barras de 15 min)
==================================================================
AISLADO del modelo diario: no importa ni modifica train_xgb.py. Comparte solo
piezas neutrales (cliente Polygon) cuando se conecte a datos reales.

QUÉ PREDICE (target):
    El retorno log de la SIGUIENTE barra de 15 min:  y_t = ln( C_{t+1} / C_t )
    En inferencia se aplica recursivamente hasta el cierre (16:00 ET) para
    dibujar la curva completa del resto del día.

FEATURES INTRADÍA (12): hora del día (sin/cos), barras restantes, retorno desde
    apertura, distancia al VWAP, rango relativo, volumen relativo, gap overnight,
    y 4 retornos rezagados de 15 min.

BLINDAJE: clamp del retorno a ±K·σ para que la predicción recursiva no explote.

Ventana de entrenamiento: 120 días de barras de 15 min (plan Starter de Polygon).

Uso:
    python training/train_xgb_intraday.py --ticker NVDA --days 120
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

# Cliente Polygon compartido (rate-limit + caché) — vive en api/
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_json, TTL_INTRADAY  # noqa: E402

try:
    from xgboost import XGBRegressor
    from sklearn.metrics import mean_absolute_error, r2_score
    import joblib
except Exception:  # pragma: no cover
    XGBRegressor = None

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

# Sesión regular US: 9:30–16:00 ET = 6.5 h = 26 barras de 15 min
BARS_PER_SESSION = 26
CLAMP_K = 3.0            # tope del retorno por barra (±K·σ)
LOOKBACK_RETS = 4        # nº de retornos rezagados de 15 min como memoria corta

# Ventana de sesión regular en minutos desde medianoche ET
SESSION_START_MIN = 9 * 60 + 30   # 09:30 -> 570
SESSION_END_MIN = 16 * 60         # 16:00 -> 960


# --------------------------------------------------------------------------- #
# Descarga de barras de 15 min desde Polygon (plan Starter)
# --------------------------------------------------------------------------- #
def fetch_intraday_polygon(ticker: str, days: int = 120) -> pd.DataFrame:
    """
    Descarga barras de 15 min de los últimos `days` días de calendario y filtra
    SOLO el horario regular (9:30–16:00 ET). Requiere plan Starter (sin límite de
    5/min y con minute/15-min aggregates).
    """
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    end = dt.date.today()
    start = end - dt.timedelta(days=int(days * 1.5))  # margen por fines de semana/feriados
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/15/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
    results = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    if not results:
        raise ValueError(f"Polygon no devolvió barras de 15 min para {ticker}")
    df = pd.DataFrame(results).rename(columns={"o": "open", "h": "high", "l": "low",
                                               "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_utc"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df["dt_et"] = df["dt_utc"].dt.tz_convert("America/New_York")
    return filter_regular_session(df).tail(days * BARS_PER_SESSION).reset_index(drop=True)


def filter_regular_session(df: pd.DataFrame) -> pd.DataFrame:
    """Conserva solo las barras cuyo INICIO cae en 09:30–15:45 ET (26 por día)."""
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    mask = (mins >= SESSION_START_MIN) & (mins < SESSION_END_MIN)
    return df.loc[mask, ["dt_et", "open", "high", "low", "close", "volume"]].sort_values("dt_et").reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Ingeniería de features intradía  (idéntica al Paso 1)
# --------------------------------------------------------------------------- #
def add_intraday_features(df: pd.DataFrame) -> pd.DataFrame:
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

    out["target"] = out.groupby("day")["ret"].shift(-1)
    return out


FEATURE_COLS = [
    "tod_sin", "tod_cos", "bars_left",
    "ret_from_open", "dist_vwap", "range_rel", "vol_rel", "gap",
    "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_4",
]


# --------------------------------------------------------------------------- #
# Entrenamiento  (idéntico al Paso 1)
# --------------------------------------------------------------------------- #
def train_from_df(df: pd.DataFrame, ticker: str):
    if XGBRegressor is None:
        raise RuntimeError("xgboost/sklearn no disponibles en el entorno.")
    feat = add_intraday_features(df).dropna(subset=FEATURE_COLS + ["target"]).reset_index(drop=True)
    X = feat[FEATURE_COLS].values
    y = feat["target"].values
    if len(X) < 200:
        raise ValueError(f"Muy pocas muestras intradía ({len(X)}) para entrenar.")

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
    sigma_15m = float(np.nanstd(feat["ret"].values))

    meta = {
        "ticker": ticker.upper(), "model": "XGBoost-intraday-15m",
        "interval_min": 15, "bars_per_session": BARS_PER_SESSION,
        "clamp_k": CLAMP_K, "sigma_15m": round(sigma_15m, 6),
        "trained_at": dt.datetime.utcnow().isoformat() + "Z",
        "n_samples": int(len(X)), "feature_cols": FEATURE_COLS,
        "metrics": {"mae": mae, "r2": r2, "directional_accuracy": dir_acc},
    }
    return model, meta


# --------------------------------------------------------------------------- #
# Orquestador: descarga Polygon + entrena + guarda artefactos
# --------------------------------------------------------------------------- #
def train(ticker: str, days: int = 120) -> dict:
    print(f"[1/3] Descargando {days} días de barras de 15 min de {ticker}...")
    df = fetch_intraday_polygon(ticker, days)
    print(f"      {len(df)} barras · {df['dt_et'].dt.date.nunique()} sesiones")

    print("[2/3] Entrenando XGBoost intradía...")
    model, meta = train_from_df(df, ticker)

    print("[3/3] Guardando artefactos...")
    joblib.dump(model, ARTIFACT_DIR / f"xgb_intraday_{ticker.upper()}.joblib")
    with open(ARTIFACT_DIR / f"meta_intraday_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)

    m = meta["metrics"]
    print(f"\n[OK] {ticker.upper()} intradía | Dir.Acc={m['directional_accuracy']:.1%} | "
          f"MAE={m['mae']:.5f} | σ15m={meta['sigma_15m']:.5f} | n={meta['n_samples']}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--days", type=int, default=120)
    args = ap.parse_args()
    train(args.ticker, args.days)
