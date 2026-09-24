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
