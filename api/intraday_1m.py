"""
intraday_1m.py — Predicción recursiva a 1 MINUTO
================================================
Proyecta los próximos `horizon` minutos (30 por defecto, 60 como tope) desde las
barras reales de la sesión en curso, con clamp anti-explosión.

NO proyecta hasta el cierre, a diferencia del modelo de 15 min: serían 390 pasos
encadenados de retorno acotado, que se aplanan en una recta sin información.

Las features se calculan de forma INCREMENTAL —sumas vectorizadas con numpy
sobre `work` en cada paso (O(n) por llamada), en vez de recalcular el
DataFrame entero con `add_1m_features` (que reconstruye columnas, agrupa por
día, etc.) para quedarse solo con la última fila. Sigue siendo O(n²) sobre el
horizonte igual que el bucle de 15 min, pero con una constante mucho menor:
es lo que cabe en el tiempo de respuesta a esta granularidad. El precio de
esa optimización es tener dos definiciones de las mismas features;
`tests/test_intraday_1m.py` afirma que coinciden con `add_1m_features`.
"""

from __future__ import annotations
import os
import sys
import json
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "training"))
from train_xgb_1m import (  # noqa: E402
    BARS_PER_SESSION, FEATURE_COLS, LOOKBACK_RETS, filter_regular_session,
)

from polygon_client import get_paginated  # noqa: E402

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_CACHE: dict = {}

DEFAULT_HORIZON = 30
MAX_HORIZON = 60

NOTE = ("Curva recursiva de 1 min a {horizon} minutos vista, acotada por clamp. "
        "Datos con ~15 min de retraso (plan Starter de Polygon). "
        "Señal intradía débil (Dir.Acc ~50%): contexto, no certeza.")


def clamp_horizon(horizon: int) -> int:
    """Entre 1 y MAX_HORIZON. Un horizonte abierto colgaría el endpoint."""
    return max(1, min(int(horizon), MAX_HORIZON))


def load_1m_model(ticker: str):
    t = ticker.upper()
    if t in _CACHE:
        return _CACHE[t]

    mp = ARTIFACT_DIR / f"xgb_1m_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_1m_{t}.json"
    if not mp.exists():
        raise FileNotFoundError(
            f"No hay modelo de 1 min para {t}. Corre: "
            f"python training/train_xgb_1m.py --ticker {t} --days 60")

    model = joblib.load(mp)
    meta = json.load(open(mm)) if mm.exists() else {}

    # El meta guarda el orden de features con el que se entrenó, precisamente
    # para que la inferencia no pueda usar otro sin que nada lo note (ver
    # spec). Si alguien reordena FEATURE_COLS sin reentrenar, la longitud
    # cuadraría igual y XGBoost no protestaría: serviría basura en silencio.
    meta_cols = meta.get("feature_cols")
    if meta_cols is not None and list(meta_cols) != list(FEATURE_COLS):
        raise FileNotFoundError(
            f"El modelo de 1 min de {t} se entrenó con otro orden de features "
            f"({mm.name}) y ya no coincide con FEATURE_COLS actual. Reentrena "
            f"antes de servir predicciones: "
            f"python training/train_xgb_1m.py --ticker {t} --days 60")

    _CACHE[t] = (model, meta)
    return model, meta


def incremental_features(work: pd.DataFrame, prev_close: float | None = None) -> list[float]:
    """
    Las 15 features de la ÚLTIMA fila de `work`, en el orden de FEATURE_COLS.

    Equivale a `add_1m_features(work)[FEATURE_COLS].iloc[-1].fillna(0.0)`, pero
    sin recorrer el DataFrame entero. La equivalencia está bajo test: si se
    rompe, el modelo recibe otras entradas y no falla, solo acierta menos.

    Se asume que `work` contiene UNA sola sesión, que es como lo llama el bucle.
    `prev_close` es el cierre de la sesión ANTERIOR (fuera de `work`), necesario
    para el feature `gap`; ver el comentario junto a su cálculo más abajo.
    """
    n = len(work)
    close = work["close"].to_numpy(dtype=float)
    high = work["high"].to_numpy(dtype=float)
    low = work["low"].to_numpy(dtype=float)
    volume = work["volume"].to_numpy(dtype=float)
    open_px = float(work["open"].iloc[0])

    i = n - 1
    m = min(i, BARS_PER_SESSION - 1)

    tod_sin = float(np.sin(2 * np.pi * m / BARS_PER_SESSION))
    tod_cos = float(np.cos(2 * np.pi * m / BARS_PER_SESSION))
    bars_left = float(max(BARS_PER_SESSION - 1 - m, 0) / BARS_PER_SESSION)

    ret_from_open = float(np.log(close[i] / open_px)) if open_px > 0 else 0.0

    tp = (high + low + close) / 3.0
    cum_pv = float(np.sum(tp * volume))
    cum_v = float(np.sum(volume))
    vwap = cum_pv / cum_v if cum_v > 0 else np.nan
    dist_vwap = float((close[i] - vwap) / vwap) if vwap and np.isfinite(vwap) else 0.0

    range_rel = float((high[i] - low[i]) / close[i]) if close[i] else 0.0
    vol_mean = cum_v / n if n else 0.0
    vol_rel = float(volume[i] / vol_mean) if vol_mean > 0 else 0.0

    # `work` solo trae la sesión de HOY, así que el cierre previo no está en
    # sus filas: hay que recibirlo aparte (lo trae `fetch_today_1m_bars`, que
    # sí descarga varios días). Sin él, gap=0.0 — igual que `add_1m_features`
    # con `fillna(0.0)` en el primer día de su ventana histórica.
    gap = 0.0
    if prev_close is not None and np.isfinite(prev_close) and prev_close > 0:
        gap = float(open_px / prev_close - 1.0)

    rets = np.full(n, np.nan)
    if n > 1:
        rets[1:] = np.log(close[1:] / close[:-1])

    lags = []
    for k in range(1, LOOKBACK_RETS + 1):
        j = i - k
        value = rets[j] if j >= 1 else np.nan
        lags.append(0.0 if not np.isfinite(value) else float(value))

    aggregates = []
    for window in (5, 15):
        j = i - window
        value = np.log(close[i] / close[j]) if j >= 0 and close[j] > 0 else np.nan
        aggregates.append(0.0 if not np.isfinite(value) else float(value))

    values = [tod_sin, tod_cos, bars_left, ret_from_open, dist_vwap,
              range_rel, vol_rel, gap, *lags, *aggregates]

    if len(values) != len(FEATURE_COLS):
        # Un `assert` desaparece bajo `python -O`; esto es la misma defensa
        # sin ese punto ciego.
        raise RuntimeError(
            f"features incrementales desalineadas: {len(values)} calculadas, "
            f"{len(FEATURE_COLS)} esperadas en FEATURE_COLS")
    return [0.0 if not np.isfinite(v) else float(v) for v in values]


def _predict_from_bars(model, meta: dict, today: pd.DataFrame, horizon: int,
                        prev_close: float | None = None) -> dict:
    """Núcleo recursivo, aislado de la red para poder probarlo."""
    if len(today) == 0:
        raise ValueError("No hay barras de la sesión de hoy: `today` está vacío.")

    horizon = clamp_horizon(horizon)

    # Recorta al horizonte que de verdad queda de sesión regular (BARS_PER_SESSION
    # barras, 9:30-16:00 ET). Sin esto, con el retraso del plan Starter (~15 min)
    # la curva sigue proyectando después de las 16:00 sobre un día ya cerrado —y
    # de forma permanente fuera de horario— como si fuera una proyección viva.
    bars_left_session = max(BARS_PER_SESSION - len(today), 0)
    horizon = min(horizon, bars_left_session)

    sigma = float(meta.get("sigma_1m", 0.0) or 0.0)
    if sigma <= 0 or not np.isfinite(sigma):
        r = np.log(today["close"] / today["close"].shift(1)).dropna()
        sigma = float(r.std()) if len(r) > 1 else 0.0005
    cap = float(meta.get("clamp_k", 3.0)) * sigma

    vol_typ = float(today["volume"].tail(20).mean()) if len(today) else 1e4

    work = today.copy().reset_index(drop=True)
    n_real = len(work)
    price = float(work["close"].iloc[-1])
    last_time = pd.Timestamp(work["dt_et"].iloc[-1])

    rows, clamped = [], 0

    for _ in range(horizon):
        x = np.asarray([incremental_features(work, prev_close)], dtype=float)
        raw = float(model.predict(x)[0])
        ret = float(np.clip(raw, -cap, cap))
        if ret != raw:
            clamped += 1

        price = price * float(np.exp(ret))
        last_time = last_time + pd.Timedelta(minutes=1)

        work = pd.concat([work, pd.DataFrame([{
            "dt_et": last_time, "open": price, "high": price,
            "low": price, "close": price, "volume": vol_typ,
        }])], ignore_index=True)

        rows.append({"time": last_time.isoformat(), "close": round(price, 4), "predicted": True})

    return {
        "session_date": pd.Timestamp(today["dt_et"].iloc[0]).date().isoformat(),
        "bars_real": n_real,
        "horizon_min": horizon,
        "last_real_close": round(float(today["close"].iloc[-1]), 4),
        "last_real_time": pd.Timestamp(today["dt_et"].iloc[-1]).isoformat(),
        "predicted": rows,
        "clamp": {"sigma_1m": round(sigma, 8), "cap_per_bar": round(cap, 8),
                  "bars_clamped": clamped},
        "model_meta": meta.get("metrics", {}),
    }


def fetch_today_1m_bars(ticker: str) -> tuple[pd.DataFrame, float | None]:
    """
    Barras de 1 min de la última sesión regular disponible, junto con el
    cierre de la sesión ANTERIOR (para el feature `gap`).

    Se descargan 5 días para tener margen frente a fines de semana y
    festivos; el cierre previo sale de esa misma descarga, antes de recortar
    al último día — tirarlo ahí sería perder el único dato que permite
    calcular `gap` en inferencia.
    """
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")

    end = dt.date.today()
    start = end - dt.timedelta(days=5)
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")

    # TTL corto: es lo más cerca del ahora que permite el plan Starter.
    res = get_paginated(url, ttl=60)["results"]
    if not res:
        raise ValueError(f"Polygon no devolvió barras de 1 min para {ticker}.")

    df = pd.DataFrame(res).rename(columns={"o": "open", "h": "high", "l": "low",
                                           "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_et"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert("America/New_York")
    df = filter_regular_session(df)

    last_day = df["dt_et"].dt.date.max()

    prev_close = None
    prev_mask = df["dt_et"].dt.date < last_day
    if prev_mask.any():
        prev_day = df.loc[prev_mask, "dt_et"].dt.date.max()
        prev_close = float(df.loc[df["dt_et"].dt.date == prev_day, "close"].iloc[-1])

    today = df[df["dt_et"].dt.date == last_day].reset_index(drop=True)
    return today, prev_close


def predict_next_minutes(ticker: str, horizon: int = DEFAULT_HORIZON) -> dict:
    model, meta = load_1m_model(ticker)
    today, prev_close = fetch_today_1m_bars(ticker)

    out = _predict_from_bars(model, meta, today, horizon, prev_close)
    out["ticker"] = ticker.upper()
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    out["note"] = NOTE.format(horizon=out["horizon_min"])
    return out
