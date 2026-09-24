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
