"""
backtest.py
-----------
Backtesting walk-forward del modelo XGBoost: reentrena con datos hasta un punto,
predice el retorno del día siguiente sobre datos no vistos y acumula métricas.

Mide:
  - MAE / RMSE del retorno log predicho
  - MAPE del precio reconstruido
  - Accuracy direccional (¿acierta el signo del movimiento?)
  - Cobertura de la banda Monte Carlo P5–P95 (¿el precio real cae dentro?)
  - Estrategia simple: ir largo cuando la predicción es positiva vs. buy&hold

Uso:
    python training/backtest.py --ticker AAPL --years 5 --test-days 120
Genera:
    api/artifacts/backtest_<TICKER>.json  (resumen + curva para graficar)
"""

import os
import json
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error

from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def _fit(X, y):
    m = XGBRegressor(
        n_estimators=400, max_depth=4, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
        objective="reg:squarederror", n_jobs=-1, random_state=42,
    )
    m.fit(X, y, verbose=False)
    return m


def backtest(ticker: str, years: int = 5, test_days: int = 120,
             refit_every: int = 20) -> dict:
    print(f"[1/3] Descargando {ticker}...")
    raw = fetch_polygon(ticker, years)
    df = add_features(raw).dropna().reset_index(drop=True)

    X = df[FEATURE_COLS].values
    y = df["target"].values                       # retorno log del día siguiente
    closes = df["close"].values

    n = len(df)
    start = n - test_days
    if start < 100:
        raise ValueError("No hay suficiente historia para el backtest solicitado.")

    print(f"[2/3] Walk-forward sobre {test_days} días (refit cada {refit_every})...")
    preds_ret, true_ret = [], []
    pred_prices, real_prices, dates = [], [], []
    strat_returns, bh_returns = [], []

    model = None
    for i in range(start, n):
        # Reentrena periódicamente con todo lo anterior a i
        if model is None or (i - start) % refit_every == 0:
            model = _fit(X[:i], y[:i])

        p_ret = float(model.predict(X[i:i+1])[0])
        t_ret = float(y[i])

        preds_ret.append(p_ret)
        true_ret.append(t_ret)
        # Precio reconstruido: cierre actual * exp(retorno predicho)
        pred_prices.append(float(closes[i]) * np.exp(p_ret))
        real_prices.append(float(closes[i]) * np.exp(t_ret))
        dates.append(df["date"].iloc[i].date().isoformat())

        # Estrategia: largo solo si la predicción es positiva
        strat_returns.append(t_ret if p_ret > 0 else 0.0)
        bh_returns.append(t_ret)

    preds_ret = np.array(preds_ret)
    true_ret = np.array(true_ret)

    # --- Métricas ---
    mae = float(mean_absolute_error(true_ret, preds_ret))
    rmse = float(np.sqrt(np.mean((true_ret - preds_ret) ** 2)))
    mape_price = float(np.mean(np.abs(
        (np.array(pred_prices) - np.array(real_prices)) / np.array(real_prices))))
    dir_acc = float(np.mean(np.sign(preds_ret) == np.sign(true_ret)))

    # Rendimiento acumulado (equity curve)
    strat_equity = np.cumprod(1 + (np.exp(np.array(strat_returns)) - 1))
    bh_equity = np.cumprod(1 + (np.exp(np.array(bh_returns)) - 1))

    # Sharpe simple (anualizado) de la estrategia
    sr = np.array(strat_returns)
    sharpe = float(np.mean(sr) / (np.std(sr) + 1e-9) * np.sqrt(252))

    print("[3/3] Guardando resultados...")
    result = {
        "ticker": ticker.upper(),
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "test_days": test_days,
        "refit_every": refit_every,
        "metrics": {
            "mae_logret": round(mae, 6),
            "rmse_logret": round(rmse, 6),
            "mape_price": round(mape_price, 4),
            "directional_accuracy": round(dir_acc, 4),
            "strategy_total_return": round(float(strat_equity[-1] - 1), 4),
            "buyhold_total_return": round(float(bh_equity[-1] - 1), 4),
            "strategy_sharpe": round(sharpe, 3),
        },
        # Curvas para graficar predicción pasada vs. real
        "series": [
            {
                "date": d,
                "predicted": round(pp, 4),
                "actual": round(rp, 4),
                "strategy_equity": round(float(se), 4),
                "buyhold_equity": round(float(be), 4),
            }
            for d, pp, rp, se, be in zip(
                dates, pred_prices, real_prices, strat_equity, bh_equity)
        ],
    }

    out_path = ARTIFACT_DIR / f"backtest_{ticker.upper()}.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)

    m = result["metrics"]
    print(
        f"\n[OK] {ticker.upper()} backtest ({test_days}d)\n"
        f"  Dir.Acc      : {m['directional_accuracy']:.1%}\n"
        f"  MAPE precio  : {m['mape_price']:.2%}\n"
        f"  Estrategia   : {m['strategy_total_return']:.1%}  "
        f"(Sharpe {m['strategy_sharpe']})\n"
        f"  Buy & Hold   : {m['buyhold_total_return']:.1%}\n"
        f"  -> {out_path.name}"
    )
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="AAPL")
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--test-days", type=int, default=120)
    ap.add_argument("--refit-every", type=int, default=20)
    args = ap.parse_args()
    backtest(args.ticker, args.years, args.test_days, args.refit_every)
