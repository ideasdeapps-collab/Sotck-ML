# XGBoost intradía de 1 minuto — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un modelo XGBoost propio para barras de 1 minuto que proyecta los próximos 30 minutos, expuesto como un overlay más del Trading Lab.

**Architecture:** Módulo de entrenamiento e inferencia separados del modelo de 15 minutos, que no se toca. El entrenamiento descarga 60 días de barras de 1 min de Polygon (con paginación nueva en el cliente) y guarda `xgb_1m_<T>.joblib`. La inferencia proyecta recursivamente `horizon` barras con features incrementales y clamp de ±K·σ. El frontend lo consume como una fuente más del registro de overlays, con el gating que ya existe.

**Tech Stack:** Python 3.11, XGBoost 2.1.1, pandas 2.2.2, FastAPI 0.115, pytest (nuevo). Next.js 14 App Router, TypeScript, lightweight-charts 5, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-xgboost-1m-overlay-design.md`

## Global Constraints

- **Nunca se modifica** `training/train_xgb_intraday.py` ni `api/intraday_ml.py`. El modelo de 15 minutos y su overlay `sessionCurve` deben seguir funcionando igual.
- Horizonte por defecto **30 barras**, tope duro **60**.
- Ventana de entrenamiento **60 días**, barras de **1 minuto**, solo sesión regular 09:30–16:00 ET (`BARS_PER_SESSION = 390`).
- Artefactos: `api/artifacts/xgb_1m_<TICKER>.joblib` y `api/artifacts/meta_1m_<TICKER>.json`. Se versionan en git, como el resto de `api/artifacts/`.
- Tickers iniciales: `NVDA QQQ SNDK`.
- Hiperparámetros idénticos a los del modelo de 15 min: `n_estimators=300, max_depth=4, learning_rate=0.03, subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0, objective="reg:squarederror", random_state=42`.
- `CLAMP_K = 3.0`.
- Toda petición a Polygon pasa por `api/polygon_client.py`, nunca por `requests` directo.
- El texto de usuario va en español; los comentarios de código, en el idioma del archivo que se toca.
- Los avisos del spec —exactitud direccional ~50 % y retraso de ~15 min del plan Starter— tienen que llegar a la interfaz, no quedarse en el JSON.

---

### Task 1: Paginación en el cliente de Polygon

Hoy `get_json` con `limit=50000` trunca la respuesta en silencio. 60 días de barras de un minuto la superan.

**Files:**
- Modify: `api/polygon_client.py`
- Modify: `api/requirements.txt`
- Create: `api/tests/test_polygon_client.py`

**Interfaces:**
- Consumes: nada.
- Produces: `get_paginated(url: str, ttl: int = TTL_INTRADAY, max_pages: int = 20) -> dict` — devuelve `{"results": [...], "pages": int, "truncated": bool}`.

- [ ] **Step 1: Añadir pytest a las dependencias**

En `api/requirements.txt`, al final:

```
pytest==8.3.3
```

- [ ] **Step 2: Escribir el test que falla**

Crear `api/tests/test_polygon_client.py`:

```python
"""Paginación del cliente de Polygon.

`get_json` con limit=50000 trunca en silencio: 60 días de barras de un minuto
la superan, y el modelo se entrenaría con un recorte que nadie ve.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import polygon_client


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    """Cada test parte de una caché vacía y sin esperas de rate-limit."""
    polygon_client._cache.clear()
    monkeypatch.setattr(polygon_client, "_throttle", lambda: None)


class _Response:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _fake_get(pages):
    """Sirve `pages` en orden y registra las URLs pedidas."""
    calls = []

    def get(url, timeout=30):
        calls.append(url)
        return _Response(pages[len(calls) - 1])

    return get, calls


def test_sigue_next_url_y_acumula_resultados(monkeypatch):
    pages = [
        {"results": [1, 2], "next_url": "https://api.polygon.io/next?cursor=a"},
        {"results": [3, 4], "next_url": "https://api.polygon.io/next?cursor=b"},
        {"results": [5]},
    ]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K")

    assert out["results"] == [1, 2, 3, 4, 5]
    assert out["pages"] == 3
    assert out["truncated"] is False
    assert len(calls) == 3


def test_anade_la_api_key_al_next_url(monkeypatch):
    pages = [
        {"results": [1], "next_url": "https://api.polygon.io/next?cursor=a"},
        {"results": [2]},
    ]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    polygon_client.get_paginated("https://api.polygon.io/first?apiKey=SECRETO")

    # Polygon no propaga la clave en next_url: hay que volver a ponerla.
    assert "apiKey=SECRETO" in calls[1]


def test_para_en_el_tope_y_lo_marca(monkeypatch):
    # Cursores distintos a propósito: `get_json` cachea por URL, así que
    # repetir el mismo next_url serviría la página anterior desde caché y la
    # cuenta de llamadas no reflejaría lo que hace el bucle.
    pages = [{"results": [i], "next_url": f"https://api.polygon.io/next?cursor={i}"}
             for i in range(10)]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K", max_pages=3)

    assert out["pages"] == 3
    assert out["truncated"] is True
    assert len(calls) == 3


def test_una_sola_pagina_sin_next_url(monkeypatch):
    get, _ = _fake_get([{"results": [1, 2, 3]}])
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K")

    assert out["results"] == [1, 2, 3]
    assert out["truncated"] is False


def test_respuesta_sin_results(monkeypatch):
    get, _ = _fake_get([{"status": "OK"}])
    monkeypatch.setattr(polygon_client.requests, "get", get)

    assert polygon_client.get_paginated("https://api.polygon.io/f?apiKey=K")["results"] == []
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

```bash
cd api && python -m pytest tests/test_polygon_client.py -v
```

Esperado: FAIL con `AttributeError: module 'polygon_client' has no attribute 'get_paginated'`.

- [ ] **Step 4: Implementar `get_paginated`**

En `api/polygon_client.py`, después de `get_json`:

```python
def get_paginated(url: str, ttl: int = TTL_INTRADAY, max_pages: int = 20) -> dict:
    """
    GET siguiendo el `next_url` de Polygon hasta agotar los resultados.

    `get_json` sirve para una respuesta que cabe en una llamada. 60 días de
    barras de un minuto no caben: con `limit=50000` Polygon devuelve la primera
    página y un cursor, y quedarse solo con esa página es entrenar sobre un
    recorte arbitrario sin que nada lo indique.

    El tope de páginas evita que un cursor en bucle cuelgue un entrenamiento;
    si se alcanza, `truncated` lo dice en vez de callarlo.
    """
    api_key = os.getenv("POLYGON_API_KEY", "")
    results: list = []
    next_url = url
    pages = 0

    while next_url and pages < max_pages:
        data = get_json(next_url, ttl=ttl)
        results.extend(data.get("results") or [])
        pages += 1

        next_url = data.get("next_url")
        if next_url and "apiKey=" not in next_url:
            # Polygon no propaga la clave en el cursor.
            sep = "&" if "?" in next_url else "?"
            next_url = f"{next_url}{sep}apiKey={api_key}"

    truncated = bool(next_url) and pages >= max_pages
    if truncated:
        print(f"[polygon] AVISO: se alcanzó el tope de {max_pages} páginas; faltan datos.")

    return {"results": results, "pages": pages, "truncated": truncated}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```bash
cd api && python -m pytest tests/test_polygon_client.py -v
```

Esperado: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add api/polygon_client.py api/requirements.txt api/tests/test_polygon_client.py
git commit -m "fix(polygon): seguir next_url en vez de truncar la respuesta en silencio"
```

---

### Task 2: Entrenamiento del modelo de 1 minuto

**Files:**
- Create: `training/train_xgb_1m.py`
- Create: `api/tests/test_train_xgb_1m.py`

**Interfaces:**
- Consumes: `polygon_client.get_paginated` (Task 1).
- Produces:
  - `BARS_PER_SESSION = 390`, `CLAMP_K = 3.0`, `LOOKBACK_RETS = 5`
  - `FEATURE_COLS: list[str]` — 15 nombres, en orden
  - `add_1m_features(df: pd.DataFrame) -> pd.DataFrame`
  - `filter_regular_session(df: pd.DataFrame) -> pd.DataFrame`
  - `fetch_1m_polygon(ticker: str, days: int = 60) -> pd.DataFrame`
  - `train_from_df(df, ticker) -> tuple[model, dict]`
  - `train(ticker: str, days: int = 60) -> dict`

- [ ] **Step 1: Escribir el test que falla**

Crear `api/tests/test_train_xgb_1m.py`:

```python
"""Features del modelo de 1 minuto.

No se prueba el entrenamiento (necesita red y xgboost), sino la ingeniería de
features, que es donde una fuga de datos o un reinicio de día mal hecho pasan
inadvertidos.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "training"))

from train_xgb_1m import BARS_PER_SESSION, FEATURE_COLS, add_1m_features, filter_regular_session


def _session(date: str, n: int = 60, start_price: float = 100.0) -> pd.DataFrame:
    """n barras de un minuto desde las 09:30 ET del día dado."""
    idx = pd.date_range(f"{date} 09:30", periods=n, freq="1min", tz="America/New_York")
    price = start_price + np.arange(n) * 0.01
    return pd.DataFrame({
        "dt_et": idx,
        "open": price,
        "high": price + 0.02,
        "low": price - 0.02,
        "close": price,
        "volume": np.full(n, 1000.0),
    })


def test_hay_390_barras_por_sesion():
    assert BARS_PER_SESSION == 390


def test_las_features_son_quince_y_en_este_orden():
    # El orden es contrato: la inferencia arma el vector por posición.
    assert FEATURE_COLS == [
        "tod_sin", "tod_cos", "bars_left",
        "ret_from_open", "dist_vwap", "range_rel", "vol_rel", "gap",
        "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_4", "ret_lag_5",
        "ret_5m", "ret_15m",
    ]


def test_el_retorno_no_cruza_el_cambio_de_dia():
    df = pd.concat([_session("2026-08-27", 30), _session("2026-08-28", 30, 200.0)], ignore_index=True)
    out = add_1m_features(df)

    primera_del_segundo_dia = out[out["day"] == pd.Timestamp("2026-08-28").date()].iloc[0]
    assert np.isnan(primera_del_segundo_dia["ret"])


def test_el_target_es_el_retorno_de_la_barra_siguiente():
    out = add_1m_features(_session("2026-08-28", 10))
    esperado = out["ret"].shift(-1).iloc[3]
    assert out["target"].iloc[3] == pytest.approx(esperado, nan_ok=True)


def test_la_ultima_barra_del_dia_no_tiene_target():
    out = add_1m_features(_session("2026-08-28", 10))
    assert np.isnan(out["target"].iloc[-1])


def test_bars_left_baja_de_uno_a_cero():
    out = add_1m_features(_session("2026-08-28", 5))
    assert out["bars_left"].iloc[0] > out["bars_left"].iloc[-1]
    assert out["bars_left"].min() >= 0


def test_ret_from_open_es_cero_en_la_apertura():
    out = add_1m_features(_session("2026-08-28", 10))
    assert out["ret_from_open"].iloc[0] == pytest.approx(0.0, abs=1e-9)


def test_ret_15m_mira_quince_barras_atras():
    out = add_1m_features(_session("2026-08-28", 40))
    fila = out.iloc[20]
    esperado = np.log(out["close"].iloc[20] / out["close"].iloc[5])
    assert fila["ret_15m"] == pytest.approx(esperado)


def test_filter_regular_session_descarta_premarket_y_afterhours():
    idx = pd.date_range("2026-08-28 04:00", periods=24 * 60, freq="1min", tz="America/New_York")
    df = pd.DataFrame({"dt_et": idx, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0})

    out = filter_regular_session(df)
    mins = out["dt_et"].dt.hour * 60 + out["dt_et"].dt.minute

    assert mins.min() == 9 * 60 + 30
    assert mins.max() == 15 * 60 + 59
    assert len(out) == BARS_PER_SESSION
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
cd api && python -m pytest tests/test_train_xgb_1m.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'train_xgb_1m'`.

- [ ] **Step 3: Escribir `training/train_xgb_1m.py`**

```python
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
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
cd api && python -m pytest tests/test_train_xgb_1m.py -v
```

Esperado: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add training/train_xgb_1m.py api/tests/test_train_xgb_1m.py
git commit -m "feat(ml): modelo XGBoost intradía de 1 minuto"
```

---

### Task 3: Inferencia con features incrementales

El bucle del modelo de 15 min recalcula todas las features sobre el DataFrame entero en cada paso. Aquí se mantienen acumuladores, y un test afirma que ambas definiciones coinciden — es lo único que impide que se separen sin avisar.

**Files:**
- Create: `api/intraday_1m.py`
- Create: `api/tests/test_intraday_1m.py`

**Interfaces:**
- Consumes: `train_xgb_1m.{add_1m_features, FEATURE_COLS, filter_regular_session, BARS_PER_SESSION}`; `polygon_client.get_paginated`.
- Produces:
  - `DEFAULT_HORIZON = 30`, `MAX_HORIZON = 60`
  - `incremental_features(work: pd.DataFrame) -> list[float]` — las 15 features de la ÚLTIMA fila, en el orden de `FEATURE_COLS`
  - `_predict_from_bars(model, meta: dict, today: pd.DataFrame, horizon: int) -> dict`
  - `predict_next_minutes(ticker: str, horizon: int = 30) -> dict`

- [ ] **Step 1: Escribir el test que falla**

Crear `api/tests/test_intraday_1m.py`:

```python
"""Inferencia de 1 minuto.

El test que importa es el de equivalencia: `incremental_features` y
`add_1m_features` tienen que dar exactamente lo mismo. Si divergen, el modelo
recibe entradas distintas de las que vio al entrenar y sirve basura sin fallar.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import intraday_1m
from train_xgb_1m import FEATURE_COLS, add_1m_features


def _session(date: str = "2026-08-28", n: int = 80) -> pd.DataFrame:
    """Barras con algo de forma: precio y volumen constantes no distinguen nada."""
    idx = pd.date_range(f"{date} 09:30", periods=n, freq="1min", tz="America/New_York")
    rng = np.random.default_rng(7)
    close = 100 + np.cumsum(rng.normal(0, 0.03, n))
    return pd.DataFrame({
        "dt_et": idx,
        "open": close - 0.01,
        "high": close + 0.04,
        "low": close - 0.04,
        "close": close,
        "volume": rng.integers(800, 1500, n).astype(float),
    })


def test_las_features_incrementales_coinciden_con_las_del_entrenamiento():
    df = _session(n=80)
    esperado = add_1m_features(df)[FEATURE_COLS].iloc[-1].fillna(0.0).values
    obtenido = np.asarray(intraday_1m.incremental_features(df), dtype=float)

    assert obtenido == pytest.approx(esperado, rel=1e-9, abs=1e-12)


@pytest.mark.parametrize("n", [20, 45, 80, 200])
def test_coinciden_en_cualquier_punto_de_la_sesion(n):
    df = _session(n=n)
    esperado = add_1m_features(df)[FEATURE_COLS].iloc[-1].fillna(0.0).values
    obtenido = np.asarray(intraday_1m.incremental_features(df), dtype=float)

    assert obtenido == pytest.approx(esperado, rel=1e-9, abs=1e-12)


class _Modelo:
    """Devuelve siempre el mismo retorno, para aislar el clamp del modelo."""

    def __init__(self, ret):
        self.ret = ret

    def predict(self, x):
        return np.array([self.ret])


def test_el_horizonte_produce_esa_cantidad_de_barras():
    out = intraday_1m._predict_from_bars(_Modelo(0.0001), {"sigma_1m": 0.001}, _session(n=60), 30)

    assert len(out["predicted"]) == 30
    assert out["bars_real"] == 60
    assert out["horizon_min"] == 30


def test_el_clamp_acota_un_retorno_disparado_y_lo_cuenta():
    meta = {"sigma_1m": 0.001, "clamp_k": 3.0}
    out = intraday_1m._predict_from_bars(_Modelo(0.5), meta, _session(n=60), 10)

    assert out["clamp"]["cap_per_bar"] == pytest.approx(0.003)
    assert out["clamp"]["bars_clamped"] == 10

    # Diez barras al tope: el precio sube exactamente exp(10 * 0.003).
    esperado = out["last_real_close"] * np.exp(10 * 0.003)
    assert out["predicted"][-1]["close"] == pytest.approx(esperado, rel=1e-6)


def test_las_barras_predichas_van_de_minuto_en_minuto():
    out = intraday_1m._predict_from_bars(_Modelo(0.0), {"sigma_1m": 0.001}, _session(n=60), 5)
    tiempos = [pd.Timestamp(p["time"]) for p in out["predicted"]]

    assert all((b - a) == pd.Timedelta(minutes=1) for a, b in zip(tiempos, tiempos[1:]))


def test_sin_sigma_en_meta_se_estima_de_las_barras():
    out = intraday_1m._predict_from_bars(_Modelo(0.0001), {}, _session(n=60), 5)
    assert out["clamp"]["cap_per_bar"] > 0


def test_el_horizonte_se_limita_al_maximo():
    assert intraday_1m.clamp_horizon(500) == intraday_1m.MAX_HORIZON
    assert intraday_1m.clamp_horizon(0) == 1
    assert intraday_1m.clamp_horizon(30) == 30
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
cd api && python -m pytest tests/test_intraday_1m.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'intraday_1m'`.

- [ ] **Step 3: Escribir `api/intraday_1m.py`**

```python
"""
intraday_1m.py — Predicción recursiva a 1 MINUTO
================================================
Proyecta los próximos `horizon` minutos (30 por defecto, 60 como tope) desde las
barras reales de la sesión en curso, con clamp anti-explosión.

NO proyecta hasta el cierre, a diferencia del modelo de 15 min: serían 390 pasos
encadenados de retorno acotado, que se aplanan en una recta sin información.

Las features se calculan de forma INCREMENTAL —acumuladores en vez de recalcular
el DataFrame entero por paso—, porque el bucle del modelo de 15 min es cuadrático
y a esta granularidad no cabe en el tiempo de respuesta. El precio de esa
optimización es tener dos definiciones de las mismas features;
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
    _CACHE[t] = (model, meta)
    return model, meta


def incremental_features(work: pd.DataFrame) -> list[float]:
    """
    Las 15 features de la ÚLTIMA fila de `work`, en el orden de FEATURE_COLS.

    Equivale a `add_1m_features(work)[FEATURE_COLS].iloc[-1].fillna(0.0)`, pero
    sin recorrer el DataFrame entero. La equivalencia está bajo test: si se
    rompe, el modelo recibe otras entradas y no falla, solo acierta menos.

    Se asume que `work` contiene UNA sola sesión, que es como lo llama el bucle.
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

    # Una sola sesión en memoria: no hay cierre previo, así que el gap es 0,
    # igual que `add_1m_features` con `fillna(0.0)` sobre el primer día.
    gap = 0.0

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

    assert len(values) == len(FEATURE_COLS), "features incrementales desalineadas"
    return [0.0 if not np.isfinite(v) else float(v) for v in values]


def _predict_from_bars(model, meta: dict, today: pd.DataFrame, horizon: int) -> dict:
    """Núcleo recursivo, aislado de la red para poder probarlo."""
    horizon = clamp_horizon(horizon)

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
        x = np.asarray([incremental_features(work)], dtype=float)
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


def fetch_today_1m_bars(ticker: str) -> pd.DataFrame:
    """Barras de 1 min de la última sesión regular disponible."""
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
    return df[df["dt_et"].dt.date == last_day].reset_index(drop=True)


def predict_next_minutes(ticker: str, horizon: int = DEFAULT_HORIZON) -> dict:
    model, meta = load_1m_model(ticker)
    today = fetch_today_1m_bars(ticker)

    out = _predict_from_bars(model, meta, today, horizon)
    out["ticker"] = ticker.upper()
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    out["note"] = NOTE.format(horizon=out["horizon_min"])
    return out
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
cd api && python -m pytest tests/test_intraday_1m.py -v
```

Esperado: 11 passed. **Si falla la equivalencia**, el problema está en `incremental_features`, no en el test: compara feature a feature imprimiendo ambos vectores antes de tocar nada.

- [ ] **Step 5: Commit**

```bash
git add api/intraday_1m.py api/tests/test_intraday_1m.py
git commit -m "feat(ml): inferencia de 1 minuto con features incrementales"
```

---

### Task 4: Endpoints de FastAPI

**Files:**
- Modify: `api/main.py` — importaciones (junto a la línea 35), `/models-1m` (tras `list_models_intraday`, ~línea 231), `/predict-1m` (tras `predict_intraday`, ~línea 342)

**Interfaces:**
- Consumes: `intraday_1m.{predict_next_minutes, DEFAULT_HORIZON}` (Task 3).
- Produces: `GET /models-1m`, `GET /predict-1m?ticker&horizon`.

- [ ] **Step 1: Añadir la importación**

En `api/main.py`, después de la línea que importa `intraday_ml`:

```python
from intraday_1m import predict_next_minutes, DEFAULT_HORIZON  # noqa: E402  ← modelo de 1 min
```

- [ ] **Step 2: Añadir `/models-1m`**

Justo después de `list_models_intraday`:

```python
@app.get("/models-1m")
def list_models_1m():
    """Tickers que tienen modelo de 1 MINUTO entrenado."""
    return {"available": sorted(p.stem.replace("xgb_1m_", "")
                                for p in ARTIFACT_DIR.glob("xgb_1m_*.joblib"))}
```

- [ ] **Step 3: Añadir `/predict-1m`**

Justo después de `predict_intraday`:

```python
@app.get("/predict-1m")
def predict_1m(ticker: str, horizon: int = DEFAULT_HORIZON):
    """Curva recursiva de 1 min de los próximos `horizon` minutos (tope 60)."""
    try:
        return predict_next_minutes(ticker, horizon)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))
```

- [ ] **Step 4: Comprobar que la API arranca y responde**

```bash
cd api && python -c "import main; print([r.path for r in main.app.routes if '1m' in r.path])"
```

Esperado: `['/models-1m', '/predict-1m']`.

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(api): endpoints /predict-1m y /models-1m"
```

---

### Task 5: Proxy y cliente tipado del frontend

**Files:**
- Modify: `app/api/ml/[...path]/route.ts` — objeto `ENDPOINTS`
- Modify: `types/trading.ts` — `TickerCapabilities` y tipo nuevo
- Modify: `lib/trading/mlApi.ts`
- Modify: `lib/trading/capabilities.ts`

**Interfaces:**
- Consumes: los endpoints de la Task 4.
- Produces:
  - `OneMinutePrediction` (tipo)
  - `TickerCapabilities.oneMinute: boolean`
  - `fetchOneMinuteCurve(ticker: string, horizon?: number)`
  - `CapabilityMap.oneMinute: Set<string>`

- [ ] **Step 1: Abrir los endpoints en el proxy**

En `app/api/ml/[...path]/route.ts`, dentro de `ENDPOINTS`:

```ts
  'models-1m': 300,
```

junto a los otros `models-*`, y:

```ts
  // Casi en vivo: una TTL larga taparía el refresco del minuto.
  'predict-1m': 30,
```

junto a `'predict-intraday'`.

- [ ] **Step 2: Añadir los tipos**

En `types/trading.ts`, junto a `SessionPrediction`:

```ts
/** GET /predict-1m — los próximos minutos proyectados barra a barra. */
export type OneMinutePrediction = {
  ticker: string;
  session_date: string;
  bars_real: number;
  horizon_min: number;
  last_real_close: number;
  /** ISO con desfase ET. Con el plan Starter va ~15 min por detrás del ahora. */
  last_real_time: string;
  predicted: { time: string; close: number; predicted: boolean }[];
  clamp: { sigma_1m: number; cap_per_bar: number; bars_clamped: number };
  model_meta: { mae?: number; r2?: number; directional_accuracy?: number };
  generated_at: string;
  note: string;
};
```

Y en `TickerCapabilities`:

```ts
export type TickerCapabilities = {
  xgb: boolean;
  mlp: boolean;
  intraday: boolean;
  extended: boolean;
  oneMinute: boolean;
};
```

- [ ] **Step 3: Añadir el fetch tipado**

En `lib/trading/mlApi.ts`, junto a `fetchSessionCurve`:

```ts
export const fetchOneMinuteCurve = (ticker: string, horizon = 30) =>
  get<OneMinutePrediction>('predict-1m', { ticker, horizon });
```

Añadir `OneMinutePrediction` a la lista de tipos importados, y ampliar la firma de capacidades:

```ts
export const fetchTrainedTickers = (
  endpoint: 'models' | 'models-mlp' | 'models-intraday' | 'models-extended' | 'models-1m'
) => get<{ available?: string[] }>(endpoint);
```

- [ ] **Step 4: Ampliar el mapa de capacidades**

En `lib/trading/capabilities.ts`, cinco cambios. En `CapabilityMap`:

```ts
  extended: Set<string>;
  oneMinute: Set<string>;
```

En `EMPTY`:

```ts
  extended: new Set(),
  oneMinute: new Set(),
```

En el `Promise.all` de `loadCapabilities`:

```ts
    const [xgb, mlp, intraday, extended, oneMinute] = await Promise.all([
      fetchTrainedTickers('models'),
      fetchTrainedTickers('models-mlp'),
      fetchTrainedTickers('models-intraday'),
      fetchTrainedTickers('models-extended'),
      fetchTrainedTickers('models-1m'),
    ]);
```

En el objeto que se cachea:

```ts
      extended: toSet(extended),
      oneMinute: toSet(oneMinute),
```

Y en `capabilitiesFor`:

```ts
    extended: map.extended.has(symbol),
    oneMinute: map.oneMinute.has(symbol),
```

- [ ] **Step 5: Comprobar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores. Si `registry.ts` se queja de `oneMinute`, es de la Task 6 — se resuelve ahí.

- [ ] **Step 6: Commit**

```bash
git add app/api/ml types/trading.ts lib/trading/mlApi.ts lib/trading/capabilities.ts
git commit -m "feat(trading-lab): expone /predict-1m al frontend"
```

---

### Task 6: El overlay

**Files:**
- Modify: `lib/trading/overlays/registry.ts`
- Modify: `lib/trading/overlays/remoteData.ts`
- Modify: `lib/trading/overlays/paint.ts`

**Interfaces:**
- Consumes: `fetchOneMinuteCurve`, `OneMinutePrediction`, `TickerCapabilities.oneMinute` (Task 5).
- Produces: `OverlayId` gana `'intraday1m'`; `OverlaySource` gana `'oneMinute'`; `RemoteOverlayData.oneMinute?: MlResult<OneMinutePrediction>`.

- [ ] **Step 1: Registrar la fuente y el overlay**

En `lib/trading/overlays/registry.ts`: añadir `| 'oneMinute'` a `OverlaySource`, `| 'intraday1m'` a `OverlayId`, esta entrada al final del grupo «Curvas predictivas» de `OVERLAYS`:

```ts
  { id: 'intraday1m', label: 'Curva ML 1m (+30 min)', group: 'Curvas predictivas', source: 'oneMinute', timeframes: ['1m'], capability: 'oneMinute', hint: 'Proyección recursiva de los próximos 30 minutos con el modelo de 1 min. Datos con ~15 min de retraso; señal débil, contexto y no certeza' },
```

y `intraday1m: false,` a `DEFAULT_OVERLAYS`.

- [ ] **Step 2: Añadir la fuente remota**

En `lib/trading/overlays/remoteData.ts`: importar `fetchOneMinuteCurve` y el tipo `OneMinutePrediction`, añadir `oneMinute?: MlResult<OneMinutePrediction>;` a `RemoteOverlayData`, y este caso a `loadRemoteOverlays`:

```ts
      case 'oneMinute':
        return ['oneMinute', await fetchOneMinuteCurve(ticker)];
```

- [ ] **Step 3: Pintar la curva**

En `lib/trading/overlays/paint.ts`, añadir a `LAYER_IDS`:

```ts
  intraday1m: ['curve-1m'],
```

a `COLORS` — turquesa, que no lo usa ningún otro overlay:

```ts
  curve1m: '#2dd4bf',
```

y este bloque justo después del de `sessionCurve`:

```ts
  // --- Curva ML de 1 minuto -------------------------------------------------
  // Misma forma que la curva de sesión: arranca en la última vela real para que
  // se lea como continuación y no como una serie suelta.
  const oneMinute = remote.oneMinute?.ok ? remote.oneMinute.data : null;

  if (on('intraday1m') && oneMinute) {
    const points: LinePoint[] = [];

    try {
      points.push({ time: toChartTime(oneMinute.last_real_time), value: oneMinute.last_real_close });
    } catch {
      // Sin punto de arranque la curva flota; mejor dibujarla sin él que no dibujarla.
    }

    for (const point of oneMinute.predicted) {
      try {
        points.push({ time: toChartTime(point.time), value: point.close });
      } catch {
        // Una marca de tiempo ilegible no puede tumbar el resto de la curva.
      }
    }

    layer.line('curve-1m', dedupe(points), {
      color: COLORS.curve1m,
      lineWidth: 2,
      dashed: true,
      title: `ML 1m +${oneMinute.horizon_min}m`,
    });
  } else clear('intraday1m');
```

- [ ] **Step 4: Comprobar tipos y build**

```bash
npx tsc --noEmit && npm run build
```

Esperado: sin errores; `/trading` en la salida del build.

- [ ] **Step 5: Commit**

```bash
git add lib/trading/overlays
git commit -m "feat(trading-lab): overlay de la curva ML de 1 minuto"
```

---

### Task 7: La leyenda con los avisos

Los dos avisos del spec —exactitud ~50 % y retraso de ~15 min— tienen que verse en el gráfico, no solo en el JSON.

**Files:**
- Modify: `components/trading/ChartPanel.tsx`
- Modify: `app/trading/trading.css`

**Interfaces:**
- Consumes: `remote.oneMinute` del estado que `ChartPanel` ya mantiene, y `overlays.intraday1m`.
- Produces: nada para otras tareas.

- [ ] **Step 1: Construir el texto de la leyenda**

En `components/trading/ChartPanel.tsx`, justo después del bloque `elliottLegend`:

```tsx
  /**
   * Avisos de la curva de 1 minuto.
   *
   * El retraso del plan Starter y una exactitud direccional en torno al 50 %
   * cambian por completo cómo hay que leer esa línea, así que van donde se lee
   * — no enterrados en el JSON de la respuesta.
   */
  const oneMinuteLegend = (() => {
    const result = remote.oneMinute;
    if (!overlays.intraday1m || !allowed('intraday1m') || !result?.ok) return '';

    const data = result.data;
    const hora = new Date(data.last_real_time).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const acierto = data.model_meta?.directional_accuracy;

    return (
      `Curva ML 1m · última barra real ${hora} · +${data.horizon_min} min` +
      (acierto ? ` · acierto direccional ${(acierto * 100).toFixed(0)}%` : '') +
      ' — datos con ~15 min de retraso (plan Starter); contexto, no señal de entrada'
    );
  })();
```

- [ ] **Step 2: Renderizarlo**

Justo debajo de la línea que renderiza `elliottLegend`:

```tsx
      {oneMinuteLegend && <p className="chart-panel__onemin">{oneMinuteLegend}</p>}
```

- [ ] **Step 3: Darle estilo**

Al final de `app/trading/trading.css`, antes del bloque `@media (max-width: 640px)`:

```css
.chart-panel__onemin {
  font-size: 11px !important;
  color: #2dd4bf !important;
  margin: 4px 0 8px !important;
}
```

- [ ] **Step 4: Comprobar tipos y build**

```bash
npx tsc --noEmit && npm run build
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/trading/ChartPanel.tsx app/trading/trading.css
git commit -m "feat(trading-lab): leyenda con el retraso y el acierto del modelo de 1m"
```

---

### Task 8: Reentreno automático y documentación

**Files:**
- Modify: `.github/workflows/retrain.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `training/train_xgb_1m.py` (Task 2).
- Produces: nada para otras tareas.

- [ ] **Step 1: Declarar las variables del workflow**

En `.github/workflows/retrain.yml`, junto a `INTRADAY_TICKERS`:

```yaml
  ONE_MIN_TICKERS: "NVDA QQQ SNDK"
  ONE_MIN_DAYS: 60
```

- [ ] **Step 2: Añadir el paso de entrenamiento**

Después del paso «Train intraday (15 min)»:

```yaml
      # ------------------------------------------------------------------- #
      # ML DE 1 MINUTO — pocos tickers: son ~23 000 barras por cada uno.
      # Aislado del resto: si falla, no afecta a los modelos anteriores.
      # ------------------------------------------------------------------- #
      - name: Train 1-minute — tickers líquidos
        if: ${{ env.ONE_MIN_TICKERS != '' }}
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
        run: |
          echo "Entrenando modelos de 1 min (${ONE_MIN_DAYS} días): $ONE_MIN_TICKERS"
          for T in $ONE_MIN_TICKERS; do
            echo "::group::1m $T"
            python training/train_xgb_1m.py --ticker "$T" --days "$ONE_MIN_DAYS" \
              || echo "::warning::train_xgb_1m falló para $T"
            echo "::endgroup::"
            sleep 5
          done
```

- [ ] **Step 3: Documentarlo**

En `README.md`, en la tabla de endpoints, junto a los intradía:

```markdown
| GET | `/predict-1m` | `?ticker=NVDA&horizon=30` | **curva recursiva de 1 min** de los próximos minutos |
| GET | `/models-1m` | — | tickers con modelo de 1 min entrenado |
```

Y una sección nueva antes de «⚠️ Aviso»:

```markdown
## ⏱️ Modelo de 1 minuto

Overlay **«Curva ML 1m (+30 min)»** del Trading Lab, solo en temporalidad 1m y solo para tickers
con modelo entrenado (`NVDA`, `QQQ`, `SNDK` por defecto).

Proyecta 30 minutos, no hasta el cierre: 390 pasos recursivos de retorno acotado se aplanan en una
recta sin información, y el bucle no cabría en el tiempo de respuesta del proxy.

**Dos cosas que el overlay dice en pantalla y conviene repetir aquí:** el plan Starter de Polygon
sirve datos con ~15 minutos de retraso, así que la curva arranca en un punto que ya es pasado; y a
un minuto la exactitud direccional ronda el 50 %. Es contexto de mercado, no una señal de entrada.

Entrenar otros tickers:
```bash
python training/train_xgb_1m.py --ticker AMD --days 60
```
O de forma permanente, añadiéndolos a `ONE_MIN_TICKERS` en `.github/workflows/retrain.yml`. El
overlay aparece solo para cualquier ticker que tenga artefacto: `/models-1m` lista el directorio.
```

- [ ] **Step 4: Validar el YAML**

```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/retrain.yml')); print('YAML OK')"
```

Esperado: `YAML OK`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/retrain.yml README.md
git commit -m "chore(ml): reentreno del modelo de 1 minuto y documentación"
```

---

### Task 9: Verificación de extremo a extremo

Nada de esto se puede dar por bueno sin datos reales: hasta aquí los tests son unitarios y el modelo no existe.

**Files:** ninguno — es una tarea de comprobación. Los artefactos generados se commitean.

- [ ] **Step 1: Entrenar NVDA**

```bash
export POLYGON_API_KEY=...
python training/train_xgb_1m.py --ticker NVDA --days 60
```

Esperado: `[OK] NVDA 1m | Dir.Acc=~50% | ...` y los dos artefactos en `api/artifacts/`.

**Si `Dir.Acc` supera el 55 %, párate.** A un minuto eso no es un buen modelo, es una fuga: lo más probable es que una feature contenga información de la barra que se intenta predecir. Revisa `add_1m_features` antes de seguir.

- [ ] **Step 2: Entrenar los otros dos**

```bash
python training/train_xgb_1m.py --ticker QQQ --days 60
python training/train_xgb_1m.py --ticker SNDK --days 60
```

- [ ] **Step 3: Probar la API**

```bash
cd api && uvicorn main:app --port 8000 &
sleep 5
curl -s 'localhost:8000/models-1m'
curl -s 'localhost:8000/predict-1m?ticker=NVDA' | python -c "import json,sys; d=json.load(sys.stdin); print(d['bars_real'], d['horizon_min'], len(d['predicted']), d['note'])"
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8000/predict-1m?ticker=AAPL'
```

Esperado: los tres tickers listados; 30 puntos predichos y la nota con los dos avisos; **404** para AAPL, no 500.

- [ ] **Step 4: Medir el tiempo de respuesta**

```bash
curl -s -o /dev/null -w 'tiempo: %{time_total}s\n' 'localhost:8000/predict-1m?ticker=NVDA'
```

Esperado: holgadamente por debajo de 45 s, que es donde corta el proxy. Si no lo está, el enfoque incremental no está haciendo su trabajo.

- [ ] **Step 5: Probarlo en el Lab**

```bash
npm run dev
```

Con `ML_API_URL=http://localhost:8000` en `.env.local`, abrir `http://localhost:3000/trading`, NVDA en 1m, y encender «Curva ML 1m (+30 min)». Comprobar:

- La curva discontinua arranca en la última vela y se prolonga 30 minutos.
- La leyenda muestra hora, horizonte, acierto direccional y el aviso del retraso.
- En 5m el toggle sale deshabilitado con *«Solo en 1m»*.
- Con AAPL en 1m sale deshabilitado con *«Sin modelo entrenado para este ticker»*.

- [ ] **Step 6: Suite completa**

```bash
cd api && python -m pytest tests/ -v
cd .. && npm test && npx tsc --noEmit && npm run build
```

Esperado: todo en verde.

- [ ] **Step 7: Commit de los artefactos**

```bash
git add api/artifacts/xgb_1m_*.joblib api/artifacts/meta_1m_*.json
git commit -m "chore(artifacts): modelos de 1 minuto para NVDA, QQQ y SNDK"
```
