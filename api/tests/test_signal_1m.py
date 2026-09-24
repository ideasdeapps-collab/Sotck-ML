"""Inferencia del modelo de dirección de 1 min."""
import datetime as dt
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


def test_recent_bars_separa_historia_de_hoy_con_ttl_distinto(monkeypatch):
    calls = []

    def fake_fetch_bars(symbol, start, end, ttl=60):
        calls.append((symbol, start, end, ttl))
        n_days = 1 if start == end else F.HISTORY_SESSIONS + 20
        return synth_bars(n_days, seed=1, start=start.isoformat())

    monkeypatch.setattr(signal_1m, "fetch_bars", fake_fetch_bars)
    today = dt.date(2026, 3, 2)
    out = signal_1m._recent_bars("NVDA", today)

    assert len(calls) == 2
    hist_call, live_call = calls
    assert hist_call[0] == "NVDA" and live_call[0] == "NVDA"
    assert hist_call[2] == today - dt.timedelta(days=1)
    assert hist_call[3] == signal_1m.HISTORY_TTL
    assert live_call[1] == today and live_call[2] == today
    assert live_call[3] == 60
    assert out["dt_et"].dt.date.nunique() == F.HISTORY_SESSIONS
