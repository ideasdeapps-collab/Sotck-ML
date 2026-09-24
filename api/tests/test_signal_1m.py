"""Inferencia del modelo de dirección de 1 min."""
import datetime as dt
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
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


def test_recent_bars_separa_historia_de_hoy_con_ttl_distinto(monkeypatch):
    calls = []

    def fake_fetch_bars(symbol, start, end, ttl=60, store=True):
        calls.append((symbol, start, end, ttl, store))
        n_days = 1 if start == end else F.HISTORY_SESSIONS + 20
        return synth_bars(n_days, seed=1, start=start.isoformat())

    monkeypatch.setattr(signal_1m, "fetch_bars", fake_fetch_bars)
    signal_1m._HISTORY_CACHE.clear()
    today = dt.date(2026, 3, 2)
    now_et = pd.Timestamp(f"{today} 20:00", tz="America/New_York")   # tras el cierre
    out = signal_1m._recent_bars("NVDA", today, now_et)

    assert len(calls) == 2
    hist_call, live_call = calls
    assert hist_call[0] == "NVDA" and live_call[0] == "NVDA"
    assert hist_call[2] == today - dt.timedelta(days=1)
    assert hist_call[3] == signal_1m.HISTORY_TTL
    assert live_call[1] == today and live_call[2] == today
    assert live_call[3] == 60
    # C1: ninguno de los dos fetch escribe el JSON crudo en la caché de
    # polygon_client (152 días de 1 min por símbolo pueden OOM la instancia).
    assert hist_call[4] is False and live_call[4] is False
    assert out["dt_et"].dt.date.nunique() == F.HISTORY_SESSIONS


def test_recent_bars_cachea_la_historia_parseada_por_ttl(monkeypatch):
    """C1: el DataFrame parseado de historia (regular-session) se cachea a
    nivel de módulo por (symbol, start, ayer) con expiry HISTORY_TTL, para no
    volver a pedir ~150 días de 1 min en cada llamada dentro de la ventana."""
    calls = []

    def fake_fetch_bars(symbol, start, end, ttl=60, store=True):
        calls.append((symbol, start, end, ttl, store))
        n_days = 1 if start == end else F.HISTORY_SESSIONS + 20
        return synth_bars(n_days, seed=1, start=start.isoformat())

    monkeypatch.setattr(signal_1m, "fetch_bars", fake_fetch_bars)
    signal_1m._HISTORY_CACHE.clear()

    fake_now = [1_000_000.0]
    monkeypatch.setattr(signal_1m.time, "time", lambda: fake_now[0])

    today = dt.date(2026, 3, 2)
    now_et = pd.Timestamp(f"{today} 20:00", tz="America/New_York")   # tras el cierre
    signal_1m._recent_bars("NVDA", today, now_et)
    signal_1m._recent_bars("NVDA", today, now_et)

    history_calls = [c for c in calls if c[1] != c[2]]   # start != end -> es la historia
    assert len(history_calls) == 1                        # un solo fetch de historia en dos llamadas
    assert len(calls) == 3                                 # 1 historia + 2 "hoy" (siempre se repite)

    fake_now[0] += signal_1m.HISTORY_TTL + 1
    signal_1m._recent_bars("NVDA", today, now_et)

    history_calls = [c for c in calls if c[1] != c[2]]
    assert len(history_calls) == 2                         # tras expirar, se re-descarga


def test_drop_forming_bar_descarta_la_barra_a_medio_formar():
    bars = synth_bars(1, seed=1, start="2026-03-02")
    last_start = bars["dt_et"].iloc[-1]
    # Aún no pasó ni el minuto completo ni el delay de Polygon.
    now_et = last_start + pd.Timedelta(minutes=1)
    out = signal_1m._drop_forming_bar(bars, now_et, delay_min=15)
    assert len(out) == len(bars) - 1
    assert out["dt_et"].iloc[-1] == bars["dt_et"].iloc[-2]


def test_drop_forming_bar_conserva_la_barra_completa():
    bars = synth_bars(1, seed=1, start="2026-03-02")
    last_start = bars["dt_et"].iloc[-1]
    now_et = last_start + pd.Timedelta(minutes=1 + 15)   # justo en el límite: ya completa
    out = signal_1m._drop_forming_bar(bars, now_et, delay_min=15)
    pd.testing.assert_frame_equal(out, bars)


def test_drop_forming_bar_con_frame_vacio_no_cambia():
    empty = pd.DataFrame(columns=["dt_et", "open", "high", "low", "close", "volume", "vw", "n"])
    now_et = pd.Timestamp("2026-03-02 20:00", tz="America/New_York")
    out = signal_1m._drop_forming_bar(empty, now_et, delay_min=15)
    assert out.empty


def test_predict_signal_pide_noticias_solo_unos_dias_atras(monkeypatch, trained):
    """I3: NEWS_SINCE_CAP_MIN son 3 días; predict_signal no debe pedir noticias
    desde ~150 días atrás (la ventana de barras de HISTORY_SESSIONS)."""
    models, meta, feat = trained
    last_row = feat.iloc[[-1]]

    monkeypatch.setattr(signal_1m, "load_models", lambda: (models, meta))
    monkeypatch.setattr(signal_1m, "_recent_bars",
                        lambda s, today, now_et: synth_bars(5, seed=1))
    monkeypatch.setattr(signal_1m, "build_features",
                        lambda bars, t, ctx, news: last_row)
    captured = {}

    def fake_fetch_news(ticker, since):
        captured["since"] = since
        return synth_news(5, seed=1, days=5)

    monkeypatch.setattr(signal_1m, "fetch_news", fake_fetch_news)

    signal_1m.predict_signal("NVDA")

    today = dt.date.today()
    assert captured["since"] >= today - dt.timedelta(days=4)
