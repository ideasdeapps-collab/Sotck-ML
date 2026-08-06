"""
train_xgb_extended.py — XGBoost DIARIO con AFTER-HOURS + PREMARKET (independiente)
=================================================================================
Modelo diario que, además de la sesión regular (RTH), aprende del horario
extendido (premarket + after-hours) donde se gesta el gap de apertura.

TOTALMENTE AISLADO del modelo original: no importa ni modifica train_xgb.py.
Artefactos propios:  api/artifacts/xgb_ext_<TICKER>.joblib
                     api/artifacts/meta_ext_<TICKER>.json

Ventanas ET: PM 04:00–09:30 · RTH 09:30–16:00 · AH 16:00–20:00
Requiere plan STARTER de Polygon (barras de 5-min con horario extendido).

Uso: python training/train_xgb_extended.py --ticker NVDA --years 2
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
from polygon_client import get_json, TTL_DAILY  # noqa: E402

try:
    from xgboost import XGBRegressor
    from sklearn.metrics import mean_absolute_error, r2_score
    import joblib
except Exception:  # pragma: no cover
    XGBRegressor = None

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

PM_START, RTH_START, RTH_END, AH_END = 4 * 60, 9 * 60 + 30, 16 * 60, 20 * 60


# --------------------------------------------------------------------------- #
# Descarga: barras de 5-min CON horario extendido (Polygon Starter)
# --------------------------------------------------------------------------- #
def fetch_extended_5min(ticker: str, years: int = 2) -> pd.DataFrame:
    """5-min OHLCV incluyendo premarket y after-hours (adjusted, sin filtrar hora)."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25))
    frames = []
    # Polygon pagina; iteramos por tramos de ~50 días para no exceder el limit
    cur = start
    while cur < end:
        chunk_end = min(cur + dt.timedelta(days=50), end)
        url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/5/minute/"
               f"{cur.isoformat()}/{chunk_end.isoformat()}"
               f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
        res = get_json(url, ttl=TTL_DAILY).get("results", [])
        if res:
            frames.append(pd.DataFrame(res))
        cur = chunk_end + dt.timedelta(days=1)
    if not frames:
        raise ValueError(f"Polygon no devolvió barras de 5min para {ticker}")
    df = pd.concat(frames, ignore_index=True).rename(
        columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_et"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert("America/New_York")
    return df[["dt_et", "open", "high", "low", "close", "volume"]].sort_values("dt_et").reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Clasificar por ventana (PM/RTH/AH) y agregar por día
# --------------------------------------------------------------------------- #
def classify_and_aggregate(bars: pd.DataFrame) -> pd.DataFrame:
    b = bars.copy()
    b["day"] = b["dt_et"].dt.date
    mins = b["dt_et"].dt.hour * 60 + b["dt_et"].dt.minute
    b["win"] = np.select(
        [(mins >= PM_START) & (mins < RTH_START),
         (mins >= RTH_START) & (mins < RTH_END),
         (mins >= RTH_END) & (mins < AH_END)],
        ["PM", "RTH", "AH"], default="OTHER")
    rows = []
    for day, g in b.groupby("day"):
        pm, rth, ah = g[g.win == "PM"], g[g.win == "RTH"], g[g.win == "AH"]
        if rth.empty:
            continue
        rows.append({
            "date": pd.Timestamp(day),
            "open": float(rth["open"].iloc[0]), "high": float(rth["high"].max()),
            "low": float(rth["low"].min()), "close": float(rth["close"].iloc[-1]),
            "volume": float(rth["volume"].sum()),
            "pm_first": float(pm["open"].iloc[0]) if len(pm) else np.nan,
            "pm_last": float(pm["close"].iloc[-1]) if len(pm) else np.nan,
            "pm_vol": float(pm["volume"].sum()) if len(pm) else 0.0,
            "ah_last": float(ah["close"].iloc[-1]) if len(ah) else np.nan,
            "ah_vol": float(ah["volume"].sum()) if len(ah) else 0.0,
            "ah_high": float(ah["high"].max()) if len(ah) else np.nan,
            "ah_low": float(ah["low"].min()) if len(ah) else np.nan,
        })
    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Features: base diarias + EXTENDIDAS
# --------------------------------------------------------------------------- #
def add_features(daily: pd.DataFrame) -> pd.DataFrame:
    out = daily.copy()
    c = out["close"]
    out["log_ret"] = np.log(c / c.shift(1))
    for w in (5, 10, 20):
        out[f"sma_ratio_{w}"] = c / c.rolling(w).mean()
    out["vol_10"] = out["log_ret"].rolling(10).std()
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean(); loss = (-delta.clip(upper=0)).rolling(14).mean()
    out["rsi_14"] = 100 - 100 / (1 + gain / (loss + 1e-9))
    out["mom_5"] = c / c.shift(5) - 1
    for k in (1, 2, 3):
        out[f"ret_lag_{k}"] = out["log_ret"].shift(k)

    prev_close = c.shift(1)
    rth_vol = out["volume"].replace(0, np.nan)
    ah_last_prev, ah_vol_prev = out["ah_last"].shift(1), out["ah_vol"].shift(1)
    out["ah_return"] = np.log(ah_last_prev / prev_close).replace([np.inf, -np.inf], 0).fillna(0)
    out["ah_volume_ratio"] = (ah_vol_prev / rth_vol.shift(1)).replace([np.inf, -np.inf], 0).fillna(0)
    out["pm_return"] = np.log(out["open"] / out["pm_first"]).replace([np.inf, -np.inf], 0).fillna(0)
    out["pm_volume_ratio"] = (out["pm_vol"] / rth_vol.rolling(10).mean()).replace([np.inf, -np.inf], 0).fillna(0)
    out["overnight_gap"] = np.log(out["open"] / prev_close).replace([np.inf, -np.inf], 0).fillna(0)
    out["ah_pm_align"] = np.sign(out["ah_return"]) * np.sign(out["pm_return"])
    ah_hi_prev, ah_lo_prev = out["ah_high"].shift(1), out["ah_low"].shift(1)
    ext_hi = np.nanmax(np.vstack([ah_hi_prev, out["pm_last"], out["open"]]), axis=0)
    ext_lo = np.nanmin(np.vstack([ah_lo_prev, out["pm_first"], out["open"]]), axis=0)
    out["ext_range"] = ((ext_hi - ext_lo) / prev_close).replace([np.inf, -np.inf], 0).fillna(0)

    out["target"] = out["log_ret"].shift(-1)
    return out


BASE_FEATURES = ["sma_ratio_5", "sma_ratio_10", "sma_ratio_20", "vol_10", "rsi_14",
                 "mom_5", "ret_lag_1", "ret_lag_2", "ret_lag_3"]
EXT_FEATURES = ["ah_return", "ah_volume_ratio", "pm_return", "pm_volume_ratio",
                "overnight_gap", "ah_pm_align", "ext_range"]
ALL_FEATURES = BASE_FEATURES + EXT_FEATURES


# --------------------------------------------------------------------------- #
# Entrenamiento + guardado
# --------------------------------------------------------------------------- #
def train_from_daily(daily: pd.DataFrame, ticker: str):
    if XGBRegressor is None:
        raise RuntimeError("xgboost/sklearn no disponibles.")
    feat = add_features(daily).dropna(subset=ALL_FEATURES + ["target"]).reset_index(drop=True)
    if len(feat) < 120:
        raise ValueError(f"Histórico insuficiente ({len(feat)} días) para el modelo extendido.")
    X, y = feat[ALL_FEATURES].values, feat["target"].values
    split = int(len(X) * 0.8)
    model = XGBRegressor(n_estimators=400, max_depth=4, learning_rate=0.03,
                         subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
                         objective="reg:squarederror", n_jobs=-1, random_state=42)
    model.fit(X[:split], y[:split])
    p = model.predict(X[split:])
    ext_imp = float(sum(model.feature_importances_[len(BASE_FEATURES):]))
    meta = {
        "ticker": ticker.upper(), "model": "XGBoost-extended (RTH+AH+PM)",
        "trained_at": dt.datetime.utcnow().isoformat() + "Z",
        "last_close": float(feat["close"].iloc[-1]),
        "last_date": feat["date"].iloc[-1].date().isoformat(),
        "mu_daily": float(feat["log_ret"].mean()), "sigma_daily": float(feat["log_ret"].std()),
        "feature_cols": ALL_FEATURES, "ext_importance": round(ext_imp, 4),
        "metrics": {"mae": float(mean_absolute_error(y[split:], p)),
                    "r2": float(r2_score(y[split:], p)),
                    "directional_accuracy": float(np.mean(np.sign(p) == np.sign(y[split:])))},
        # snapshot de las últimas features extendidas reales (para inferencia día 1)
        "last_ext_features": {k: float(feat[k].iloc[-1]) for k in EXT_FEATURES},
    }
    return model, meta, feat


def train(ticker: str, years: int = 2) -> dict:
    print(f"[1/4] Descargando 5-min extendido de {ticker} ({years} años)...")
    bars = fetch_extended_5min(ticker, years)
    print(f"      {len(bars)} barras de 5-min (incl. PM/AH)")
    print("[2/4] Agregando por día (PM/RTH/AH)...")
    daily = classify_and_aggregate(bars)
    print(f"      {len(daily)} días")
    print("[3/4] Entrenando XGBoost extendido...")
    model, meta, _ = train_from_daily(daily, ticker)
    print("[4/4] Guardando artefactos...")
    joblib.dump(model, ARTIFACT_DIR / f"xgb_ext_{ticker.upper()}.joblib")
    with open(ARTIFACT_DIR / f"meta_ext_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)
    m = meta["metrics"]
    print(f"\n[OK] {ticker.upper()} extendido | Dir.Acc={m['directional_accuracy']:.1%} | "
          f"MAE={m['mae']:.5f} | peso features AH/PM={meta['ext_importance']:.1%}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--years", type=int, default=2)
    args = ap.parse_args()
    train(args.ticker, args.years)
