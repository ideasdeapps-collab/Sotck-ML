"""Features del modelo de dirección de 1 min.

Los dos tests que importan: (1) sin fuga — recortar los datos en un punto no
cambia ninguna fila anterior a ese punto (test_truncar_en_distintos_puntos_...,
más fuerte que un simple desplazamiento de nivel: ver fix round 1 / F4 en
task-4-fix1-findings.md); (2) la ventana corta de la inferencia
(HISTORY_SESSIONS) reproduce exactamente la fila del entrenamiento, incluso con
un shock, barras caídas y un medio día de por medio
(test_ventana_de_inferencia_con_shock_medio_dia_y_barras_caidas).
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

N_DAYS = 92  # > HISTORY_SESSIONS (91): deja margen (mínimo, por runtime) para
             # que la ventana corta de inferencia (test_la_ventana_de_inferencia_...)
             # recorte de verdad.
# Dos fixtures grandes, cada una del tamaño mínimo que necesita su test (F4/F5
# en task-4-fix1-findings.md), para mantener el runtime del archivo bajo control:
# LEAK_DAYS para la equivalencia por truncamiento (el shock puede caer en
# cualquier lado, no depende de HISTORY_SESSIONS) y BIG_DAYS para la ventana de
# inferencia con casos límite (sí depende de HISTORY_SESSIONS + margen).
LEAK_DAYS = 55
BIG_DAYS = 123
DROP_FRAC = 0.02


@pytest.fixture(scope="module")
def data():
    ctx = {"SPY": synth_bars(N_DAYS, seed=11), "QQQ": synth_bars(N_DAYS, seed=12),
           "SMH": synth_bars(N_DAYS, seed=13)}
    return synth_bars(N_DAYS, seed=1), ctx, synth_news(200, seed=2, days=N_DAYS * 1.5)


def _drop_bars(df, seed, frac=DROP_FRAC):
    """Tira una fracción aleatoria (determinista) de barras — para que ffill
    (barra de contexto ausente) tenga algo que rellenar de verdad."""
    rng = np.random.default_rng(seed)
    keep = rng.random(len(df)) > frac
    return df[keep].reset_index(drop=True)


def _make_half_day(df, half_day, keep_bars=210):
    """Trunca `half_day` a sus primeros `keep_bars` minutos (medio día real)."""
    days = df["dt_et"].dt.date
    idx_in_day = df.groupby(days).cumcount()
    drop = (days == half_day) & (idx_in_day >= keep_bars)
    return df[~drop].reset_index(drop=True)


def _shock(bars, shock_day, factor=1.2):
    d = bars["dt_et"].dt.date
    bars = bars.copy()
    for col in ("open", "high", "low", "close", "vw"):
        bars.loc[d >= shock_day, col] *= factor
    return bars


@pytest.fixture(scope="module")
def leak_data():
    """bars/ctx/news (F4, equivalencia por truncamiento): un shock a mitad de
    camino (para que event_day/days_since_event sean no triviales y para tener
    un "día siguiente al shock" barato de recortar) y barras caídas al azar en
    el propio ticker y en cada símbolo de contexto (para que ffill vs bfill
    importe de verdad). No depende de HISTORY_SESSIONS: eso es F5/big_data."""
    bars = synth_bars(LEAK_DAYS, seed=301)
    ctx = {"SPY": synth_bars(LEAK_DAYS, seed=311), "QQQ": synth_bars(LEAK_DAYS, seed=312),
           "SMH": synth_bars(LEAK_DAYS, seed=313)}
    news = synth_news(200, seed=302, days=LEAK_DAYS * 1.5)

    days = sorted(bars["dt_et"].dt.date.unique())
    shock_day = days[25]

    bars = _shock(bars, shock_day)
    bars = _drop_bars(bars, seed=401)
    ctx = {k: _drop_bars(v, seed=410 + i) for i, (k, v) in enumerate(ctx.items())}

    return bars, ctx, news, shock_day


@pytest.fixture(scope="module")
def big_data():
    """bars/ctx/news (F5, ventana de inferencia con casos límite): un shock (gap
    ×1.2) EXACTAMENTE 21 sesiones antes del último día (para que
    days_since_event valga 21 tanto en la ventana corta como en la completa),
    un medio día dentro de la ventana corta de HISTORY_SESSIONS, y barras
    caídas al azar en el propio ticker y en cada símbolo de contexto."""
    bars = synth_bars(BIG_DAYS, seed=101)
    ctx = {"SPY": synth_bars(BIG_DAYS, seed=111), "QQQ": synth_bars(BIG_DAYS, seed=112),
           "SMH": synth_bars(BIG_DAYS, seed=113)}
    news = synth_news(400, seed=102, days=BIG_DAYS * 1.5)

    days = sorted(bars["dt_et"].dt.date.unique())
    keep_start = BIG_DAYS - F.HISTORY_SESSIONS
    shock_day = days[-22]                # 21 sesiones antes del último día
    half_day = days[keep_start + 5]      # dentro de la ventana corta, lejos del shock

    bars = _shock(bars, shock_day)
    bars = _make_half_day(bars, half_day)
    bars = _drop_bars(bars, seed=201)
    ctx = {k: _drop_bars(v, seed=210 + i) for i, (k, v) in enumerate(ctx.items())}

    return bars, ctx, news, shock_day, half_day


def _build(bars, ctx, news, **kw):
    return F.build_features(bars, "NVDA", ctx, news, fomc_days=set(), **kw)


def test_columnas_y_orden(data):
    out = _build(*data)
    assert len(F.FEATURE_COLS) == 41 and len(set(F.FEATURE_COLS)) == 41
    assert list(out.columns) == F.KEEP_COLS + F.FEATURE_COLS
    assert out["sig"].notna().all()
    assert list(out["ticker"].cat.categories) == list(F.TICKERS)


def test_truncar_en_distintos_puntos_reproduce_las_filas_pasadas(leak_data):
    """El test sin-fuga fuerte (sustituye a los dos anteriores por desplazamiento
    de nivel, que este supera estrictamente — ver F4 en task-4-fix1-findings.md:
    un desplazamiento uniforme de nivel NUNCA quita barras y los retornos
    logarítmicos son invariantes a él, así que no atrapa fugas donde el código
    mira "si existe una fila futura" en vez de su valor). Recorta datos de
    verdad —barras propias, de CADA símbolo de contexto, y noticias con
    ts <= corte+1min— en varios puntos (primera barra del día, mitad de sesión,
    última barra del día, día siguiente al shock) y exige que las filas con
    dt_et <= corte salgan IDÉNTICAS a las de la construcción completa. Esto
    atrapa fugas que un desplazamiento de nivel NO atrapa: event_day/gap_z
    mirando el open del día siguiente, bars_left vía transform("size") (ve el
    tamaño final del grupo, no el recortado), o un bfill de contexto en vez de
    ffill (con barras caídas de verdad, bfill y ffill dan resultados
    distintos)."""
    bars, ctx, news, shock_day = leak_data
    full = F.build_features(bars, "NVDA", ctx, news, fomc_days=set())

    days = sorted(bars["dt_et"].dt.date.unique())
    mid_day = days[10]
    after_shock_day = days[days.index(shock_day) + 1]
    mid_day_bars = bars[bars["dt_et"].dt.date == mid_day].reset_index(drop=True)
    after_shock_bars = bars[bars["dt_et"].dt.date == after_shock_day].reset_index(drop=True)

    cuts = {
        "primera_barra_del_dia": mid_day_bars["dt_et"].iloc[0],
        "mitad_de_sesion": mid_day_bars["dt_et"].iloc[len(mid_day_bars) // 2],
        "ultima_barra_del_dia": mid_day_bars["dt_et"].iloc[-1],
        "dia_siguiente_al_shock": after_shock_bars["dt_et"].iloc[100],
    }

    for label, cut in cuts.items():
        bar_end_cut = cut + pd.Timedelta(minutes=1)
        b = bars[bars["dt_et"] <= cut].reset_index(drop=True)
        c = {k: v[v["dt_et"] <= cut].reset_index(drop=True) for k, v in ctx.items()}
        n = news[news["ts"] <= bar_end_cut].reset_index(drop=True)
        trunc = F.build_features(b, "NVDA", c, n, fomc_days=set())
        full_past = full[full["dt_et"] <= cut].reset_index(drop=True)
        trunc_past = trunc[trunc["dt_et"] <= cut].reset_index(drop=True)
        try:
            pd.testing.assert_frame_equal(full_past, trunc_past)
        except AssertionError as e:
            raise AssertionError(f"corte={label} ({cut}): {e}") from e


def test_la_ventana_de_inferencia_reproduce_la_fila_del_entrenamiento(data):
    bars, ctx, news = data
    full = _build(bars, ctx, news)
    keep = sorted(bars["dt_et"].dt.date.unique())[-F.HISTORY_SESSIONS:]
    cut = lambda df: df[df["dt_et"].dt.date.isin(keep)].reset_index(drop=True)
    short = _build(cut(bars), {k: cut(v) for k, v in ctx.items()}, news)
    last = keep[-1]
    pd.testing.assert_frame_equal(full[full["day"] == last].reset_index(drop=True),
                                  short[short["day"] == last].reset_index(drop=True))


def test_ventana_de_inferencia_con_shock_medio_dia_y_barras_caidas(big_data):
    """Mismo test que arriba pero con los casos límite reales: un shock ~21
    sesiones antes del último día (days_since_event debe valer 21 en AMBAS
    construcciones — el reset del contador en el día del shock "sincroniza" la
    ventana corta con la completa aunque difieran antes de eso), barras caídas
    en el propio ticker y en cada símbolo de contexto, y un medio día dentro de
    la ventana corta de HISTORY_SESSIONS."""
    bars, ctx, news, shock_day, half_day = big_data
    full = F.build_features(bars, "NVDA", ctx, news, fomc_days=set())
    days = sorted(bars["dt_et"].dt.date.unique())
    keep = days[-F.HISTORY_SESSIONS:]
    assert shock_day in keep and half_day in keep
    cut = lambda df: df[df["dt_et"].dt.date.isin(keep)].reset_index(drop=True)
    short = F.build_features(cut(bars), "NVDA", {k: cut(v) for k, v in ctx.items()},
                             news, fomc_days=set())
    last = keep[-1]
    full_last = full[full["day"] == last].reset_index(drop=True)
    short_last = short[short["day"] == last].reset_index(drop=True)
    assert (full_last["days_since_event"] == 21).all()
    pd.testing.assert_frame_equal(full_last, short_last)


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


def test_frontera_de_noticias_justo_en_el_cierre_de_la_barra(data):
    """Una noticia publicada EXACTAMENTE en t+1min (cierre de la barra t) cuenta
    para la fila t; una publicada un segundo después no."""
    bars, ctx, _ = data
    day = bars["dt_et"].dt.date.unique()[20]
    t = pd.Timestamp(f"{day} 10:30", tz="America/New_York")
    boundary = (t + pd.Timedelta(minutes=1)).tz_convert("UTC")
    news_at = pd.DataFrame({"id": ["b1"], "ts": [boundary], "sent": [1]})
    news_after = pd.DataFrame({"id": ["b2"], "ts": [boundary + pd.Timedelta(seconds=1)], "sent": [1]})
    row_at = _build(bars, ctx, news_at)
    row_at = row_at[row_at["dt_et"] == t].iloc[0]
    row_after = _build(bars, ctx, news_after)
    row_after = row_after[row_after["dt_et"] == t].iloc[0]
    assert row_at["news_24h"] == 1
    assert row_after["news_24h"] == 0


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
