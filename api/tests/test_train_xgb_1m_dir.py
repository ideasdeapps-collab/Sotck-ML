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
    # El Wilson i.i.d. se conserva como dato informativo (ya no decide has_edge).
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


def test_la_compuerta_exige_cada_condicion():
    good = {"coverage": 0.2, "boot_lo": 0.55, "boot_edge_lo": 0.02, "fold_consistency": 1.0}
    assert T.gate(good, min_coverage=0.10)
    assert not T.gate({**good, "coverage": 0.05}, min_coverage=0.10)
    assert not T.gate({**good, "boot_lo": 0.49}, min_coverage=0.10)
    assert not T.gate({**good, "boot_edge_lo": -0.01}, min_coverage=0.10)
    assert not T.gate({**good, "fold_consistency": 0.5}, min_coverage=0.10)


def test_bootstrap_por_dia_rechaza_lo_que_el_wilson_iid_aprobaria():
    # 40 días; cada fila de un día COMPARTE la etiqueta (filas fuertemente
    # dependientes dentro del día), ~55 % de los días "sube". El modelo predice
    # "sube" con total confianza en TODAS las filas: acierta el 55 % de las filas,
    # que con n=4000 filas sueltas el Wilson i.i.d. ve como ventaja clara (>50%),
    # pero con solo 40 días efectivos el bootstrap por bloques de día debe
    # rechazarlo (percentil 5 por debajo de 50 %).
    n_days, rows_per_day = 40, 100
    up_days = round(0.55 * n_days)
    day = np.repeat(np.arange(n_days), rows_per_day)
    y = np.repeat(np.array([1] * up_days + [0] * (n_days - up_days)), rows_per_day)
    p = np.full(len(day), 0.9)
    tau = 0.1
    baseline_preds = {"majority": np.zeros(len(day), dtype=int)}

    stats = T.confident_stats(p, y, tau)
    assert stats["wilson_lo"] > 0.5  # el criterio antiguo (i.i.d.) habría dado luz verde

    boot = T.block_bootstrap(p, y, day, tau, baseline_preds, n_boot=1000, seed=0)
    assert boot["boot_lo"] <= 0.5  # el bootstrap por día ve la dependencia y lo rechaza

    stats_new = {**stats, **boot, "fold_consistency": 1.0}
    assert not T.gate(stats_new, min_coverage=0.10)


def test_baseline_preds_cae_a_mayoria_si_falta_el_dato():
    frame = pd.DataFrame({"ret_15_z": [0.5, np.nan, -0.3],
                          "dist_vwap_z": [np.nan, 0.2, -0.1]})
    preds = T._baseline_preds(frame, majority=1)
    assert preds["momentum"].tolist() == [1, 1, 0]   # NaN -> mayoría (1), no "baja"
    assert preds["reversion"].tolist() == [1, 0, 1]  # NaN -> mayoría (1)


def test_ensure_enough_sessions_exige_un_minimo_de_dias():
    bars_ok = synth_bars(70, seed=1)
    T._ensure_enough_sessions("NVDA", bars_ok, min_days=60)  # no lanza

    bars_pocas = synth_bars(10, seed=1)
    with pytest.raises(RuntimeError, match="NVDA"):
        T._ensure_enough_sessions("NVDA", bars_pocas, min_days=60)

    with pytest.raises(RuntimeError, match="AVGO"):
        T._ensure_enough_sessions("AVGO", pd.DataFrame(columns=["dt_et"]), min_days=60)


def test_con_ruido_puro_la_compuerta_no_da_ventaja():
    ds = T.assemble({"NVDA": _feat(n_days=40, seed=1), "QQQ": _feat(n_days=40, seed=2, ticker="QQQ")})
    model, meta = T.train_horizon(ds, 5, n_folds=2, min_train_days=25,
                                  params={"n_estimators": 40, "max_depth": 3})
    assert meta["has_edge"] is False
    ho = meta["holdout"]
    assert 0.0 <= ho["coverage"] <= 1.0
    # F1: la compuerta ahora decide con el bootstrap por día y la consistencia de folds.
    assert {"boot_lo", "boot_edge_lo", "fold_consistency", "wilson_lo"} <= set(ho)
    # F2: el holdout también ve las filas sin etiqueta (banda muerta) de los días de test.
    assert 0.0 <= ho["flat_share"] <= 1.0
    assert ho["precision_incl_flat"] is None or 0.0 <= ho["precision_incl_flat"] <= 1.0
    assert set(meta["baselines"]) == {"majority", "momentum", "reversion"}
    assert set(meta["abs_ret_mean"]) == {"NVDA", "QQQ"}
    # F3: by_hour renombrado (informativo, todas las filas OOF).
    assert "by_hour_all_oof" in meta and "by_hour" not in meta
    proba = model.predict_proba(ds[F.FEATURE_COLS].head(3))
    assert proba.shape == (3, 2)
