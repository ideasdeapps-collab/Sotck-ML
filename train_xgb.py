"""
train_xgb.py
------------
Entrena un modelo XGBoost para predecir el retorno logarítmico del día siguiente
usando datos históricos de Polygon.io + features técnicas.

El artefacto resultante (modelo + metadatos) se guarda en artifacts/.
Se ejecuta localmente o vía GitHub Actions (ver .github/workflows/retrain.yml).

Uso:
    python training/train_xgb.py --ticker AAPL --years 5
"""

import os
import sys
import json
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, r2_score

# Cliente Polygon compartido (rate-limit 5/min + caché) — vive en api/
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_json, TTL_DAILY  # noqa: E402

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# 1. Descarga de datos desde Polygon
# --------------------------------------------------------------------------- #
def fetch_polygon(ticker: str, years: int = 5) -> pd.DataFrame:
    """Descarga barras diarias (OHLCV) de Polygon para 'ticker'."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta la variable de entorno POLYGON_API_KEY")

    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25))
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/day/"
        f"{start.isoformat()}/{end.isoformat()}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}"
    )
    # get_json respeta 5 llamadas/min y cachea el diario 1h (free tier seguro).
    results = get_json(url, ttl=TTL_DAILY).get("results", [])
    if not results:
        raise ValueError(f"Polygon no devolvió datos para {ticker}")

    df = pd.DataFrame(results)
    df = df.rename(
        columns={"o": "open", "h": "high", "l": "low", "c": "close",
                 "v": "volume", "t": "timestamp"}
    )
    df["date"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df[["date", "open", "high", "low", "close", "volume"]].sort_values("date")
    return df.reset_index(drop=True)


# --------------------------------------------------------------------------- #
# 2. Ingeniería de features técnicas
# --------------------------------------------------------------------------- #
def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Genera indicadores técnicos usados como variables predictoras."""
    out = df.copy()
    out["log_ret"] = np.log(out["close"] / out["close"].shift(1))

    # Medias móviles
    for w in (5, 10, 20, 50):
        out[f"sma_{w}"] = out["close"].rolling(w).mean()
        out[f"sma_ratio_{w}"] = out["close"] / out[f"sma_{w}"]

    # Volatilidad (desviación de retornos)
    out["vol_10"] = out["log_ret"].rolling(10).std()
    out["vol_20"] = out["log_ret"].rolling(20).std()

    # RSI (14)
    delta = out["close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    out["rsi_14"] = 100 - (100 / (1 + rs))

    # MACD
    ema12 = out["close"].ewm(span=12, adjust=False).mean()
    ema26 = out["close"].ewm(span=26, adjust=False).mean()
    out["macd"] = ema12 - ema26
    out["macd_signal"] = out["macd"].ewm(span=9, adjust=False).mean()

    # Momentum y volumen
    out["momentum_10"] = out["close"] / out["close"].shift(10) - 1
    out["vol_change"] = out["volume"] / out["volume"].rolling(20).mean()

    # Retornos rezagados
    for lag in (1, 2, 3, 5):
        out[f"ret_lag_{lag}"] = out["log_ret"].shift(lag)

    # TARGET: retorno log del día siguiente
    out["target"] = out["log_ret"].shift(-1)
    return out


FEATURE_COLS = [
    "sma_ratio_5", "sma_ratio_10", "sma_ratio_20", "sma_ratio_50",
    "vol_10", "vol_20", "rsi_14", "macd", "macd_signal",
    "momentum_10", "vol_change",
    "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5",
]


# --------------------------------------------------------------------------- #
# 3. Entrenamiento
# --------------------------------------------------------------------------- #
def train(ticker: str, years: int = 5) -> dict:
    print(f"[1/4] Descargando {ticker} desde Polygon...")
    raw = fetch_polygon(ticker, years)

    print("[2/4] Generando features...")
    df = add_features(raw).dropna().reset_index(drop=True)

    X = df[FEATURE_COLS].values
    y = df["target"].values

    # Split temporal (sin barajar): 80% train / 20% test
    split = int(len(X) * 0.8)
    X_tr, X_te = X[:split], X[split:]
    y_tr, y_te = y[:split], y[split:]

    print("[3/4] Entrenando XGBoost...")
    model = XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        objective="reg:squarederror",
        n_jobs=-1,
        random_state=42,
    )
    model.fit(X_tr, y_tr, eval_set=[(X_te, y_te)], verbose=False)

    # Métricas
    pred = model.predict(X_te)
    mae = mean_absolute_error(y_te, pred)
    r2 = r2_score(y_te, pred)
    # Accuracy direccional (¿acierta el signo del movimiento?)
    dir_acc = float(np.mean(np.sign(pred) == np.sign(y_te)))

    # Estadísticos para la simulación Monte Carlo
    mu_daily = float(df["log_ret"].mean())
    sigma_daily = float(df["log_ret"].std())

    print("[4/4] Guardando artefactos...")
    joblib.dump(model, ARTIFACT_DIR / f"xgb_{ticker.upper()}.joblib")

    meta = {
        "ticker": ticker.upper(),
        "trained_at": dt.datetime.utcnow().isoformat() + "Z",
        "n_samples": int(len(X)),
        "feature_cols": FEATURE_COLS,
        "last_close": float(raw["close"].iloc[-1]),
        "last_date": raw["date"].iloc[-1].date().isoformat(),
        "mu_daily": mu_daily,
        "sigma_daily": sigma_daily,
        "metrics": {"mae": mae, "r2": r2, "directional_accuracy": dir_acc},
    }
    with open(ARTIFACT_DIR / f"meta_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(
        f"\n[OK] {ticker.upper()} | MAE={mae:.5f} | R2={r2:.3f} | "
        f"Dir.Acc={dir_acc:.1%} | mu={mu_daily:.5f} | sigma={sigma_daily:.5f}"
    )
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="AAPL", help="Símbolo, ej. AAPL")
    ap.add_argument("--years", type=int, default=5, help="Años de historia")
    args = ap.parse_args()
    train(args.ticker, args.years)
