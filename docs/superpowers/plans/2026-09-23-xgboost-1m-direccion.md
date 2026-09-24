# XGBoost 1m de dirección — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un modelo XGBoost agrupado que predice la dirección a 5/15/30 min con probabilidad y abstención, validado walk-forward contra baselines, entrenado en CI y servido en `/signal-1m` con registro de acierto en vivo.

**Architecture:** Una sola función de features (`training/features_1m_dir.py`) que usan entrenamiento e inferencia; datos de Polygon (barras 1m con `vw`/`n`, noticias) con caché en disco; un clasificador por horizonte con umbral de confianza y compuerta `has_edge`. La API calcula la fila de la última barra real y guarda cada señal en Supabase para medir el acierto real. El modelo de 1m actual y `/predict-1m` no se tocan.

**Tech Stack:** Python 3.11, pandas 2.2, numpy 1.26, xgboost 2.1, scikit-learn 1.5, FastAPI, Supabase REST, Next 14 + TypeScript, vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-23-xgboost-1m-direccion-design.md`

## Global Constraints

- Tickers del modelo: `NVDA QQQ SNDK TSM AVGO META AMAT MU`. Contexto: `SPY QQQ SMH`.
- Horizontes: 5, 15, 30 min. Banda muerta `δ_h = 0.25·σ·√h`.
- Historia de entrenamiento: 252 sesiones (1 año) de barras de 1 min en sesión regular (09:30–15:59 ET).
- Compuerta: `has_edge` solo si cobertura ≥ 10 %, cota inferior de Wilson 95 % > 0.5 y > mejor baseline sobre las mismas filas confiadas.
- Artefactos en `api/artifacts/1m_dir/` (nunca `api/artifacts/xgb_1m_*`: `/models-1m` los listaría).
- Sin nuevas dependencias de producción (la caché usa pickle, no Parquet: `pyarrow` no está en `api/requirements.txt`).
- No modificar `training/train_xgb_1m.py`, `api/intraday_1m.py` ni `/predict-1m`.
- Comentarios y mensajes en español, con la densidad de comentarios de `training/train_xgb_1m.py`.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests Python: `cd api && ../.venv/bin/python -m pytest -q`. Tests TS: `npx vitest run`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `training/data_1m.py` | Descarga de barras 1m (con `vw`, `n`) y caché pickle en `training/.cache_1m/` |
| `training/news_1m.py` | Noticias de Polygon → DataFrame `id, ts, sent`, con caché |
| `training/events_1m.py` + `training/macro_calendar.csv` | Días FOMC (CSV) y de empleo (primer viernes) |
| `training/features_1m_dir.py` | `FEATURE_COLS`, `build_features` — la única definición de features |
| `training/train_xgb_1m_dir.py` | Labels, walk-forward, τ, baselines, compuerta, artefactos, reporte |
| `api/signal_1m.py` | Carga de modelos + inferencia de la última barra |
| `api/signal_1m_store.py` + `supabase/signals_1m.sql` | Registro de señales y scorer en vivo |
| `api/main.py` | Endpoints `/signal-1m`, `/signal-1m-score`, `/models-1m-dir` |
| `api/sentiment.py` | Extrae `ticker_sentiment` (reutilizada por `news_1m.py`) |
| `api/tests/synth_1m.py` | Barras y noticias sintéticas para los tests |
| `lib/trading/overlays/signal1mLegend.ts` | Texto de la leyenda (función pura) |
| `types/trading.ts`, `lib/trading/mlApi.ts`, `lib/trading/capabilities.ts`, `lib/trading/overlays/{registry,remoteData,paint}.ts`, `components/trading/ChartPanel.tsx`, `app/api/ml/[...path]/route.ts` | Overlay `signal1m` en el Lab |
| `.github/workflows/train-1m-dir.yml` | Entrenamiento en la rama (push/dispatch) |
| `.github/workflows/retrain.yml` | Paso diario tras el merge |

---

### Task 1: Entorno local, caché ignorada, ajustes del spec y `data_1m.py`

**Files:**
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-09-23-xgboost-1m-direccion-design.md`
- Create: `training/data_1m.py`
- Create: `api/tests/synth_1m.py`
- Test: `api/tests/test_data_1m.py`

**Interfaces:**
- Produces: `data_1m.BAR_COLS`, `aggs_to_frame(results: list[dict]) -> DataFrame`, `fetch_bars(ticker: str, start: date, end: date, ttl: int = 60) -> DataFrame`, `merge_bars(old, new) -> DataFrame`, `last_sessions(df, sessions: int) -> DataFrame`, `load_bars(ticker: str, sessions: int, today: date | None = None) -> DataFrame`, `CACHE_DIR: Path`.
- Produces: `synth_1m.bars(n_days=30, seed=0, start="2026-01-05", price=100.0) -> DataFrame` (columnas `BAR_COLS`), `synth_1m.news(n=40, seed=0, start="2026-01-05", days=30) -> DataFrame` (`id, ts, sent`).

- [ ] **Step 1: Crear el entorno Python 3.11 (igual que CI)**

```bash
cd /home/luis/Sotck-ML
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r api/requirements-dev.txt
cd api && ../.venv/bin/python -m pytest -q
```
Expected: los tests existentes pasan (`test_intraday_1m.py`, `test_train_xgb_1m.py`, `test_polygon_client.py`).

- [ ] **Step 2: Ignorar venv y caché**

Añadir al final de `.gitignore`:
```
# Entorno local de Python y caché de barras/noticias de 1 min (training/data_1m.py)
.venv/
training/.cache_1m/
```

- [ ] **Step 3: Ajustar el spec a dos decisiones de implementación**

En el spec, sección «Datos», cambiar `Caché Parquet en training/.cache_1m/` por:
```
- Caché pickle en `training/.cache_1m/` (gitignored), descarga incremental. Pickle y no Parquet:
  `pyarrow` no está en `api/requirements.txt` y no merece entrar solo para una caché.
```
En «Features», reemplazar la frase de Earnings por:
```
Earnings: Polygon Starter no trae calendario de resultados (es un add-on), y `filing_date` de
`/vX/reference/financials` es la fecha del 10-Q, días o semanas después del reporte. Se usa en su
lugar `event_day = |gap z| > 3`, que se conoce en la apertura y marca el día posterior al reporte
(y cualquier otro shock). Macro: `training/macro_calendar.csv` con las decisiones FOMC; el informe de
empleo se aproxima como el primer viernes de cada mes.
```
Y en «Inferencia» cambiar los nombres de endpoint a `/signal-1m`, `/signal-1m-score` y `/models-1m-dir` (sin `/` anidada: el proxy de Next los resuelve por nombre).

- [ ] **Step 4: Escribir el generador sintético `api/tests/synth_1m.py`**

```python
"""Barras de 1 min y noticias sintéticas, deterministas, para los tests del
modelo de dirección. 390 barras por sesión hábil, con `vw` y `n` como Polygon."""
import numpy as np
import pandas as pd


def bars(n_days: int = 30, seed: int = 0, start: str = "2026-01-05",
         price: float = 100.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    frames = []
    for d in pd.bdate_range(start, periods=n_days):
        idx = pd.date_range(f"{d.date()} 09:30", periods=390, freq="1min",
                            tz="America/New_York")
        close = price * np.exp(np.cumsum(rng.normal(0, 0.001, 390)))
        open_ = np.r_[price * np.exp(rng.normal(0, 0.004)), close[:-1]]
        high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.0005, 390))
        low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.0005, 390))
        frames.append(pd.DataFrame({
            "dt_et": idx, "open": open_, "high": high, "low": low, "close": close,
            "volume": rng.integers(1000, 5000, 390).astype(float),
            "vw": (high + low + close) / 3,
            "n": rng.integers(10, 60, 390).astype(float),
        }))
        price = float(close[-1])
    return pd.concat(frames, ignore_index=True)


def news(n: int = 40, seed: int = 0, start: str = "2026-01-05",
         days: int = 30) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    base = pd.Timestamp(f"{start} 00:00", tz="UTC")
    minutes = np.sort(rng.uniform(0, days * 1440, n))
    return pd.DataFrame({
        "id": [f"a{i}" for i in range(n)],
        "ts": base + pd.to_timedelta(minutes, unit="min"),
        "sent": rng.choice([-1, 0, 1], n),
    })
```

- [ ] **Step 5: Escribir los tests que fallan `api/tests/test_data_1m.py`**

```python
"""Descarga y caché de barras de 1 min para el modelo de dirección."""
import datetime as dt
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import data_1m
from synth_1m import bars as synth_bars


def _ms(ts: str) -> int:
    return int(pd.Timestamp(ts, tz="America/New_York").tz_convert("UTC").value // 1_000_000)


def test_aggs_to_frame_filtra_la_sesion_y_conserva_vw_y_n():
    raw = [
        {"t": _ms("2026-09-22 09:29"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1, "vw": 1, "n": 1},
        {"t": _ms("2026-09-22 09:30"), "o": 2, "h": 2, "l": 2, "c": 2, "v": 2, "vw": 2.1, "n": 7},
        {"t": _ms("2026-09-22 15:59"), "o": 3, "h": 3, "l": 3, "c": 3, "v": 3, "vw": 3.1, "n": 9},
        {"t": _ms("2026-09-22 16:00"), "o": 4, "h": 4, "l": 4, "c": 4, "v": 4, "vw": 4, "n": 4},
    ]
    df = data_1m.aggs_to_frame(raw)
    assert list(df.columns) == data_1m.BAR_COLS
    assert list(df["close"]) == [2, 3]
    assert list(df["n"]) == [7, 9]
    assert list(df["vw"]) == [2.1, 3.1]


def test_aggs_to_frame_sin_vw_deja_nan_en_vez_de_fallar():
    raw = [{"t": _ms("2026-09-22 10:00"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    df = data_1m.aggs_to_frame(raw)
    assert df["vw"].isna().all() and df["n"].isna().all()


def test_merge_bars_se_queda_con_la_barra_nueva_si_se_solapan():
    old = synth_bars(n_days=2, seed=1)
    new = old.tail(10).copy()
    new["close"] = 999.0
    merged = data_1m.merge_bars(old, new)
    assert len(merged) == len(old)
    assert (merged.tail(10)["close"] == 999.0).all()


def test_last_sessions_recorta_por_sesiones_no_por_filas():
    df = synth_bars(n_days=5)
    out = data_1m.last_sessions(df, 2)
    assert out["dt_et"].dt.date.nunique() == 2
    assert out["dt_et"].dt.date.min() == df["dt_et"].dt.date.unique()[-2]


def test_load_bars_reutiliza_la_cache_y_solo_pide_desde_el_ultimo_dia(tmp_path, monkeypatch):
    monkeypatch.setattr(data_1m, "CACHE_DIR", tmp_path)
    full = synth_bars(n_days=10, start="2026-09-07")
    calls = []

    def fake_fetch(ticker, start, end, ttl=60):
        calls.append(start)
        return full[full["dt_et"].dt.date >= start].reset_index(drop=True)

    monkeypatch.setattr(data_1m, "fetch_bars", fake_fetch)
    today = dt.date(2026, 9, 19)
    first = data_1m.load_bars("NVDA", 5, today=today)
    second = data_1m.load_bars("NVDA", 5, today=today)

    last_day = full["dt_et"].dt.date.max()
    assert calls[1] == last_day          # la segunda vez solo re-descarga el último día
    assert calls[0] < calls[1]
    pd.testing.assert_frame_equal(first, second)
    assert first["dt_et"].dt.date.nunique() == 5
```

- [ ] **Step 6: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_data_1m.py -q`
Expected: FAIL con `ModuleNotFoundError: No module named 'data_1m'`.

- [ ] **Step 7: Implementar `training/data_1m.py`**

```python
"""
data_1m.py — Barras de 1 minuto de varios tickers, con caché en disco
====================================================================
Base del modelo de dirección (train_xgb_1m_dir.py) y de su inferencia
(api/signal_1m.py). A diferencia de train_xgb_1m.fetch_1m_polygon, conserva
`vw` (VWAP de la barra) y `n` (nº de transacciones): Polygon ya los devuelve y
son la única microestructura que el plan Starter deja ver.

Un año de 1 min son ~5 páginas de 50 000 barras por ticker (Polygon incluye el
horario extendido, que aquí se descarta). La caché evita bajarlo entero en cada
reentreno: se guarda {"start", "df"} y solo se re-descarga desde el último día
cacheado, que pudo quedar a medias.
"""

from __future__ import annotations
import os
import sys
import datetime as dt
from pathlib import Path

import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_paginated  # noqa: E402
from train_xgb_1m import SESSION_START_MIN, SESSION_END_MIN  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent / ".cache_1m"
BAR_COLS = ["dt_et", "open", "high", "low", "close", "volume", "vw", "n"]


def aggs_to_frame(results: list[dict]) -> pd.DataFrame:
    """Respuesta cruda de /v2/aggs → barras de sesión regular, ordenadas y únicas."""
    if not results:
        return pd.DataFrame(columns=BAR_COLS)
    df = pd.DataFrame(results).rename(columns={"o": "open", "h": "high", "l": "low",
                                               "c": "close", "v": "volume", "t": "timestamp"})
    for col in ("vw", "n"):
        if col not in df:
            df[col] = float("nan")
    df["dt_et"] = (pd.to_datetime(df["timestamp"], unit="ms", utc=True)
                   .dt.tz_convert("America/New_York"))
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    df = df[(mins >= SESSION_START_MIN) & (mins < SESSION_END_MIN)]
    return (df[BAR_COLS].sort_values("dt_et").drop_duplicates("dt_et", keep="last")
            .reset_index(drop=True))


def fetch_bars(ticker: str, start: dt.date, end: dt.date, ttl: int = 60) -> pd.DataFrame:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Falta POLYGON_API_KEY")
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={key}")
    page = get_paginated(url, ttl=ttl, max_pages=40)
    if page["truncated"]:
        # Entrenar con un recorte arbitrario sin saberlo es peor que fallar.
        raise RuntimeError(f"Descarga de 1 min truncada para {ticker}: faltan páginas")
    return aggs_to_frame(page["results"])


def merge_bars(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    """Une dos tramos; en un solape gana la barra nueva (la vieja pudo estar a medias)."""
    df = pd.concat([old, new], ignore_index=True)
    return (df.sort_values("dt_et").drop_duplicates("dt_et", keep="last")
            .reset_index(drop=True))


def last_sessions(df: pd.DataFrame, sessions: int) -> pd.DataFrame:
    days = sorted(df["dt_et"].dt.date.unique())[-sessions:]
    return df[df["dt_et"].dt.date.isin(days)].reset_index(drop=True)


def load_bars(ticker: str, sessions: int, today: dt.date | None = None) -> pd.DataFrame:
    """Últimas `sessions` sesiones de `ticker`, usando y actualizando la caché."""
    today = today or dt.date.today()
    # ×1.6 + 7: fines de semana y festivos, con margen.
    start = today - dt.timedelta(days=int(sessions * 1.6) + 7)
    path = CACHE_DIR / f"{ticker.upper()}.pkl"
    cache = pd.read_pickle(path) if path.exists() else None

    if cache and cache["start"] <= start and len(cache["df"]):
        cached = cache["df"]
        last = cached["dt_et"].dt.date.max()
        df = merge_bars(cached[cached["dt_et"].dt.date < last], fetch_bars(ticker, last, today))
        cache_start = cache["start"]
    else:
        df = fetch_bars(ticker, start, today)
        cache_start = start

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.to_pickle({"start": cache_start, "df": df}, path)
    return last_sessions(df, sessions)
```

- [ ] **Step 8: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_data_1m.py -q`
Expected: 5 passed.

- [ ] **Step 9: Commit**

```bash
git add .gitignore docs/superpowers/specs/2026-09-23-xgboost-1m-direccion-design.md \
        training/data_1m.py api/tests/synth_1m.py api/tests/test_data_1m.py
git commit -m "feat(ml): descarga de barras de 1 min con vw/n y caché en disco

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Noticias con sentimiento (`news_1m.py`)

**Files:**
- Modify: `api/sentiment.py` (bucle de `fetch_news`)
- Create: `training/news_1m.py`
- Test: `api/tests/test_news_1m.py`

**Interfaces:**
- Consumes: `data_1m.CACHE_DIR` (misma carpeta de caché).
- Produces: `sentiment.ticker_sentiment(article: dict, ticker: str) -> tuple[str, str]`; `news_1m.NEWS_COLS = ["id", "ts", "sent"]`; `news_to_frame(results, ticker) -> DataFrame` (`ts` tz-aware UTC, `sent` ∈ {-1,0,1}); `fetch_news(ticker, since: date, ttl=300) -> DataFrame`; `load_news(ticker, since: date) -> DataFrame`.

- [ ] **Step 1: Tests que fallan `api/tests/test_news_1m.py`**

```python
"""Noticias de Polygon → serie temporal de sentimiento por ticker."""
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import news_1m
from sentiment import ticker_sentiment


def test_ticker_sentiment_toma_el_insight_del_ticker_pedido():
    art = {"insights": [{"ticker": "AMD", "sentiment": "negative"},
                        {"ticker": "nvda", "sentiment": "positive", "sentiment_reasoning": "r"}]}
    assert ticker_sentiment(art, "NVDA") == ("positive", "r")
    assert ticker_sentiment({"insights": None}, "NVDA") == ("neutral", "")


def test_news_to_frame_ordena_deduplica_y_codifica_el_sentimiento():
    raw = [
        {"id": "b", "published_utc": "2026-09-22T15:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "negative"}]},
        {"id": "a", "published_utc": "2026-09-22T14:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "positive"}]},
        {"id": "a", "published_utc": "2026-09-22T14:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "positive"}]},
        {"id": "c", "published_utc": "2026-09-22T16:00:00Z",
         "insights": [{"ticker": "AMD", "sentiment": "positive"}]},
    ]
    df = news_1m.news_to_frame(raw, "NVDA")
    assert list(df.columns) == news_1m.NEWS_COLS
    assert list(df["id"]) == ["a", "b", "c"]
    assert list(df["sent"]) == [1, -1, 0]
    assert str(df["ts"].dt.tz) == "UTC"


def test_news_to_frame_vacio_devuelve_columnas():
    df = news_1m.news_to_frame([], "NVDA")
    assert list(df.columns) == news_1m.NEWS_COLS and df.empty


def test_load_news_usa_la_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(news_1m, "CACHE_DIR", tmp_path)
    calls = []
    frame = news_1m.news_to_frame([
        {"id": "a", "published_utc": "2026-09-20T14:00:00Z", "insights": []},
        {"id": "b", "published_utc": "2026-09-22T14:00:00Z", "insights": []},
    ], "NVDA")

    def fake_fetch(ticker, since, ttl=300):
        calls.append(since)
        return frame[frame["ts"].dt.date >= since].reset_index(drop=True)

    monkeypatch.setattr(news_1m, "fetch_news", fake_fetch)
    since = pd.Timestamp("2026-09-01").date()
    news_1m.load_news("NVDA", since)
    out = news_1m.load_news("NVDA", since)
    assert calls[1] == pd.Timestamp("2026-09-22").date()
    assert list(out["id"]) == ["a", "b"]
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_news_1m.py -q`
Expected: FAIL (`ImportError: cannot import name 'ticker_sentiment'`).

- [ ] **Step 3: Extraer `ticker_sentiment` en `api/sentiment.py`**

Añadir antes de `def fetch_news`:
```python
def ticker_sentiment(article: dict, ticker: str) -> tuple[str, str]:
    """(sentimiento, razonamiento) del insight de `ticker` en un artículo de
    /v2/reference/news; neutral si el artículo no trae insight para él."""
    for ins in article.get("insights") or []:
        if (ins.get("ticker") or "").upper() == ticker.upper():
            return ins.get("sentiment", "neutral"), ins.get("sentiment_reasoning", "")
    return "neutral", ""
```
Y en `fetch_news` reemplazar:
```python
        # 'insights' trae sentimiento por ticker cuando está disponible
        sentiment, reason = "neutral", ""
        for ins in r.get("insights", []):
            if ins.get("ticker", "").upper() == ticker.upper():
                sentiment = ins.get("sentiment", "neutral")
                reason = ins.get("sentiment_reasoning", "")
                break
```
por:
```python
        # 'insights' trae sentimiento por ticker cuando está disponible
        sentiment, reason = ticker_sentiment(r, ticker)
```

- [ ] **Step 4: Implementar `training/news_1m.py`**

```python
"""
news_1m.py — Historial de noticias de Polygon con sentimiento, por ticker
=======================================================================
/v2/reference/news trae `insights` con el sentimiento del artículo hacia cada
ticker que menciona. Aquí se reduce a una serie (id, ts UTC, sent ∈ {-1,0,1})
que features_1m_dir.py agrega por ventanas SOLO hacia atrás: una noticia cuenta
para la barra t si se publicó antes del cierre de esa barra.
"""

from __future__ import annotations
import os
import sys
import datetime as dt

import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_paginated  # noqa: E402
from sentiment import ticker_sentiment  # noqa: E402
from data_1m import CACHE_DIR  # noqa: E402

NEWS_COLS = ["id", "ts", "sent"]
SENT_VALUE = {"positive": 1, "negative": -1}


def news_to_frame(results: list[dict], ticker: str) -> pd.DataFrame:
    rows = [{"id": r.get("id"), "ts": r.get("published_utc"),
             "sent": SENT_VALUE.get(ticker_sentiment(r, ticker)[0], 0)}
            for r in results if r.get("published_utc")]
    if not rows:
        return pd.DataFrame({"id": pd.Series(dtype=str),
                             "ts": pd.Series(dtype="datetime64[ns, UTC]"),
                             "sent": pd.Series(dtype=int)})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return (df.drop_duplicates("id").sort_values("ts").reset_index(drop=True)[NEWS_COLS])


def fetch_news(ticker: str, since: dt.date, ttl: int = 300) -> pd.DataFrame:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Falta POLYGON_API_KEY")
    url = (f"https://api.polygon.io/v2/reference/news?ticker={ticker.upper()}"
           f"&published_utc.gte={since.isoformat()}&order=asc&sort=published_utc"
           f"&limit=1000&apiKey={key}")
    page = get_paginated(url, ttl=ttl, max_pages=40)
    if page["truncated"]:
        print(f"[aviso] noticias truncadas para {ticker}: faltan páginas")
    return news_to_frame(page["results"], ticker)


def load_news(ticker: str, since: dt.date) -> pd.DataFrame:
    """Noticias desde `since`, con la misma caché incremental que las barras."""
    path = CACHE_DIR / f"news_{ticker.upper()}.pkl"
    cache = pd.read_pickle(path) if path.exists() else None

    if cache and cache["since"] <= since and len(cache["df"]):
        cached = cache["df"]
        last = cached["ts"].max().date()
        df = pd.concat([cached, fetch_news(ticker, last)], ignore_index=True)
        df = df.drop_duplicates("id", keep="last").sort_values("ts").reset_index(drop=True)
        cache_since = cache["since"]
    else:
        df = fetch_news(ticker, since)
        cache_since = since

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.to_pickle({"since": cache_since, "df": df}, path)
    return df[df["ts"].dt.date >= since].reset_index(drop=True)
```

- [ ] **Step 5: Ejecutar y ver que pasan (también los de sentiment existentes)**

Run: `cd api && ../.venv/bin/python -m pytest -q`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add api/sentiment.py training/news_1m.py api/tests/test_news_1m.py
git commit -m "feat(ml): historial de noticias con sentimiento para el modelo de 1 min

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Calendario macro (`events_1m.py`)

**Files:**
- Create: `training/macro_calendar.csv`
- Create: `training/events_1m.py`
- Test: `api/tests/test_events_1m.py`

**Interfaces:**
- Produces: `load_fomc_days(path: Path = CALENDAR) -> set[date]`; `is_nfp_day(d: date) -> bool`; `macro_flags(days: Iterable[date], fomc_days: set[date]) -> DataFrame` (índice = día, columnas `is_fomc_day`, `is_nfp_day` en float).

- [ ] **Step 1: Verificar las fechas FOMC contra la Fed**

Consultar `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` (WebFetch) y confirmar los días de decisión (segundo día de cada reunión) de 2025 y 2026. Los esperados son los del CSV siguiente; si alguno difiere, usar el de la Fed.

- [ ] **Step 2: Crear `training/macro_calendar.csv`**

```csv
date,event
2025-01-29,FOMC
2025-03-19,FOMC
2025-05-07,FOMC
2025-06-18,FOMC
2025-07-30,FOMC
2025-09-17,FOMC
2025-10-29,FOMC
2025-12-10,FOMC
2026-01-28,FOMC
2026-03-18,FOMC
2026-04-29,FOMC
2026-06-17,FOMC
2026-07-29,FOMC
2026-09-16,FOMC
2026-10-28,FOMC
2026-12-09,FOMC
```

- [ ] **Step 3: Tests que fallan `api/tests/test_events_1m.py`**

```python
"""Días de evento macro."""
import datetime as dt
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API.parent / "training"))

import events_1m


def test_el_calendario_trae_las_decisiones_fomc():
    days = events_1m.load_fomc_days()
    assert dt.date(2026, 9, 16) in days
    assert dt.date(2026, 9, 15) not in days


def test_el_empleo_es_el_primer_viernes():
    assert events_1m.is_nfp_day(dt.date(2026, 9, 4))
    assert not events_1m.is_nfp_day(dt.date(2026, 9, 11))
    assert not events_1m.is_nfp_day(dt.date(2026, 9, 3))


def test_macro_flags_por_dia():
    days = [dt.date(2026, 9, 4), dt.date(2026, 9, 16), dt.date(2026, 9, 17)]
    flags = events_1m.macro_flags(days, {dt.date(2026, 9, 16)})
    assert flags.loc[dt.date(2026, 9, 16), "is_fomc_day"] == 1.0
    assert flags.loc[dt.date(2026, 9, 4), "is_nfp_day"] == 1.0
    assert flags.loc[dt.date(2026, 9, 17)].sum() == 0.0
```

- [ ] **Step 4: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_events_1m.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'events_1m'`).

- [ ] **Step 5: Implementar `training/events_1m.py`**

```python
"""
events_1m.py — Días de evento macro para el modelo de dirección de 1 min
=======================================================================
FOMC: días de decisión desde macro_calendar.csv (la Fed publica el calendario
con un año de antelación; hay que añadir el año siguiente cada diciembre).

Empleo (NFP): se aproxima como el primer viernes del mes. El BLS a veces lo
mueve (festivos, cierres de gobierno); el error es de pocos días al año y la
feature solo marca régimen, no es una señal por sí misma.
"""

from __future__ import annotations
import datetime as dt
from pathlib import Path
from typing import Iterable

import pandas as pd

CALENDAR = Path(__file__).resolve().parent / "macro_calendar.csv"


def load_fomc_days(path: Path = CALENDAR) -> set[dt.date]:
    cal = pd.read_csv(path, parse_dates=["date"])
    return set(cal.loc[cal["event"] == "FOMC", "date"].dt.date)


def is_nfp_day(d: dt.date) -> bool:
    return d.weekday() == 4 and d.day <= 7


def macro_flags(days: Iterable[dt.date], fomc_days: set[dt.date]) -> pd.DataFrame:
    days = list(days)
    return pd.DataFrame({
        "is_fomc_day": [float(d in fomc_days) for d in days],
        "is_nfp_day": [float(is_nfp_day(d)) for d in days],
    }, index=days)
```

- [ ] **Step 6: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_events_1m.py -q`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add training/macro_calendar.csv training/events_1m.py api/tests/test_events_1m.py
git commit -m "feat(ml): calendario FOMC y días de empleo para el modelo de 1 min

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Features (`features_1m_dir.py`)

**Files:**
- Create: `training/features_1m_dir.py`
- Test: `api/tests/test_features_1m_dir.py`

**Interfaces:**
- Consumes: `events_1m.load_fomc_days`, `events_1m.macro_flags`; barras con `BAR_COLS`; noticias con `NEWS_COLS`.
- Produces: `TICKERS`, `CONTEXT_SYMBOLS`, `BARS_PER_SESSION`, `HISTORY_SESSIONS` (=51), `FEATURE_COLS` (41 columnas, la última `"ticker"` categórica), `KEEP_COLS = ["dt_et", "day", "bar_idx", "close", "sig"]`, `build_features(bars, ticker, context: dict[str, DataFrame], news: DataFrame | None, fomc_days: set[date] | None = None) -> DataFrame` con columnas `KEEP_COLS + FEATURE_COLS`, sin filas de calentamiento (`sig` NaN).

- [ ] **Step 1: Tests que fallan `api/tests/test_features_1m_dir.py`**

```python
"""Features del modelo de dirección de 1 min.

Los dos tests que importan: (1) sin fuga — alterar el futuro no cambia el
pasado; (2) la ventana corta de la inferencia (HISTORY_SESSIONS) reproduce
exactamente la fila del entrenamiento.
"""
import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import features_1m_dir as F
from synth_1m import bars as synth_bars, news as synth_news

N_DAYS = 60


@pytest.fixture(scope="module")
def data():
    ctx = {"SPY": synth_bars(N_DAYS, seed=11), "QQQ": synth_bars(N_DAYS, seed=12),
           "SMH": synth_bars(N_DAYS, seed=13)}
    return synth_bars(N_DAYS, seed=1), ctx, synth_news(200, seed=2, days=N_DAYS * 1.5)


def _build(bars, ctx, news, **kw):
    return F.build_features(bars, "NVDA", ctx, news, fomc_days=set(), **kw)


def test_columnas_y_orden(data):
    out = _build(*data)
    assert len(F.FEATURE_COLS) == 41 and len(set(F.FEATURE_COLS)) == 41
    assert list(out.columns) == F.KEEP_COLS + F.FEATURE_COLS
    assert out["sig"].notna().all()
    assert list(out["ticker"].cat.categories) == list(F.TICKERS)


def test_sin_fuga_de_barras_futuras(data):
    bars, ctx, news = data
    cut = bars["dt_et"].iloc[390 * 40 + 200]
    base = _build(bars, ctx, news)

    def perturb(df):
        df = df.copy()
        after = df["dt_et"] > cut
        for col in ("open", "high", "low", "close", "vw"):
            df.loc[after, col] *= 1.07
        df.loc[after, "volume"] *= 3
        df.loc[after, "n"] *= 2
        return df

    moved = _build(perturb(bars), {k: perturb(v) for k, v in ctx.items()}, news)
    past = base["dt_et"] <= cut
    pd.testing.assert_frame_equal(base[past].reset_index(drop=True),
                                  moved[moved["dt_et"] <= cut].reset_index(drop=True))


def test_sin_fuga_de_noticias_futuras(data):
    bars, ctx, news = data
    t = bars["dt_et"].iloc[390 * 40 + 200]
    base = _build(bars, ctx, news)
    later = pd.DataFrame({"id": ["x1", "x2"],
                          "ts": [(t + pd.Timedelta(minutes=1, seconds=1)).tz_convert("UTC"),
                                 (t + pd.Timedelta(hours=3)).tz_convert("UTC")],
                          "sent": [1, -1]})
    moved = _build(bars, ctx, pd.concat([news, later], ignore_index=True).sort_values("ts"))
    past = base["dt_et"] <= t
    pd.testing.assert_frame_equal(base[past].reset_index(drop=True),
                                  moved[moved["dt_et"] <= t].reset_index(drop=True))


def test_la_ventana_de_inferencia_reproduce_la_fila_del_entrenamiento(data):
    bars, ctx, news = data
    full = _build(bars, ctx, news)
    keep = sorted(bars["dt_et"].dt.date.unique())[-F.HISTORY_SESSIONS:]
    cut = lambda df: df[df["dt_et"].dt.date.isin(keep)].reset_index(drop=True)
    short = _build(cut(bars), {k: cut(v) for k, v in ctx.items()}, news)
    last = keep[-1]
    pd.testing.assert_frame_equal(full[full["day"] == last].reset_index(drop=True),
                                  short[short["day"] == last].reset_index(drop=True))


def test_conteo_y_sentimiento_de_noticias(data):
    bars, ctx, _ = data
    day = bars["dt_et"].dt.date.unique()[30]
    at = lambda hm: pd.Timestamp(f"{day} {hm}", tz="America/New_York").tz_convert("UTC")
    news = pd.DataFrame({"id": ["a", "b"], "ts": [at("10:00"), at("10:20")], "sent": [1, -1]})
    out = _build(bars, ctx, news)
    row = out[out["dt_et"] == pd.Timestamp(f"{day} 10:30", tz="America/New_York")].iloc[0]
    assert row["news_60m"] == 2 and row["news_24h"] == 2
    assert row["sent_24h"] == 0
    assert row["mins_since_news"] == pytest.approx(11.0)   # cierre 10:31 − 10:20


def test_un_gap_grande_marca_dia_de_evento(data):
    bars, ctx, news = data
    bars = bars.copy()
    days = bars["dt_et"].dt.date
    shock = days.unique()[40]
    for col in ("open", "high", "low", "close", "vw"):
        bars.loc[days >= shock, col] *= 1.2
    out = _build(bars, ctx, news)
    by_day = out.groupby("day")[["event_day", "days_since_event"]].first()
    next_day = days.unique()[41]
    assert by_day.loc[shock, "event_day"] == 1.0
    assert by_day.loc[shock, "days_since_event"] == 0
    assert by_day.loc[next_day, "days_since_event"] == 1


def test_dia_fomc_cuenta_minutos_hasta_la_decision(data):
    bars, ctx, news = data
    day = bars["dt_et"].dt.date.unique()[45]
    out = F.build_features(bars, "NVDA", ctx, news, fomc_days={day})
    row = out[out["dt_et"] == pd.Timestamp(f"{day} 13:00", tz="America/New_York")].iloc[0]
    assert row["is_fomc_day"] == 1.0 and row["fomc_mins_to_decision"] == 60
    other = out[out["day"] != day].iloc[0]
    assert other["fomc_mins_to_decision"] == F.FOMC_NONE


def test_sin_contexto_ni_noticias_no_falla(data):
    bars, _, _ = data
    out = F.build_features(bars, "NVDA", {}, None, fomc_days=set())
    assert out["qqq_ret_5_z"].isna().all()
    assert (out["news_24h"] == 0).all()
    assert (out["mins_since_news"] == F.NEWS_SINCE_CAP_MIN).all()


def test_ticker_desconocido_se_rechaza(data):
    bars, ctx, news = data
    with pytest.raises(ValueError):
        F.build_features(bars, "TSLA", ctx, news, fomc_days=set())
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_features_1m_dir.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'features_1m_dir'`).

- [ ] **Step 3: Implementar `training/features_1m_dir.py`**

```python
"""
features_1m_dir.py — Features del modelo de DIRECCIÓN de 1 minuto
=================================================================
UNA sola definición, usada por el entrenamiento (train_xgb_1m_dir.py) y por la
inferencia (api/signal_1m.py): la inferencia llama a esta misma función sobre
las últimas HISTORY_SESSIONS sesiones y se queda con la última fila. Sin gemelo
incremental no hay dos definiciones que puedan divergir en silencio.

Regla de oro: la fila t solo usa lo disponible al CIERRE de la barra t —barras
con inicio ≤ t, noticias publicadas antes de t+1 min y agregados de sesiones
ANTERIORES—. tests/test_features_1m_dir.py lo comprueba alterando el futuro.

Retornos y volatilidades van en unidades de σ del ticker (σ de 1 min de las 20
sesiones previas) para que un modelo agrupado compare NVDA con QQQ.
"""

from __future__ import annotations
import datetime as dt

import numpy as np
import pandas as pd

from events_1m import load_fomc_days, macro_flags

TICKERS = ("NVDA", "QQQ", "SNDK", "TSM", "AVGO", "META", "AMAT", "MU")
CONTEXT_SYMBOLS = ("SPY", "QQQ", "SMH")

BARS_PER_SESSION = 390
SIGMA_DAYS = 20          # σ y β: sesiones previas
SIGMA_MIN_DAYS = 5
TOD_DAYS = 20            # z-score del volumen contra la misma hora del día
RET_WINDOWS = (1, 5, 15, 30, 60)
CTX_WINDOWS = (1, 5, 15)
EVENT_GAP_Z = 3.0
DAYS_SINCE_CAP = 30
NEWS_SINCE_CAP_MIN = 3 * 1440
FOMC_DECISION_MIN = 14 * 60
FOMC_NONE = 999.0

# Sesiones que necesita la fila de HOY para salir idéntica a la del
# entrenamiento: 20 de σ para cada una de las 30 que mira days_since_event.
HISTORY_SESSIONS = SIGMA_DAYS + DAYS_SINCE_CAP + 1

KEEP_COLS = ["dt_et", "day", "bar_idx", "close", "sig"]
FEATURE_COLS = [
    "tod_sin", "tod_cos", "bars_left",
    "ret_from_open_z", "dist_vwap_z", "gap_z",
    *[f"ret_{k}_z" for k in RET_WINDOWS],
    "rv_15_z", "rv_60_z", "range_z", "vol_tod_z", "cumvol_tod_z",
    "n_rel", "vw_dev_z", "size_rel",
    *[f"{s.lower()}_ret_{k}_z" for s in CONTEXT_SYMBOLS for k in CTX_WINDOWS],
    "beta_mkt", "rs_15_z", "rs_60_z",
    "news_60m", "news_24h", "sent_24h", "mins_since_news",
    "event_day", "days_since_event", "is_fomc_day", "is_nfp_day", "fomc_mins_to_decision",
    "ticker",
]


# --------------------------------------------------------------------------- #
# Piezas
# --------------------------------------------------------------------------- #
def _base(bars: pd.DataFrame) -> pd.DataFrame:
    out = bars.sort_values("dt_et").reset_index(drop=True).copy()
    out["day"] = out["dt_et"].dt.date
    out["bar_idx"] = out.groupby("day").cumcount()
    # Retorno de 1 min que NO cruza el cambio de sesión.
    out["ret"] = np.log(out["close"] / out.groupby("day")["close"].shift(1))
    return out


def daily_sigma(df: pd.DataFrame) -> pd.Series:
    """σ de 1 min de las SIGMA_DAYS sesiones PREVIAS, por día (shift(1): hoy no cuenta)."""
    sumsq = (df["ret"] ** 2).groupby(df["day"]).sum()
    count = df["ret"].notna().groupby(df["day"]).sum().astype(float)
    roll = lambda s: s.rolling(SIGMA_DAYS, min_periods=SIGMA_MIN_DAYS).sum().shift(1)
    return np.sqrt(roll(sumsq) / roll(count).replace(0, np.nan))


def _ret_k(close: pd.Series, day: pd.Series, k: int) -> pd.Series:
    return np.log(close / close.groupby(day).shift(k))


def _expanding_mean(s: pd.Series, day: pd.Series) -> pd.Series:
    total = s.fillna(0.0).groupby(day).cumsum()
    count = s.notna().astype(float).groupby(day).cumsum()
    return total / count.replace(0, np.nan)


def _tod_z(values: pd.Series, bar_idx: pd.Series) -> pd.Series:
    """z-score contra la MISMA barra del día en las TOD_DAYS sesiones previas.
    Filas ordenadas por dt_et ⇒ dentro de cada bar_idx van en orden de día."""
    g = values.groupby(bar_idx)
    prev = lambda x: x.shift(1).rolling(TOD_DAYS, min_periods=SIGMA_MIN_DAYS)
    mean = g.transform(lambda x: prev(x).mean())
    std = g.transform(lambda x: prev(x).std())
    return (values - mean) / std.replace(0, np.nan)


def _context_frame(bars: pd.DataFrame | None, sym: str) -> pd.DataFrame | None:
    """Retornos del contexto en σ propios + crudos (para β y fuerza relativa)."""
    if bars is None or len(bars) == 0:
        return None
    c = _base(bars)
    sig = c["day"].map(daily_sigma(c))
    p = sym.lower()
    out = pd.DataFrame({"dt_et": c["dt_et"]})
    for k in CTX_WINDOWS:
        out[f"{p}_ret_{k}_z"] = _ret_k(c["close"], c["day"], k) / (sig * np.sqrt(k))
    out[f"_{p}_ret"] = c["ret"]
    for k in (15, 60):
        out[f"_{p}_raw_{k}"] = _ret_k(c["close"], c["day"], k)
    return out


def _utc_ns(ts: pd.Series) -> np.ndarray:
    return (ts.dt.tz_convert("UTC").dt.tz_localize(None)
            .astype("datetime64[ns]").to_numpy().astype("int64"))


def _news_block(bar_end: pd.Series, news: pd.DataFrame | None) -> dict[str, np.ndarray]:
    n = len(bar_end)
    if news is None or len(news) == 0:
        return {"news_60m": np.zeros(n), "news_24h": np.zeros(n), "sent_24h": np.zeros(n),
                "mins_since_news": np.full(n, float(NEWS_SINCE_CAP_MIN))}
    news = news.sort_values("ts")
    ts = _utc_ns(news["ts"])
    t = _utc_ns(bar_end)
    minute = 60 * 10**9
    # side="right": una noticia publicada justo al cierre de la barra ya cuenta.
    upto = np.searchsorted(ts, t, side="right")
    from_60 = np.searchsorted(ts, t - 60 * minute, side="right")
    from_24h = np.searchsorted(ts, t - 1440 * minute, side="right")
    csum = np.concatenate([[0], np.cumsum(news["sent"].to_numpy(dtype=float))])
    last = np.where(upto > 0, ts[np.maximum(upto - 1, 0)], np.iinfo(np.int64).min)
    since = np.where(upto > 0, (t - last) / minute, np.inf)
    return {
        "news_60m": (upto - from_60).astype(float),
        "news_24h": (upto - from_24h).astype(float),
        "sent_24h": csum[upto] - csum[from_24h],
        "mins_since_news": np.minimum(since, NEWS_SINCE_CAP_MIN).astype(float),
    }


# --------------------------------------------------------------------------- #
# Orquestador
# --------------------------------------------------------------------------- #
def build_features(bars: pd.DataFrame, ticker: str, context: dict[str, pd.DataFrame],
                   news: pd.DataFrame | None,
                   fomc_days: set[dt.date] | None = None) -> pd.DataFrame:
    t = ticker.upper()
    if t not in TICKERS:
        raise ValueError(f"{t} no está entre los tickers del modelo de dirección: {TICKERS}")
    fomc_days = load_fomc_days() if fomc_days is None else fomc_days

    df = _base(bars)

    # Contexto primero: el merge rehace el índice y todo lo demás cuelga de él.
    ctx_cols = []
    for sym in CONTEXT_SYMBOLS:
        frame = _context_frame(context.get(sym), sym)
        p = sym.lower()
        cols = [f"{p}_ret_{k}_z" for k in CTX_WINDOWS] + [f"_{p}_ret", f"_{p}_raw_15", f"_{p}_raw_60"]
        if frame is None:
            for col in cols:
                df[col] = np.nan
        else:
            df = df.merge(frame, on="dt_et", how="left")
        ctx_cols += cols
    # Una barra de contexto ausente hereda la anterior de la MISMA sesión.
    df[ctx_cols] = df.groupby("day")[ctx_cols].ffill()

    day = df["day"]
    sig_day = daily_sigma(df)
    df["sig"] = day.map(sig_day)
    sig = df["sig"]

    m = df["bar_idx"].clip(upper=BARS_PER_SESSION - 1)
    df["tod_sin"] = np.sin(2 * np.pi * m / BARS_PER_SESSION)
    df["tod_cos"] = np.cos(2 * np.pi * m / BARS_PER_SESSION)
    df["bars_left"] = (BARS_PER_SESSION - 1 - m).clip(lower=0) / BARS_PER_SESSION

    open_px = df.groupby("day")["open"].transform("first")
    df["ret_from_open_z"] = np.log(df["close"] / open_px) / (sig * np.sqrt(df["bar_idx"] + 1))

    tp = (df["high"] + df["low"] + df["close"]) / 3
    vwap = (tp * df["volume"]).groupby(day).cumsum() / df["volume"].groupby(day).cumsum().replace(0, np.nan)
    df["dist_vwap_z"] = ((df["close"] - vwap) / vwap) / sig

    close_by_day = df.groupby("day")["close"].last()
    open_by_day = df.groupby("day")["open"].first()
    gap_z_day = np.log(open_by_day / close_by_day.shift(1)) / (sig_day * np.sqrt(BARS_PER_SESSION))
    df["gap_z"] = day.map(gap_z_day)

    for k in RET_WINDOWS:
        df[f"ret_{k}_z"] = _ret_k(df["close"], day, k) / (sig * np.sqrt(k))
    for w in (15, 60):
        rv = df.groupby("day")["ret"].transform(lambda s: s.rolling(w, min_periods=5).std())
        df[f"rv_{w}_z"] = rv / sig
    df["range_z"] = ((df["high"] - df["low"]) / df["close"]) / sig
    df["vol_tod_z"] = _tod_z(np.log1p(df["volume"]), df["bar_idx"])
    df["cumvol_tod_z"] = _tod_z(np.log1p(df["volume"].groupby(day).cumsum()), df["bar_idx"])

    n = df["n"].astype(float).replace(0, np.nan)
    df["n_rel"] = n / _expanding_mean(n, day)
    df["vw_dev_z"] = ((df["close"] - df["vw"]) / df["close"]) / sig
    size = df["volume"] / n
    df["size_rel"] = size / _expanding_mean(size, day)

    # β y fuerza relativa contra el mercado (QQQ; para el propio QQQ, SPY).
    mkt = "spy" if t == "QQQ" else "qqq"
    x, y = df[f"_{mkt}_ret"], df["ret"]
    valid = x.notna() & y.notna()
    sxy = (x * y).where(valid).groupby(day).sum()
    sxx = (x * x).where(valid).groupby(day).sum()
    roll = lambda s: s.rolling(SIGMA_DAYS, min_periods=SIGMA_MIN_DAYS).sum().shift(1)
    df["beta_mkt"] = day.map(roll(sxy) / roll(sxx).replace(0, np.nan))
    for k in (15, 60):
        df[f"rs_{k}_z"] = ((_ret_k(df["close"], day, k) - df["beta_mkt"] * df[f"_{mkt}_raw_{k}"])
                           / (sig * np.sqrt(k)))

    for name, values in _news_block(df["dt_et"] + pd.Timedelta(minutes=1), news).items():
        df[name] = values

    # Eventos: el gap se conoce en la apertura, así que marcar el día entero no filtra.
    event_by_day = (gap_z_day.abs() > EVENT_GAP_Z)
    since, counter = {}, DAYS_SINCE_CAP
    for d, is_event in event_by_day.items():
        counter = 0 if is_event else min(counter + 1, DAYS_SINCE_CAP)
        since[d] = counter
    df["event_day"] = day.map(event_by_day.astype(float))
    df["days_since_event"] = day.map(since).astype(float)
    flags = macro_flags(sorted(day.unique()), fomc_days)
    df["is_fomc_day"] = day.map(flags["is_fomc_day"])
    df["is_nfp_day"] = day.map(flags["is_nfp_day"])
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    df["fomc_mins_to_decision"] = np.where(df["is_fomc_day"] == 1.0,
                                           FOMC_DECISION_MIN - mins, FOMC_NONE).astype(float)

    out = df[df["sig"].notna()].reset_index(drop=True)
    out["ticker"] = pd.Categorical([t] * len(out), categories=list(TICKERS))
    return out[KEEP_COLS + FEATURE_COLS]
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_features_1m_dir.py -q`
Expected: 9 passed. Si falla la equivalencia de ventana, revisar qué feature depende de más de `HISTORY_SESSIONS` sesiones y corregir la feature (no el test).

- [ ] **Step 5: Commit**

```bash
git add training/features_1m_dir.py api/tests/test_features_1m_dir.py
git commit -m "feat(ml): features del modelo de dirección de 1 min (mercado, noticias, eventos)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Entrenamiento walk-forward (`train_xgb_1m_dir.py`)

**Files:**
- Create: `training/train_xgb_1m_dir.py`
- Test: `api/tests/test_train_xgb_1m_dir.py`

**Interfaces:**
- Consumes: `features_1m_dir.{TICKERS, CONTEXT_SYMBOLS, FEATURE_COLS, HISTORY_SESSIONS, build_features}`, `data_1m.load_bars`, `news_1m.load_news`.
- Produces: `HORIZONS = (5, 15, 30)`, `DEAD_BAND = 0.25`, `ARTIFACT_DIR = api/artifacts/1m_dir`, `make_labels(feat, h) -> (r: Series, y: Series)`, `assemble(features_by_ticker: dict[str, DataFrame]) -> DataFrame` (añade `r_{h}`, `y_{h}`), `walk_forward_folds(days, n_folds, min_train_days) -> list[tuple[list[date], list[date]]]`, `wilson_lower(k, n, z=1.96) -> float`, `confident_stats(p, y, tau) -> dict(n, coverage, precision, wilson_lo)`, `choose_tau(p, y, min_coverage) -> float`, `gate(stats, baseline_accs: dict[str, float|None], min_coverage) -> bool`, `train_horizon(ds, h, n_folds=N_FOLDS, min_train_days=MIN_TRAIN_DAYS, params=None) -> (XGBClassifier, dict)`.
- `meta.json`: `{"model", "trained_at", "tickers", "context", "feature_cols", "dead_band", "history_sessions", "sessions", "n_rows", "horizons": {"5": {"tau", "holdout": {"n", "coverage", "precision", "wilson_lo", "acc_all"}, "baselines": {name: {"all", "confident"}}, "has_edge", "folds": [...], "by_hour": {...}, "top_features": [...], "n_estimators", "abs_ret_mean": {ticker: float}}, ...}}`.

- [ ] **Step 1: Tests que fallan `api/tests/test_train_xgb_1m_dir.py`**

```python
"""Labels, walk-forward y compuerta del modelo de dirección."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import train_xgb_1m_dir as T
import features_1m_dir as F
from synth_1m import bars as synth_bars, news as synth_news


def _feat(n_days=40, seed=1, ticker="NVDA"):
    ctx = {"SPY": synth_bars(n_days, seed=11), "QQQ": synth_bars(n_days, seed=12),
           "SMH": synth_bars(n_days, seed=13)}
    return F.build_features(synth_bars(n_days, seed=seed), ticker, ctx,
                            synth_news(100, seed=seed, days=n_days * 1.5), fomc_days=set())


def test_labels_no_cruzan_el_cierre_y_excluyen_la_banda_muerta():
    feat = _feat(n_days=25)
    r, y = T.make_labels(feat, 15)
    last_bars = feat.groupby("day").tail(15).index
    assert r.loc[last_bars].isna().all() and y.loc[last_bars].isna().all()
    band = T.DEAD_BAND * feat["sig"] * np.sqrt(15)
    inside = r.abs() <= band
    assert y[inside].isna().all()
    assert set(y.dropna().unique()) <= {0.0, 1.0}
    assert (y[r > band] == 1).all() and (y[r < -band] == 0).all()


def test_walk_forward_no_mezcla_dias_y_entrena_solo_con_el_pasado():
    days = list(pd.bdate_range("2026-01-05", periods=100).date)
    folds = T.walk_forward_folds(days, n_folds=4, min_train_days=40)
    assert len(folds) == 4
    tested = []
    for train, test in folds:
        assert not set(train) & set(test)
        assert max(train) < min(test)
        tested += test
    assert tested == days[40:]


def test_wilson_lower_valor_conocido():
    assert T.wilson_lower(60, 100) == pytest.approx(0.502, abs=1e-3)
    assert T.wilson_lower(0, 0) == 0.0


def test_choose_tau_prefiere_el_tramo_confiado_si_acierta_mas():
    rng = np.random.default_rng(0)
    p = rng.uniform(0.3, 0.7, 5000)
    confident = np.abs(p - 0.5) > 0.1
    y = np.where(confident, (p >= 0.5).astype(int), rng.integers(0, 2, 5000))
    tau = T.choose_tau(p, y, min_coverage=0.10)
    assert tau > 0.05
    assert T.confident_stats(p, y, tau)["coverage"] >= 0.10


def test_la_compuerta_exige_superar_al_azar_al_baseline_y_la_cobertura():
    good = {"n": 1000, "coverage": 0.2, "precision": 0.6, "wilson_lo": 0.57}
    assert T.gate(good, {"momentum": 0.52, "majority": None}, 0.10)
    assert not T.gate(good, {"momentum": 0.58}, 0.10)
    assert not T.gate({**good, "coverage": 0.05}, {"momentum": 0.5}, 0.10)
    assert not T.gate({**good, "wilson_lo": 0.49}, {"momentum": 0.4}, 0.10)


def test_con_ruido_puro_la_compuerta_no_da_ventaja():
    ds = T.assemble({"NVDA": _feat(n_days=40, seed=1), "QQQ": _feat(n_days=40, seed=2, ticker="QQQ")})
    model, meta = T.train_horizon(ds, 5, n_folds=2, min_train_days=25,
                                  params={"n_estimators": 40, "max_depth": 3})
    assert meta["has_edge"] is False
    assert 0.0 <= meta["holdout"]["coverage"] <= 1.0
    assert set(meta["baselines"]) == {"majority", "momentum", "reversion"}
    assert set(meta["abs_ret_mean"]) == {"NVDA", "QQQ"}
    proba = model.predict_proba(ds[F.FEATURE_COLS].head(3))
    assert proba.shape == (3, 2)
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_train_xgb_1m_dir.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'train_xgb_1m_dir'`).

- [ ] **Step 3: Implementar `training/train_xgb_1m_dir.py`**

```python
"""
train_xgb_1m_dir.py — Modelo XGBoost de DIRECCIÓN a 5/15/30 min (1 minuto)
=========================================================================
AISLADO de train_xgb_1m.py: no predice el retorno del siguiente minuto (ruido,
~50 % durante semanas de reentrenos) sino si el precio subirá o bajará más allá
de una banda de ruido en h minutos, con probabilidad. Un modelo AGRUPADO por
horizonte (8 tickers líquidos, el ticker como feature categórica).

Validación: walk-forward por días (cada fold entrena con todo lo anterior y
prueba el bloque siguiente). El umbral de confianza τ se elige con los folds
previos y se mide en el último; `has_edge` solo es true si el acierto confiado
supera, con su cota de Wilson, al 50 % y al mejor baseline en las mismas filas.

Uso:
    python training/train_xgb_1m_dir.py --sessions 252
"""

from __future__ import annotations
import os
import sys
import json
import math
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from xgboost import XGBClassifier
from sklearn.metrics import roc_auc_score

sys.path.append(os.path.dirname(__file__))
from features_1m_dir import (  # noqa: E402
    TICKERS, CONTEXT_SYMBOLS, FEATURE_COLS, HISTORY_SESSIONS, build_features,
)
from data_1m import load_bars  # noqa: E402
from news_1m import load_news  # noqa: E402

HORIZONS = (5, 15, 30)
DEAD_BAND = 0.25
N_FOLDS = 6
MIN_TRAIN_DAYS = 60
MIN_COVERAGE = 0.10
TAU_GRID = np.round(np.arange(0.0, 0.2001, 0.005), 3)

ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = ROOT / "api" / "artifacts" / "1m_dir"

XGB_PARAMS = dict(
    n_estimators=600, max_depth=5, learning_rate=0.03, subsample=0.8,
    colsample_bytree=0.7, min_child_weight=50, reg_lambda=5.0,
    objective="binary:logistic", eval_metric="logloss", tree_method="hist",
    enable_categorical=True, max_cat_to_onehot=16, early_stopping_rounds=50,
    n_jobs=-1, random_state=42)


# --------------------------------------------------------------------------- #
# Labels y dataset
# --------------------------------------------------------------------------- #
def make_labels(feat: pd.DataFrame, h: int) -> tuple[pd.Series, pd.Series]:
    """r_h sin cruzar el cierre; y=1/0 fuera de la banda muerta, NaN dentro."""
    fut = feat.groupby("day")["close"].shift(-h)
    r = np.log(fut / feat["close"])
    band = DEAD_BAND * feat["sig"] * np.sqrt(h)
    y = pd.Series(np.nan, index=feat.index)
    y[r > band] = 1.0
    y[r < -band] = 0.0
    return r, y


def assemble(features_by_ticker: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Labels POR ticker (el shift no debe cruzar de un ticker a otro) y concat."""
    frames = []
    for feat in features_by_ticker.values():
        f = feat.copy()
        for h in HORIZONS:
            f[f"r_{h}"], f[f"y_{h}"] = make_labels(f, h)
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


# --------------------------------------------------------------------------- #
# Validación
# --------------------------------------------------------------------------- #
def walk_forward_folds(days, n_folds: int = N_FOLDS,
                       min_train_days: int = MIN_TRAIN_DAYS) -> list[tuple[list, list]]:
    days = sorted(set(days))
    if len(days) < min_train_days + n_folds:
        raise ValueError(f"Pocas sesiones ({len(days)}) para {n_folds} folds "
                         f"con {min_train_days} de entrenamiento mínimo.")
    blocks = np.array_split(np.arange(min_train_days, len(days)), n_folds)
    return [(days[:b[0]], [days[i] for i in b]) for b in blocks]


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / den


def confident_stats(p: np.ndarray, y: np.ndarray, tau: float) -> dict:
    mask = np.abs(p - 0.5) >= tau
    n = int(mask.sum())
    k = int(((p[mask] >= 0.5).astype(int) == y[mask]).sum())
    return {"n": n, "coverage": n / len(p) if len(p) else 0.0,
            "precision": k / n if n else None, "wilson_lo": wilson_lower(k, n)}


def choose_tau(p: np.ndarray, y: np.ndarray, min_coverage: float = MIN_COVERAGE) -> float:
    """τ que maximiza la cota de Wilson del acierto confiado, con cobertura mínima."""
    best_tau, best_lo = 0.0, -1.0
    for tau in TAU_GRID:
        s = confident_stats(p, y, tau)
        if s["coverage"] < min_coverage:
            break           # la cobertura solo baja al subir τ
        if s["wilson_lo"] > best_lo:
            best_tau, best_lo = float(tau), s["wilson_lo"]
    return best_tau


def gate(stats: dict, baseline_accs: dict, min_coverage: float = MIN_COVERAGE) -> bool:
    best = max([a for a in baseline_accs.values() if a is not None], default=0.5)
    return bool(stats["coverage"] >= min_coverage and stats["wilson_lo"] > 0.5
                and stats["wilson_lo"] > best)


def _acc(pred: np.ndarray, y: np.ndarray) -> float | None:
    return float((pred == y).mean()) if len(y) else None


def _baseline_preds(frame: pd.DataFrame, majority: int) -> dict[str, np.ndarray]:
    return {
        "majority": np.full(len(frame), majority),
        "momentum": (frame["ret_15_z"].to_numpy() >= 0).astype(int),
        "reversion": (frame["dist_vwap_z"].to_numpy() < 0).astype(int),
    }


# --------------------------------------------------------------------------- #
# Entrenamiento de un horizonte
# --------------------------------------------------------------------------- #
def train_horizon(ds: pd.DataFrame, h: int, n_folds: int = N_FOLDS,
                  min_train_days: int = MIN_TRAIN_DAYS, params: dict | None = None):
    params = {**XGB_PARAMS, **(params or {})}
    lab = ds[ds[f"y_{h}"].notna()].reset_index(drop=True)
    X, y = lab[FEATURE_COLS], lab[f"y_{h}"].astype(int).to_numpy()
    day = lab["day"]
    folds = walk_forward_folds(day, n_folds, min_train_days)

    oof = np.full(len(lab), np.nan)
    fold_metrics, best_iters = [], []
    for train_days, test_days in folds:
        # Early stopping con el último 10 % de días de TRAIN, nunca con test.
        cut = max(1, int(len(train_days) * 0.9))
        fit = day.isin(train_days[:cut]).to_numpy()
        val = day.isin(train_days[cut:]).to_numpy()
        test = day.isin(test_days).to_numpy()

        model = XGBClassifier(**params)
        model.fit(X[fit], y[fit], eval_set=[(X[val], y[val])], verbose=False)
        best_iters.append(int(model.best_iteration) + 1)
        p = model.predict_proba(X[test])[:, 1]
        oof[test] = p
        fold_metrics.append({
            "test_from": str(test_days[0]), "test_to": str(test_days[-1]),
            "n": int(test.sum()), "acc_all": _acc((p >= 0.5).astype(int), y[test]),
            "auc": float(roc_auc_score(y[test], p)) if len(set(y[test])) == 2 else None,
        })

    last = day.isin(folds[-1][1]).to_numpy()
    prior = ~last & np.isfinite(oof)
    tau = choose_tau(oof[prior], y[prior]) if prior.any() else 0.0

    p_h, y_h = oof[last], y[last]
    holdout = confident_stats(p_h, y_h, tau)
    holdout["acc_all"] = _acc((p_h >= 0.5).astype(int), y_h)
    confident = np.abs(p_h - 0.5) >= tau
    majority = int(y[~last].mean() >= 0.5)
    baselines = {name: {"all": _acc(pred, y_h), "confident": _acc(pred[confident], y_h[confident])}
                 for name, pred in _baseline_preds(lab[last], majority).items()}
    has_edge = gate(holdout, {k: v["confident"] for k, v in baselines.items()})

    scored = np.isfinite(oof)
    hours = lab.loc[scored, "dt_et"].dt.hour.to_numpy()
    hits = ((oof[scored] >= 0.5).astype(int) == y[scored])
    by_hour = {int(hr): float(hits[hours == hr].mean()) for hr in sorted(set(hours))}

    final_params = {**params, "n_estimators": max(20, int(np.median(best_iters))),
                    "early_stopping_rounds": None}
    final = XGBClassifier(**final_params)
    final.fit(X, y, verbose=False)
    importance = sorted(zip(FEATURE_COLS, final.feature_importances_.tolist()),
                        key=lambda kv: kv[1], reverse=True)[:15]

    abs_ret = ds.groupby(ds["ticker"].astype(str))[f"r_{h}"].apply(lambda s: s.abs().mean())

    return final, {
        "tau": tau, "holdout": holdout, "baselines": baselines, "has_edge": has_edge,
        "folds": fold_metrics, "by_hour": by_hour,
        "top_features": [{"feature": f, "importance": v} for f, v in importance],
        "n_estimators": final_params["n_estimators"], "n_labeled": int(len(lab)),
        "abs_ret_mean": {t: float(v) for t, v in abs_ret.items() if np.isfinite(v)},
    }


# --------------------------------------------------------------------------- #
# Reporte y CLI
# --------------------------------------------------------------------------- #
def _clean(obj):
    """NaN → None y tipos numpy → Python: el meta lo lee JavaScript, que no acepta NaN."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        return None if not np.isfinite(obj) else float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _pct(x) -> str:
    return "—" if x is None else f"{x:.1%}"


def format_report(meta: dict) -> str:
    lines = ["# Modelo 1m de dirección — reporte de entrenamiento", "",
             f"Entrenado {meta['trained_at']} · {meta['n_rows']} filas · "
             f"{meta['sessions']} sesiones · tickers {' '.join(meta['tickers'])}", "",
             "| h | acierto total | acierto confiado | cobertura | Wilson 95 % inf. "
             "| mejor baseline (confiado) | has_edge |",
             "|---|---|---|---|---|---|---|"]
    for h, hm in meta["horizons"].items():
        ho = hm["holdout"]
        best = max(((k, v["confident"]) for k, v in hm["baselines"].items()
                    if v["confident"] is not None), key=lambda kv: kv[1], default=("—", None))
        lines.append(f"| {h} min | {_pct(ho['acc_all'])} | {_pct(ho['precision'])} "
                     f"| {_pct(ho['coverage'])} | {_pct(ho['wilson_lo'])} "
                     f"| {best[0]} {_pct(best[1])} | {'sí' if hm['has_edge'] else 'no'} |")
    old = []
    for t in ("NVDA", "QQQ", "SNDK"):
        path = ROOT / "api" / "artifacts" / f"meta_1m_{t}.json"
        if path.exists():
            acc = json.loads(path.read_text()).get("metrics", {}).get("directional_accuracy")
            old.append(f"{t} {_pct(acc)}")
    if old:
        lines += ["", "Modelo 1m actual (signo del siguiente minuto, otra pregunta): " + ", ".join(old)]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=252)
    args = ap.parse_args()
    need = args.sessions + HISTORY_SESSIONS

    print(f"[1/3] Descargando {need} sesiones de 1 min: contexto {CONTEXT_SYMBOLS}...")
    context = {s: load_bars(s, need) for s in CONTEXT_SYMBOLS}
    features = {}
    for t in TICKERS:
        bars = context[t] if t in context else load_bars(t, need)
        news = load_news(t, bars["dt_et"].min().date())
        features[t] = build_features(bars, t, context, news)
        print(f"      {t}: {len(features[t])} filas · {len(news)} noticias")
    ds = assemble(features)

    meta = {"model": "XGBoost-1m-direction",
            "trained_at": dt.datetime.utcnow().isoformat() + "Z",
            "tickers": list(TICKERS), "context": list(CONTEXT_SYMBOLS),
            "feature_cols": FEATURE_COLS, "dead_band": DEAD_BAND,
            "history_sessions": HISTORY_SESSIONS, "sessions": args.sessions,
            "n_rows": int(len(ds)), "horizons": {}}

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    for h in HORIZONS:
        print(f"[2/3] Horizonte {h} min: walk-forward de {N_FOLDS} folds...")
        model, hm = train_horizon(ds, h)
        joblib.dump(model, ARTIFACT_DIR / f"xgb_h{h}.joblib")
        meta["horizons"][str(h)] = hm

    meta = _clean(meta)
    (ARTIFACT_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    report = format_report(meta)
    (ARTIFACT_DIR / "report.md").write_text(report)
    print("[3/3] Artefactos en", ARTIFACT_DIR)
    print(report)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_train_xgb_1m_dir.py -q`
Expected: 6 passed.

- [ ] **Step 5: Suite completa**

Run: `cd api && ../.venv/bin/python -m pytest -q`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add training/train_xgb_1m_dir.py api/tests/test_train_xgb_1m_dir.py
git commit -m "feat(ml): entrenamiento walk-forward del modelo de dirección con compuerta has_edge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Entrenar en CI (workflow de la rama)

**Files:**
- Create: `.github/workflows/train-1m-dir.yml`

**Interfaces:**
- Consumes: `training/train_xgb_1m_dir.py --sessions 252`; secret `POLYGON_API_KEY`.
- Produces: commit `api/artifacts/1m_dir/{xgb_h5,xgb_h15,xgb_h30}.joblib`, `meta.json`, `report.md` en la rama `feat/xgboost-1m-dir`; resumen del reporte en el job.

- [ ] **Step 1: Crear `.github/workflows/train-1m-dir.yml`**

```yaml
name: Train 1m direction model (branch)

# Entrena el modelo de dirección de 1 min desde la rama de desarrollo, sin
# tocar main: los artefactos se commitean en la MISMA rama. Tras el merge, el
# reentreno diario lo hace retrain.yml.
on:
  push:
    branches: [feat/xgboost-1m-dir]
    paths:
      - "training/*_1m*.py"
      - "training/macro_calendar.csv"
      - ".github/workflows/train-1m-dir.yml"
  workflow_dispatch:

concurrency:
  group: train-1m-dir-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  train:
    runs-on: ubuntu-latest
    timeout-minutes: 150
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install -r api/requirements-dev.txt

      - name: Tests
        run: cd api && python -m pytest -q

      - name: Cache 1m bars and news
        uses: actions/cache@v4
        with:
          path: training/.cache_1m
          key: cache-1m-${{ github.run_id }}
          restore-keys: cache-1m-

      - name: Train
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
          # Plan Starter: llamadas ilimitadas. El default de polygon_client (5/min)
          # es el del plan gratuito y haría la descarga de un año eterna.
          POLYGON_MAX_CALLS_PER_MIN: "300"
        run: python training/train_xgb_1m_dir.py --sessions 252

      - name: Report
        run: cat api/artifacts/1m_dir/report.md >> "$GITHUB_STEP_SUMMARY"

      - name: Commit artifacts to this branch
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add api/artifacts/1m_dir
          if git diff --cached --quiet; then echo "Sin cambios."; exit 0; fi
          git commit -m "chore(ml): entrenar el modelo 1m de dirección [skip ci]"
          git pull --rebase --autostash origin "${{ github.ref_name }}" || true
          git push origin "HEAD:${{ github.ref_name }}"
```

- [ ] **Step 2: Commit y push (dispara el entrenamiento)**

```bash
git add .github/workflows/train-1m-dir.yml
git commit -m "ci(ml): entrenar el modelo 1m de dirección desde la rama

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/xgboost-1m-dir
```

- [ ] **Step 3: Seguir la corrida**

Run: `gh run list --workflow train-1m-dir.yml --branch feat/xgboost-1m-dir --limit 1` y luego `gh run watch <id> --exit-status` (en segundo plano).
Expected: tests verdes, entrenamiento completo, commit de artefactos. Si falla, `gh run view <id> --log-failed`, diagnosticar con superpowers:systematic-debugging, corregir y volver a hacer push.

- [ ] **Step 4: Traer los artefactos y revisar el reporte**

```bash
git pull --rebase
cat api/artifacts/1m_dir/report.md
```
**Checkpoint con el usuario:** mostrar la tabla (acierto total, confiado, cobertura, Wilson, baseline, `has_edge`) frente al 48–51 % del modelo actual. Las Tasks 7–10 siguen igual con o sin `has_edge`: la UI dice «sin ventaja demostrada» cuando no la hay.

---

### Task 7: Inferencia (`api/signal_1m.py`)

**Files:**
- Create: `api/signal_1m.py`
- Test: `api/tests/test_signal_1m.py`

**Interfaces:**
- Consumes: `features_1m_dir.{FEATURE_COLS, TICKERS, CONTEXT_SYMBOLS, HISTORY_SESSIONS, BARS_PER_SESSION, build_features}`, `data_1m.fetch_bars`, `news_1m.fetch_news`, `meta.json` de la Task 5.
- Produces: `ARTIFACT_DIR`, `load_models(artifact_dir: Path = ARTIFACT_DIR) -> (dict[int, XGBClassifier], dict)`, `signal_from_features(models, meta, row: DataFrame, ticker: str) -> dict`, `predict_signal(ticker: str) -> dict` con la forma:
  `{"ticker", "as_of", "last_close", "sigma_1m", "momentum_up", "horizons": [{"h", "p_up", "direction", "confident", "available", "tau", "oos_precision", "coverage", "has_edge", "path_close", "dead_band"}], "model_trained_at", "note", "generated_at"}`.

- [ ] **Step 1: Tests que fallan `api/tests/test_signal_1m.py`**

```python
"""Inferencia del modelo de dirección de 1 min."""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pytest
from xgboost import XGBClassifier

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import features_1m_dir as F
import signal_1m
from synth_1m import bars as synth_bars, news as synth_news


@pytest.fixture(scope="module")
def trained():
    ctx = {"SPY": synth_bars(40, seed=11), "QQQ": synth_bars(40, seed=12),
           "SMH": synth_bars(40, seed=13)}
    feat = F.build_features(synth_bars(40, seed=1), "NVDA", ctx,
                            synth_news(60, seed=1, days=60), fomc_days=set())
    y = np.random.default_rng(0).integers(0, 2, len(feat))
    models = {}
    for h in (5, 15, 30):
        m = XGBClassifier(n_estimators=5, max_depth=2, tree_method="hist", enable_categorical=True)
        m.fit(feat[F.FEATURE_COLS], y)
        models[h] = m
    hm = lambda edge: {"tau": 0.02, "has_edge": edge, "abs_ret_mean": {"NVDA": 0.002},
                       "holdout": {"precision": 0.56, "coverage": 0.25}}
    meta = {"feature_cols": F.FEATURE_COLS, "tickers": list(F.TICKERS), "dead_band": 0.25,
            "trained_at": "2026-09-23T00:00:00Z",
            "horizons": {"5": hm(True), "15": hm(False), "30": hm(True)}}
    return models, meta, feat


def test_la_senal_trae_los_tres_horizontes_coherentes(trained):
    models, meta, feat = trained
    row = feat[feat["bar_idx"] == 100].iloc[[-1]]
    out = signal_1m.signal_from_features(models, meta, row, "NVDA")
    assert [h["h"] for h in out["horizons"]] == [5, 15, 30]
    for h in out["horizons"]:
        assert h["direction"] == ("up" if h["p_up"] >= 0.5 else "down")
        assert h["available"] is True
        assert (h["path_close"] > out["last_close"]) == (h["p_up"] > 0.5) or h["p_up"] == 0.5
    assert out["horizons"][1]["has_edge"] is False


def test_cerca_del_cierre_los_horizontes_largos_no_estan_disponibles(trained):
    models, meta, feat = trained
    row = feat[feat["bar_idx"] == 380].iloc[[-1]]          # quedan 9 minutos
    out = signal_1m.signal_from_features(models, meta, row, "NVDA")
    by_h = {h["h"]: h for h in out["horizons"]}
    assert by_h[5]["available"] is True
    assert by_h[15]["available"] is False and by_h[15]["confident"] is False
    assert by_h[30]["available"] is False


def test_load_models_rechaza_features_desalineadas(tmp_path, trained):
    models, meta, _ = trained
    for h, m in models.items():
        joblib.dump(m, tmp_path / f"xgb_h{h}.joblib")
    (tmp_path / "meta.json").write_text(json.dumps({**meta, "feature_cols": F.FEATURE_COLS[::-1]}))
    signal_1m._CACHE.clear()
    with pytest.raises(FileNotFoundError):
        signal_1m.load_models(tmp_path)


def test_load_models_sin_artefactos_da_file_not_found(tmp_path):
    signal_1m._CACHE.clear()
    with pytest.raises(FileNotFoundError):
        signal_1m.load_models(tmp_path)
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_signal_1m.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'signal_1m'`).

- [ ] **Step 3: Implementar `api/signal_1m.py`**

```python
"""
signal_1m.py — Señal de DIRECCIÓN a 5/15/30 min (modelo de 1 minuto)
====================================================================
Calcula las features de la ÚLTIMA barra real con la misma función que el
entrenamiento (features_1m_dir.build_features) sobre HISTORY_SESSIONS sesiones
—la ventana mínima que reproduce exactamente la fila del entrenamiento, bajo
test— y devuelve p(sube) por horizonte, si el modelo está confiado y si ese
horizonte demostró ventaja fuera de muestra (`has_edge`).

`path_close` es un trazo indicativo, no un precio objetivo:
last_close·exp((2p−1)·E|r_h|).
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
from features_1m_dir import (  # noqa: E402
    FEATURE_COLS, TICKERS, CONTEXT_SYMBOLS, HISTORY_SESSIONS, BARS_PER_SESSION, build_features,
)
from data_1m import fetch_bars  # noqa: E402
from news_1m import fetch_news  # noqa: E402

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts" / "1m_dir"
_CACHE: dict = {}

NOTE = ("Dirección a 5/15/30 min con probabilidad. Datos con ~15 min de retraso "
        "(plan Starter). Solo los horizontes con has_edge superaron a los baselines "
        "fuera de muestra; aun así es contexto, no una señal de entrada.")


def load_models(artifact_dir: Path = ARTIFACT_DIR):
    key = str(artifact_dir)
    if key in _CACHE:
        return _CACHE[key]
    meta_path = artifact_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(
            "No hay modelo de dirección de 1 min. Corre el workflow "
            "'Train 1m direction model' o: python training/train_xgb_1m_dir.py")
    meta = json.loads(meta_path.read_text())
    # Mismo blindaje que load_1m_model: un orden de features distinto no falla
    # en XGBoost, solo sirve basura.
    if list(meta.get("feature_cols") or []) != list(FEATURE_COLS):
        raise FileNotFoundError(
            "El modelo de dirección de 1 min se entrenó con otras features; reentrena "
            "antes de servir señales: python training/train_xgb_1m_dir.py")
    models = {int(h): joblib.load(artifact_dir / f"xgb_h{h}.joblib") for h in meta["horizons"]}
    _CACHE[key] = (models, meta)
    return models, meta


def signal_from_features(models: dict, meta: dict, row: pd.DataFrame, ticker: str) -> dict:
    """Núcleo sin red: una fila de build_features → señal por horizonte."""
    t = ticker.upper()
    last_close = float(row["close"].iloc[0])
    sig = float(row["sig"].iloc[0])
    bars_left = BARS_PER_SESSION - 1 - int(row["bar_idx"].iloc[0])
    X = row[FEATURE_COLS]

    horizons = []
    for h in sorted(models):
        hm = meta["horizons"][str(h)]
        p = float(models[h].predict_proba(X)[0, 1])
        available = h <= bars_left
        abs_mean = hm["abs_ret_mean"].get(t) or float(np.median(list(hm["abs_ret_mean"].values())))
        horizons.append({
            "h": h, "p_up": round(p, 4), "direction": "up" if p >= 0.5 else "down",
            # Un horizonte que cae después del cierre no se puede resolver: nunca es confiado.
            "confident": bool(available and abs(p - 0.5) >= hm["tau"]),
            "available": bool(available), "tau": hm["tau"],
            "oos_precision": hm["holdout"]["precision"], "coverage": hm["holdout"]["coverage"],
            "has_edge": bool(hm["has_edge"]),
            "path_close": round(last_close * float(np.exp((2 * p - 1) * abs_mean)), 4),
            "dead_band": float(meta["dead_band"] * sig * np.sqrt(h)),
        })

    return {
        "ticker": t, "as_of": pd.Timestamp(row["dt_et"].iloc[0]).isoformat(),
        "last_close": round(last_close, 4), "sigma_1m": sig,
        "momentum_up": bool(row["ret_15_z"].iloc[0] >= 0),
        "horizons": horizons, "model_trained_at": meta.get("trained_at"), "note": NOTE,
    }


def predict_signal(ticker: str) -> dict:
    t = ticker.upper()
    models, meta = load_models()
    if t not in meta.get("tickers", TICKERS):
        raise FileNotFoundError(f"{t} no está entre los tickers del modelo de dirección de 1 min.")

    end = dt.date.today()
    start = end - dt.timedelta(days=int(HISTORY_SESSIONS * 1.6) + 7)
    bars = {s: fetch_bars(s, start, end) for s in {t, *CONTEXT_SYMBOLS}}
    news = fetch_news(t, start)

    feat = build_features(bars[t], t, bars, news)
    if feat.empty:
        raise ValueError(f"Sin historia suficiente de 1 min para {t}.")
    out = signal_from_features(models, meta, feat.iloc[[-1]], t)
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    return out
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_signal_1m.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/signal_1m.py api/tests/test_signal_1m.py
git commit -m "feat(api): inferencia de la señal de dirección de 1 min

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Registro en vivo + endpoints

**Files:**
- Create: `supabase/signals_1m.sql`
- Create: `api/signal_1m_store.py`
- Modify: `api/main.py` (imports junto a `from intraday_1m import ...`; endpoints después de `/predict-1m`)
- Test: `api/tests/test_signal_1m_store.py`

**Interfaces:**
- Consumes: la salida de `predict_signal` (Task 7), `data_1m.fetch_bars`.
- Produces: `signal_1m_store.enabled() -> bool`, `save_signal(sig: dict) -> int`, `get_signals(ticker, since_iso) -> list[dict]`, `score_signals(rows, bars) -> {"n_signals", "horizons": {"5": {"resolved", "pending", "flat_share", "acc_all", "acc_confident", "coverage", "acc_momentum"}}}`. Endpoints `GET /signal-1m?ticker=`, `GET /signal-1m-score?ticker=&days=5`, `GET /models-1m-dir`.

- [ ] **Step 1: Crear `supabase/signals_1m.sql`**

```sql
-- =====================================================================
-- Señales del modelo de dirección de 1 min (api/signal_1m_store.py)
-- Ejecuta en: Supabase → SQL Editor → New query
-- =====================================================================
create table if not exists signals_1m (
    id           bigint generated always as identity primary key,
    ticker       text        not null,
    as_of        timestamptz not null,       -- inicio de la última barra real
    h            int         not null,       -- horizonte en minutos
    p_up         numeric     not null,
    confident    boolean     not null,
    has_edge     boolean     not null,
    anchor_close numeric     not null,
    dead_band    numeric     not null,       -- |r| por debajo = "plano"
    momentum_up  boolean,                    -- baseline de momentum en ese instante
    created_at   timestamptz not null default now(),
    unique (ticker, as_of, h)
);

create index if not exists idx_signals_1m_ticker_asof on signals_1m (ticker, as_of desc);

-- Solo el backend (service key) escribe y lee.
alter table signals_1m enable row level security;
```

- [ ] **Step 2: Tests que fallan `api/tests/test_signal_1m_store.py`**

```python
"""Scorer en vivo de la señal de dirección."""
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import signal_1m_store as store


def _bars(closes: dict) -> pd.DataFrame:
    return pd.DataFrame({"dt_et": [pd.Timestamp(k, tz="America/New_York") for k in closes],
                         "close": list(closes.values())})


def _row(as_of, p, confident, mom=True, h=5):
    return {"ticker": "NVDA", "as_of": pd.Timestamp(as_of, tz="America/New_York").isoformat(),
            "h": h, "p_up": p, "confident": confident, "anchor_close": 100.0,
            "dead_band": 0.001, "momentum_up": mom}


def test_score_resuelve_acierta_plano_y_pendiente():
    bars = _bars({"2026-09-22 10:05": 100.5,    # sube: acierta el p=0.6
                  "2026-09-22 10:06": 99.0,     # baja: falla el p=0.7
                  "2026-09-22 10:07": 100.05})  # plano (dentro de la banda)
    rows = [_row("2026-09-22 10:00", 0.6, True),
            _row("2026-09-22 10:01", 0.7, False, mom=False),
            _row("2026-09-22 10:02", 0.4, True),
            _row("2026-09-22 15:58", 0.6, True)]   # su +5 no existe todavía
    out = store.score_signals(rows, bars)
    s = out["horizons"]["5"]
    assert out["n_signals"] == 4
    assert s["resolved"] == 3 and s["pending"] == 1
    assert s["flat_share"] == 1 / 3
    assert s["acc_all"] == 0.5            # 1 de 2 no planas
    assert s["acc_confident"] == 1.0      # la única confiada no plana acertó
    assert s["coverage"] == 0.5
    assert s["acc_momentum"] == 1.0       # momentum: sube acierta, baja acierta


def test_score_sin_filas():
    assert store.score_signals([], _bars({})) == {"n_signals": 0, "horizons": {}}


def test_save_signal_sin_supabase_es_noop(monkeypatch):
    monkeypatch.setattr(store, "_ENABLED", False)
    assert store.save_signal({"ticker": "NVDA", "horizons": []}) == 0
```

- [ ] **Step 3: Ejecutar y ver que fallan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_signal_1m_store.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'signal_1m_store'`).

- [ ] **Step 4: Implementar `api/signal_1m_store.py`**

```python
"""
signal_1m_store.py — Registro en Supabase de las señales de dirección de 1 min
=============================================================================
Cada respuesta de /signal-1m se guarda (una fila por horizonte disponible) para
medir el acierto REAL, no solo el del backtest. El polling del Lab repite la
misma última barra muchas veces: la clave única (ticker, as_of, h) las colapsa.
No-op si Supabase no está configurado, igual que intraday_store.py.
"""

from __future__ import annotations
import os

import numpy as np
import pandas as pd
import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)


def enabled() -> bool:
    return _ENABLED


def _h(prefer: str | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    return h


def save_signal(sig: dict) -> int:
    if not _ENABLED:
        return 0
    rows = [{"ticker": sig["ticker"], "as_of": sig["as_of"], "h": h["h"], "p_up": h["p_up"],
             "confident": h["confident"], "has_edge": h["has_edge"],
             "anchor_close": sig["last_close"], "dead_band": h["dead_band"],
             "momentum_up": sig.get("momentum_up")}
            for h in sig["horizons"] if h["available"]]
    if not rows:
        return 0
    r = requests.post(f"{SUPABASE_URL}/rest/v1/signals_1m?on_conflict=ticker,as_of,h",
                      headers=_h("resolution=ignore-duplicates,return=minimal"),
                      json=rows, timeout=15)
    r.raise_for_status()
    return len(rows)


def get_signals(ticker: str, since_iso: str) -> list[dict]:
    if not _ENABLED:
        return []
    r = requests.get(f"{SUPABASE_URL}/rest/v1/signals_1m", headers=_h(), timeout=20, params={
        "ticker": f"eq.{ticker.upper()}", "as_of": f"gte.{since_iso}",
        "order": "as_of.asc", "limit": "20000",
        "select": "ticker,as_of,h,p_up,confident,has_edge,anchor_close,dead_band,momentum_up"})
    r.raise_for_status()
    return r.json()


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def score_signals(rows: list[dict], bars: pd.DataFrame) -> dict:
    """Resuelve cada señal con el cierre real de la barra as_of + h.
    'Plana' = |r| dentro de la banda muerta: no cuenta ni como acierto ni como fallo."""
    if not rows:
        return {"n_signals": 0, "horizons": {}}
    # Claves en UTC: Supabase devuelve `as_of` en +00:00 y las barras vienen en ET.
    close_at = {pd.Timestamp(t).tz_convert("UTC"): float(c)
                for t, c in zip(bars["dt_et"], bars["close"])}
    by_h: dict[int, dict] = {}
    for row in rows:
        h = int(row["h"])
        s = by_h.setdefault(h, {"resolved": 0, "pending": 0, "flat": 0, "hit": 0, "decided": 0,
                                "conf": 0, "conf_hit": 0, "mom_hit": 0, "mom_n": 0})
        target = (pd.Timestamp(row["as_of"]) + pd.Timedelta(minutes=h)).tz_convert("UTC")
        if target not in close_at:
            s["pending"] += 1
            continue
        s["resolved"] += 1
        r = float(np.log(close_at[target] / float(row["anchor_close"])))
        if abs(r) <= float(row["dead_band"]):
            s["flat"] += 1
            continue
        up = r > 0
        hit = (float(row["p_up"]) >= 0.5) == up
        s["decided"] += 1
        s["hit"] += hit
        if row["confident"]:
            s["conf"] += 1
            s["conf_hit"] += hit
        if row.get("momentum_up") is not None:
            s["mom_n"] += 1
            s["mom_hit"] += bool(row["momentum_up"]) == up

    return {"n_signals": len(rows), "horizons": {str(h): {
        "resolved": s["resolved"], "pending": s["pending"],
        "flat_share": _ratio(s["flat"], s["resolved"]),
        "acc_all": _ratio(s["hit"], s["decided"]),
        "acc_confident": _ratio(s["conf_hit"], s["conf"]),
        "coverage": _ratio(s["conf"], s["decided"]),
        "acc_momentum": _ratio(s["mom_hit"], s["mom_n"]),
    } for h, s in sorted(by_h.items())}}
```

- [ ] **Step 5: Ejecutar y ver que pasan**

Run: `cd api && ../.venv/bin/python -m pytest tests/test_signal_1m_store.py -q`
Expected: 3 passed.

- [ ] **Step 6: Endpoints en `api/main.py`**

Después de la línea `from intraday_1m import predict_next_minutes, DEFAULT_HORIZON  # noqa: E402  ← modelo de 1 min` añadir:
```python
from signal_1m import predict_signal, load_models as load_signal_models  # noqa: E402  ← dirección 1m
import signal_1m_store                              # noqa: E402  ← acierto en vivo (Supabase)
from data_1m import fetch_bars as fetch_1m_bars     # noqa: E402
```
Después de la función `predict_1m` añadir:
```python
@app.get("/models-1m-dir")
def list_models_1m_dir():
    """Tickers que sirve el modelo agrupado de dirección de 1 min."""
    try:
        _, meta = load_signal_models()
        return {"available": meta.get("tickers", [])}
    except FileNotFoundError:
        return {"available": []}


@app.get("/signal-1m")
def signal_1m(ticker: str):
    """Dirección a 5/15/30 min con probabilidad y confianza (modelo agrupado)."""
    try:
        out = predict_signal(ticker)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))
    # Registrar no debe tumbar la señal: si Supabase falla, se avisa en la respuesta.
    if signal_1m_store.enabled():
        try:
            signal_1m_store.save_signal(out)
        except Exception as e:
            out["store_error"] = str(e)[:200]
    return out


@app.get("/signal-1m-score")
def signal_1m_score(ticker: str, days: int = 5):
    """Acierto EN VIVO de las señales guardadas de los últimos `days` días."""
    if not signal_1m_store.enabled():
        return {"n_signals": 0, "horizons": {}, "note": "Supabase no configurado"}
    try:
        since = dt.datetime.utcnow() - dt.timedelta(days=max(1, min(days, 30)))
        rows = signal_1m_store.get_signals(ticker, since.isoformat() + "Z")
        if not rows:
            return {"n_signals": 0, "horizons": {}}
        first = pd.Timestamp(rows[0]["as_of"]).tz_convert("America/New_York").date()
        bars = fetch_1m_bars(ticker, first, dt.date.today())
        return signal_1m_store.score_signals(rows, bars)
    except Exception as e:
        raise HTTPException(400, str(e))
```

- [ ] **Step 7: Comprobar que la API arranca y que `/models` no lista los artefactos nuevos**

```bash
cd api && ../.venv/bin/python -c "
from fastapi.testclient import TestClient
import main
c = TestClient(main.app)
print(c.get('/models-1m-dir').json())
print('1m_dir' in str(c.get('/models').json()), 'dir' in str(c.get('/models-1m').json()))
"
```
Expected: `{'available': ['NVDA', ...]}` (con los artefactos de la Task 6) y `False False`. `fastapi.testclient` requiere `httpx`; si falta: `uv pip install --python ../.venv/bin/python httpx` (solo local, no va a requirements).

- [ ] **Step 8: Suite completa y commit**

Run: `cd api && ../.venv/bin/python -m pytest -q` → verde.
```bash
git add supabase/signals_1m.sql api/signal_1m_store.py api/main.py api/tests/test_signal_1m_store.py
git commit -m "feat(api): /signal-1m con registro en vivo y /signal-1m-score

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Overlay `signal1m` en el Trading Lab

**Files:**
- Modify: `types/trading.ts` (tipos nuevos y `TickerCapabilities`)
- Modify: `lib/trading/mlApi.ts`, `lib/trading/capabilities.ts`
- Modify: `lib/trading/overlays/registry.ts`, `lib/trading/overlays/remoteData.ts`, `lib/trading/overlays/paint.ts`
- Modify: `app/api/ml/[...path]/route.ts`
- Modify: `components/trading/ChartPanel.tsx`
- Create: `lib/trading/overlays/signal1mLegend.ts`
- Test: `lib/trading/overlays/signal1mLegend.test.ts`

**Interfaces:**
- Consumes: respuestas de `/signal-1m`, `/signal-1m-score`, `/models-1m-dir` (Task 8).
- Produces: `signalLegend(bundle: OneMinuteSignalBundle): string`; overlay id `signal1m`, source `signal1m`, capability `signal1m`.

- [ ] **Step 1: Tipos en `types/trading.ts`**

Después de `OneMinutePrediction` añadir:
```ts
/** GET /signal-1m — dirección a 5/15/30 min con probabilidad (modelo agrupado). */
export type OneMinuteSignalHorizon = {
  h: number;
  p_up: number;
  direction: 'up' | 'down';
  /** |p − 0.5| ≥ tau y el horizonte cabe antes del cierre. */
  confident: boolean;
  available: boolean;
  tau: number;
  oos_precision: number | null;
  coverage: number | null;
  /** Superó a los baselines fuera de muestra. Si no, la probabilidad es solo contexto. */
  has_edge: boolean;
  path_close: number;
  dead_band: number;
};

export type OneMinuteSignal = {
  ticker: string;
  /** ISO con offset ET; ~15 min por detrás de ahora en el plan Starter. */
  as_of: string;
  last_close: number;
  sigma_1m: number;
  momentum_up: boolean;
  horizons: OneMinuteSignalHorizon[];
  model_trained_at: string | null;
  generated_at: string;
  note: string;
  store_error?: string;
};

/** GET /signal-1m-score — acierto EN VIVO de las señales guardadas. */
export type OneMinuteSignalScore = {
  n_signals: number;
  horizons: Record<
    string,
    {
      resolved: number;
      pending: number;
      flat_share: number | null;
      acc_all: number | null;
      acc_confident: number | null;
      coverage: number | null;
      acc_momentum: number | null;
    }
  >;
};

export type OneMinuteSignalBundle = { signal: OneMinuteSignal; score: OneMinuteSignalScore | null };
```
Y en `TickerCapabilities` añadir `signal1m: boolean;` tras `oneMinute: boolean;`.

- [ ] **Step 2: Test que falla `lib/trading/overlays/signal1mLegend.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { signalLegend } from './signal1mLegend';
import type { OneMinuteSignalBundle, OneMinuteSignalHorizon } from '@/types/trading';

const horizon = (over: Partial<OneMinuteSignalHorizon>): OneMinuteSignalHorizon => ({
  h: 5, p_up: 0.58, direction: 'up', confident: true, available: true, tau: 0.05,
  oos_precision: 0.56, coverage: 0.24, has_edge: true, path_close: 100.1, dead_band: 0.0004,
  ...over,
});

const bundle = (horizons: OneMinuteSignalHorizon[], score: OneMinuteSignalBundle['score'] = null): OneMinuteSignalBundle => ({
  signal: {
    ticker: 'NVDA', as_of: '2026-09-22T10:42:00-04:00', last_close: 100, sigma_1m: 0.0008,
    momentum_up: true, horizons, model_trained_at: null, generated_at: '', note: '',
  },
  score,
});

describe('signalLegend', () => {
  it('muestra hora ET, dirección, probabilidad y lectura por horizonte', () => {
    const text = signalLegend(bundle([
      horizon({}),
      horizon({ h: 15, p_up: 0.46, direction: 'down', confident: false }),
      horizon({ h: 30, available: false, confident: false }),
    ]));
    expect(text).toContain('10:42 ET');
    expect(text).toContain('5m ↑ 58% (confiado · 56% fuera de muestra)');
    expect(text).toContain('15m ↓ 54% (se abstiene)');
    expect(text).toContain('30m — fuera de sesión');
    expect(text).toContain('~15 min de retraso');
  });

  it('sin ventaja demostrada lo dice aunque esté confiado', () => {
    const text = signalLegend(bundle([horizon({ has_edge: false })]));
    expect(text).toContain('sin ventaja demostrada');
    expect(text).not.toContain('confiado ·');
  });

  it('resume el acierto en vivo o avisa de que no lo hay', () => {
    expect(signalLegend(bundle([horizon({})]))).toContain('sin histórico en vivo');
    const score = {
      n_signals: 10,
      horizons: { '5': { resolved: 120, pending: 2, flat_share: 0.3, acc_all: 0.52, acc_confident: 0.57, coverage: 0.25, acc_momentum: 0.5 } },
    };
    expect(signalLegend(bundle([horizon({})], score))).toContain('en vivo 5m: 57% confiado · 52% total (n=120)');
  });
});
```

- [ ] **Step 3: Ejecutar y ver que falla**

Run: `npx vitest run lib/trading/overlays/signal1mLegend.test.ts`
Expected: FAIL (no existe `./signal1mLegend`).

- [ ] **Step 4: Implementar `lib/trading/overlays/signal1mLegend.ts`**

```ts
import type { OneMinuteSignalBundle, OneMinuteSignalHorizon, OneMinuteSignalScore } from '@/types/trading';

/**
 * Leyenda de la señal de dirección de 1 min.
 *
 * Lo que cambia cómo se lee cada número va en el propio texto: si el horizonte
 * demostró ventaja fuera de muestra, si el modelo se abstiene y cuánto acierta
 * en vivo. Una probabilidad sin eso invita a leer certeza donde no la hay.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

function horizonText(h: OneMinuteSignalHorizon): string {
  if (!h.available) return `${h.h}m — fuera de sesión`;
  const arrow = h.direction === 'up' ? '↑' : '↓';
  const prob = pct(h.direction === 'up' ? h.p_up : 1 - h.p_up);
  const reading = !h.has_edge
    ? 'sin ventaja demostrada'
    : h.confident
      ? `confiado · ${h.oos_precision != null ? pct(h.oos_precision) : '—'} fuera de muestra`
      : 'se abstiene';
  return `${h.h}m ${arrow} ${prob} (${reading})`;
}

function liveText(score: OneMinuteSignalScore | null): string {
  const parts = Object.entries(score?.horizons ?? {})
    .filter(([, s]) => s.resolved > 0)
    .map(([h, s]) => {
      const conf = s.acc_confident != null ? `${pct(s.acc_confident)} confiado` : 'sin confiadas';
      const all = s.acc_all != null ? `${pct(s.acc_all)} total` : '—';
      return `${h}m: ${conf} · ${all} (n=${s.resolved})`;
    });
  return parts.length ? `en vivo ${parts.join(', ')}` : 'sin histórico en vivo';
}

export function signalLegend({ signal, score }: OneMinuteSignalBundle): string {
  const hora = new Date(signal.as_of).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return (
    `Señal ML 1m · última barra ${hora} ET · ${signal.horizons.map(horizonText).join(' · ')} · ` +
    `${liveText(score)} — datos con ~15 min de retraso (plan Starter); contexto, no señal de entrada`
  );
}
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run: `npx vitest run lib/trading/overlays/signal1mLegend.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Cableado de datos**

`app/api/ml/[...path]/route.ts`, en `ENDPOINTS`: tras `'models-1m': 300,` añadir `'models-1m-dir': 300,`; tras `'predict-1m': 30,` añadir:
```ts
  'signal-1m': 30,
  // El acierto en vivo cambia a medida que se resuelven señales, pero no por segundos.
  'signal-1m-score': 300,
```

`lib/trading/mlApi.ts`: importar `OneMinuteSignal, OneMinuteSignalScore` en el bloque de tipos y, tras `fetchOneMinuteCurve`, añadir:
```ts
export const fetchOneMinuteSignal = (ticker: string) => get<OneMinuteSignal>('signal-1m', { ticker });

export const fetchOneMinuteSignalScore = (ticker: string, days = 5) =>
  get<OneMinuteSignalScore>('signal-1m-score', { ticker, days });
```
y ampliar la unión de `fetchTrainedTickers` con `| 'models-1m-dir'`.

`lib/trading/capabilities.ts`: añadir `signal1m: Set<string>;` a `CapabilityMap`, `signal1m: new Set(),` a `EMPTY`, un sexto `fetchTrainedTickers('models-1m-dir')` en el `Promise.all` (desestructurado como `signal1m`), `signal1m: toSet(signal1m),` en `cached` y `signal1m: map.signal1m.has(symbol),` en `capabilitiesFor`. Actualizar el comentario «The five /models* endpoints» a «The six».

Run: `grep -rn "oneMinute: " lib components app types --include=*.ts --include=*.tsx` y añadir `signal1m` en cualquier otro literal de `TickerCapabilities` o `CapabilityMap` que aparezca.

`lib/trading/overlays/registry.ts`: añadir `| 'signal1m'` a `OverlaySource` y a `OverlayId`; en `OVERLAYS`, tras `intraday1m`:
```ts
  { id: 'signal1m', label: 'Señal ML 1m (5/15/30 min)', group: 'Curvas predictivas', source: 'signal1m', timeframes: ['1m', '5m'], capability: 'signal1m', hint: 'Probabilidad de que el precio suba o baje en 5, 15 y 30 minutos, con abstención cuando el modelo no está seguro y el acierto medido en vivo. Datos con ~15 min de retraso' },
```
y `signal1m: false,` en `DEFAULT_OVERLAYS`.

`lib/trading/overlays/paint.ts`: en `LAYER_IDS` añadir `signal1m: [],` (solo leyenda, no pinta capas).

`lib/trading/overlays/remoteData.ts`: importar `fetchOneMinuteSignal, fetchOneMinuteSignalScore` y el tipo `OneMinuteSignalBundle`; añadir `signal1m?: MlResult<OneMinuteSignalBundle>;` a `RemoteOverlayData`; en el `switch`:
```ts
      case 'signal1m':
        return ['signal1m', await loadSignalBundle(ticker)];
```
y al final del archivo:
```ts
/** Señal + acierto en vivo en un solo resultado: sin señal no hay leyenda; sin score, sí. */
async function loadSignalBundle(ticker: string): Promise<MlResult<OneMinuteSignalBundle>> {
  const [signal, score] = await Promise.all([fetchOneMinuteSignal(ticker), fetchOneMinuteSignalScore(ticker)]);
  if (!signal.ok) return signal;
  return { ok: true, data: { signal: signal.data, score: score.ok ? score.data : null } };
}
```

- [ ] **Step 7: Leyenda en `components/trading/ChartPanel.tsx`**

Importar `import { signalLegend } from '@/lib/trading/overlays/signal1mLegend';`. Tras el bloque `oneMinuteLegend` añadir:
```tsx
  /** Señal de dirección de 1 min: la lectura (ventaja, abstención, acierto en vivo) va en el texto. */
  const signalLegendText = (() => {
    const result = remote.signal1m;
    if (!overlays.signal1m || !allowed('signal1m') || !result?.ok) return '';
    return signalLegend(result.data);
  })();
```
y tras `{oneMinuteLegend && <p className="chart-panel__onemin">{oneMinuteLegend}</p>}`:
```tsx
      {signalLegendText && <p className="chart-panel__onemin">{signalLegendText}</p>}
```

- [ ] **Step 8: Verificar tipos y tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos; todos los tests verdes.

- [ ] **Step 9: Commit**

```bash
git add types/trading.ts lib/trading components/trading/ChartPanel.tsx "app/api/ml/[...path]/route.ts"
git commit -m "feat(trading-lab): overlay de la señal de dirección de 1 min con acierto en vivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Reentreno diario y documentación

**Files:**
- Modify: `.github/workflows/retrain.yml`
- Modify: `README.md`

- [ ] **Step 1: Paso en `retrain.yml`**

Tras el paso `Train 1-minute — tickers líquidos` y antes de `Verify artifacts exist`, añadir:
```yaml
      - name: Cache 1m bars and news
        uses: actions/cache@v4
        with:
          path: training/.cache_1m
          key: cache-1m-${{ github.run_id }}
          restore-keys: cache-1m-

      # ------------------------------------------------------------------- #
      # DIRECCIÓN 1m (5/15/30 min) — modelo agrupado, 1 año, walk-forward.
      # Aislado: si falla, no afecta a los modelos anteriores.
      # ------------------------------------------------------------------- #
      - name: Train 1m direction (pooled)
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
          POLYGON_MAX_CALLS_PER_MIN: "300"   # plan Starter: ilimitado
        run: |
          python training/train_xgb_1m_dir.py --sessions 252 \
            || echo "::warning::train_xgb_1m_dir falló"
```
El `find api/artifacts ...` del paso de commit ya es recursivo, así que recoge `api/artifacts/1m_dir/`. Cambiar su filtro para incluir el reporte: `\( -name '*.joblib' -o -name '*.json' -o -name 'report.md' \)`.

- [ ] **Step 2: README**

Leer la sección del modelo de 1 minuto (`grep -n "1 min" README.md`) y añadir justo después una subsección:
```markdown
### Dirección a 5/15/30 min (modelo agrupado de 1 minuto)

El modelo de 1 min original predice el retorno del siguiente minuto y acierta ~50 %: ruido. Este
responde otra pregunta —¿sube o baja más allá del ruido en 5, 15 y 30 min?— con probabilidad, y se
abstiene cuando no está seguro.

- Entrenamiento: `python training/train_xgb_1m_dir.py --sessions 252` (8 tickers + SPY/QQQ/SMH,
  noticias de Polygon, días FOMC). Walk-forward por días; reporte en `api/artifacts/1m_dir/report.md`.
- `has_edge`: solo es `true` si el acierto confiado supera al 50 % y al mejor baseline (momentum,
  reversión al VWAP, clase mayoritaria) con su cota de Wilson del 95 %.
- API: `GET /signal-1m?ticker=`, `GET /signal-1m-score?ticker=&days=` (acierto en vivo; requiere
  `supabase/signals_1m.sql`), `GET /models-1m-dir`.
- Calendario: añadir las fechas FOMC del año siguiente a `training/macro_calendar.csv` cada diciembre.
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/retrain.yml README.md
git commit -m "chore(ml): reentreno diario del modelo 1m de dirección y documentación

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verificación final

- [ ] **Step 1: Tests**

Run: `cd api && ../.venv/bin/python -m pytest -q` y `npx vitest run` y `npx tsc --noEmit`.
Expected: todo verde (incluidos `test_intraday_1m.py` y `test_train_xgb_1m.py`, intactos).

- [ ] **Step 2: API en local con los artefactos reales (requiere `POLYGON_API_KEY`)**

Si hay clave en el entorno: `cd api && POLYGON_MAX_CALLS_PER_MIN=300 ../.venv/bin/uvicorn main:app --port 8000` y `curl -s 'localhost:8000/signal-1m?ticker=NVDA' | python -m json.tool`. Expected: tres horizontes con `p_up`, `confident`, `has_edge`. Y `curl -s 'localhost:8000/predict-1m?ticker=NVDA'` sigue respondiendo como antes. Si no hay clave local, dejarlo anotado y verificarlo tras el deploy en Render.

- [ ] **Step 3: Frontend**

`npm run dev` → `/trading`, NVDA, 1m, activar «Señal ML 1m»: la leyenda muestra hora ET, los tres horizontes y «sin histórico en vivo» hasta que haya señales resueltas.

- [ ] **Step 4: Pendientes del usuario (no los hace el agente sin permiso)**

- Ejecutar `supabase/signals_1m.sql` en Supabase.
- Merge de la rama a `main` (PR) para que Render despliegue y `retrain.yml` reentrene a diario.
- Tras unas sesiones: `/signal-1m-score` para contrastar el acierto en vivo con el del reporte. El modelo 1m original se retira solo si el vivo confirma el backtest.
