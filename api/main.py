"""
main.py — API de ML para predicción, simulación, intradía, señales, técnico y MLP
=================================================================================
Endpoints:
    GET  /health · /models · /models-mlp
    GET  /backtest · /dashboard
    GET  /intraday · /signals · /signals-scan
    GET  /forecast-sentiment · /technical
    GET  /predict-mlp                              ← curva RED NEURONAL (MLP)
    GET  /forecast-history
    POST /predict · /simulate · /forecast · /backfill-actuals

Deploy: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
"""

from __future__ import annotations

import os
import json
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# El path a training/ debe ir ANTES de importar módulos que usan train_xgb.
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent / "training"))
from train_xgb import fetch_polygon, add_features, FEATURE_COLS  # noqa: E402

from simulate import monte_carlo_gbm            # noqa: E402
from intraday import analyze_intraday           # noqa: E402
from signals import combined_signals, scan_watchlist  # noqa: E402
from sentiment import forecast_with_sentiment   # noqa: E402
from technical import technical_analysis        # noqa: E402
from mlp import predict_curve_mlp               # noqa: E402  ← curva red neuronal
import supabase_client as sb                     # noqa: E402

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
app = FastAPI(title="Stock ML API", version="2.1.0")

ALLOWED = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

_MODEL_CACHE: dict[str, tuple] = {}
WATCHLIST = ["SNDK", "SMH", "AMAT", "TSM", "QQQ", "NVDA", "MU", "XLI", "AVGO",
             "SPCX", "KOID", "BOTZ", "IGV", "ASML", "META", "SKHY", "SOXX", "IDGT"]


# --------------------------------------------------------------------------- #
# Esquemas
# --------------------------------------------------------------------------- #
class PredictRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    horizon: int = Field(30, ge=1, le=252)


class SimulateRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    horizon: int = Field(30, ge=1, le=252)
    n_sims: int = Field(10000, ge=100, le=100000)


class ForecastRequest(SimulateRequest):
    save: bool = Field(True)


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def load_model(ticker: str):
    t = ticker.upper()
    if t in _MODEL_CACHE:
        return _MODEL_CACHE[t]
    model_path = ARTIFACT_DIR / f"xgb_{t}.joblib"
    meta_path = ARTIFACT_DIR / f"meta_{t}.json"
    if not model_path.exists() or not meta_path.exists():
        raise HTTPException(404, f"No hay modelo entrenado para {t}. "
                                 f"Ejecuta: python training/train_xgb.py --ticker {t}")
    model = joblib.load(model_path)
    with open(meta_path) as f:
        meta = json.load(f)
    _MODEL_CACHE[t] = (model, meta)
    return model, meta


def predict_curve(ticker: str, horizon: int) -> dict:
    """Predicción recursiva XGBoost: predice el retorno del día siguiente y lo compone."""
    model, meta = load_model(ticker)
    raw = fetch_polygon(ticker, years=1)
    df = add_features(raw).dropna().reset_index(drop=True)
    hist = raw[["date", "close"]].tail(120).copy()
    work = df.copy()
    last_close = float(raw["close"].iloc[-1])
    pred_dates, pred_prices = [], []
    cur_date = pd.to_datetime(raw["date"].iloc[-1])
    price = last_close
    for _ in range(horizon):
        x = work[FEATURE_COLS].iloc[[-1]].values
        log_ret = float(model.predict(x)[0])
        price = price * np.exp(log_ret)
        cur_date += pd.Timedelta(days=1)
        while cur_date.weekday() >= 5:
            cur_date += pd.Timedelta(days=1)
        pred_dates.append(cur_date.date().isoformat())
        pred_prices.append(round(price, 4))
        new_row = {"date": cur_date, "open": price, "high": price, "low": price,
                   "close": price, "volume": raw["volume"].tail(20).mean()}
        raw = pd.concat([raw, pd.DataFrame([new_row])], ignore_index=True)
        work = add_features(raw).reset_index(drop=True)
    return {
        "ticker": ticker.upper(), "last_close": last_close,
        "last_date": pd.to_datetime(hist["date"].iloc[-1]).date().isoformat(),
        "history": [{"date": pd.to_datetime(d).date().isoformat(), "close": round(float(c), 4)}
                    for d, c in zip(hist["date"], hist["close"])],
        "prediction": [{"date": d, "close": p} for d, p in zip(pred_dates, pred_prices)],
        "model_meta": meta["metrics"],
    }


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {"status": "ok", "time": dt.datetime.utcnow().isoformat() + "Z"}


@app.get("/models")
def list_models():
    return {"available": sorted(p.stem.replace("xgb_", "") for p in ARTIFACT_DIR.glob("xgb_*.joblib"))}


@app.get("/models-mlp")
def list_models_mlp():
    """Tickers que tienen modelo de red neuronal (MLP) entrenado."""
    return {"available": sorted(p.stem.replace("mlp_", "") for p in ARTIFACT_DIR.glob("mlp_*.joblib"))}


@app.get("/backtest")
def get_backtest(ticker: str):
    path = ARTIFACT_DIR / f"backtest_{ticker.upper()}.json"
    if not path.exists():
        raise HTTPException(404, f"No hay backtest para {ticker.upper()}.")
    with open(path) as f:
        return json.load(f)


@app.get("/dashboard")
def dashboard():
    rows = []
    for meta_path in sorted(ARTIFACT_DIR.glob("meta_*.json")):
        # Evita los meta_mlp_*.json en esta vista (son de la red neuronal)
        if meta_path.stem.startswith("meta_mlp_"):
            continue
        t = meta_path.stem.replace("meta_", "")
        with open(meta_path) as f:
            meta = json.load(f)
        row = {"ticker": t, "last_close": meta.get("last_close"), "last_date": meta.get("last_date"),
               "trained_at": meta.get("trained_at"),
               "train_dir_acc": meta.get("metrics", {}).get("directional_accuracy"),
               "sigma_daily": meta.get("sigma_daily")}
        bt_path = ARTIFACT_DIR / f"backtest_{t}.json"
        if bt_path.exists():
            with open(bt_path) as f:
                bt = json.load(f).get("metrics", {})
            row.update({"bt_dir_acc": bt.get("directional_accuracy"), "bt_mape": bt.get("mape_price"),
                        "bt_strategy": bt.get("strategy_total_return"),
                        "bt_buyhold": bt.get("buyhold_total_return"), "bt_sharpe": bt.get("strategy_sharpe")})
        rows.append(row)
    return {"count": len(rows), "rows": rows}


@app.get("/intraday")
def intraday(ticker: str, interval: int = 15, days: int = 1):
    try:
        return analyze_intraday(ticker, minutes=interval, days=days)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/signals")
def signals(ticker: str, interval: int = 15, days: int = 2):
    try:
        return combined_signals(ticker, interval=interval, days=days)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/signals-scan")
def signals_scan(tickers: str = "", interval: int = 15, days: int = 2):
    tl = [t.strip().upper() for t in tickers.split(",") if t.strip()] or WATCHLIST
    return scan_watchlist(tl, interval=interval, days=days)


@app.get("/forecast-sentiment")
def forecast_sentiment(ticker: str, horizon: int = 30):
    """Curva XGBoost ajustada por sentimiento de noticias (Polygon /reference/news)."""
    try:
        return forecast_with_sentiment(predict_curve, ticker, horizon)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/technical")
def technical(ticker: str, horizon: int = 20, zigzag: float = 0.03):
    """Análisis técnico mixto: histórico + predicción + ZigZag + Elliott + Fibonacci."""
    try:
        return technical_analysis(predict_curve, ticker, horizon, zigzag_pct=zigzag)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/predict-mlp")
def predict_mlp(ticker: str, horizon: int = 21):
    """Curva de predicción con la RED NEURONAL (MLP). Mismo formato que /predict."""
    try:
        return predict_curve_mlp(ticker, horizon)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/predict")
def predict(req: PredictRequest):
    return predict_curve(req.ticker, req.horizon)


@app.post("/simulate")
def simulate(req: SimulateRequest):
    _, meta = load_model(req.ticker)
    sim = monte_carlo_gbm(s0=meta["last_close"], mu_daily=meta["mu_daily"],
                          sigma_daily=meta["sigma_daily"], horizon=req.horizon, n_sims=req.n_sims)
    return {"ticker": req.ticker.upper(), **sim}


@app.post("/forecast")
def forecast(req: ForecastRequest):
    pred = predict_curve(req.ticker, req.horizon)
    _, meta = load_model(req.ticker)
    sim = monte_carlo_gbm(s0=meta["last_close"], mu_daily=meta["mu_daily"],
                          sigma_daily=meta["sigma_daily"], horizon=req.horizon, n_sims=req.n_sims)
    run_id = None
    if req.save and sb.enabled():
        try:
            run_id = sb.save_forecast(pred, sim, meta)
        except Exception as e:
            print(f"[WARN] No se pudo guardar en Supabase: {e}")
    return {"prediction": pred, "simulation": {"ticker": req.ticker.upper(), **sim},
            "run_id": run_id, "persisted": run_id is not None}


@app.get("/forecast-history")
def forecast_history(ticker: str, limit_runs: int = 5):
    if not sb.enabled():
        raise HTTPException(503, "Supabase no está configurado en el servidor.")
    return {"ticker": ticker.upper(), "runs": sb.get_forecast_history(ticker, limit_runs)}


@app.post("/backfill-actuals")
def backfill_actuals(ticker: str, days: int = 60):
    if not sb.enabled():
        raise HTTPException(503, "Supabase no está configurado en el servidor.")
    raw = fetch_polygon(ticker, years=max(1, days // 250 + 1))
    recent = raw.tail(days)
    date_close = {pd.to_datetime(d).date().isoformat(): round(float(c), 4)
                  for d, c in zip(recent["date"], recent["close"])}
    return {"ticker": ticker.upper(), "dates_updated": sb.update_actuals(ticker, date_close)}
