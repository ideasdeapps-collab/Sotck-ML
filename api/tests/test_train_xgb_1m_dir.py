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


def test_fold_consistency_cuenta_como_fallo_un_fold_sin_filas_confiadas():
    # fold 0: dos filas confiadas, ambas aciertan -> éxito.
    # fold 1: dos filas SIN confianza (|p-0.5| < tau) -> debe contar como
    # fallo, no descartarse del denominador.
    day = pd.Series([0, 0, 1, 1])
    oof = np.array([0.9, 0.9, 0.5, 0.5])
    y = np.array([1, 1, 0, 1])
    tau = 0.1
    earlier_folds = [([], [0]), ([], [1])]

    score = T.fold_consistency_score(oof, y, day, tau, earlier_folds)

    assert score == 0.5     # 1 éxito de 2 folds anteriores (no 1 de 1)


def test_fold_consistency_sin_folds_anteriores_es_cero():
    day = pd.Series([], dtype=int)
    assert T.fold_consistency_score(np.array([]), np.array([]), day, 0.1, []) == 0.0


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


def _meta_dos_horizontes():
    hm = lambda: {"holdout": {"acc_all": 0.5, "precision": 0.5, "coverage": 0.5,
                              "boot_lo": 0.5, "fold_consistency": 0.5},
                 "baselines": {"majority": {"confident": 0.5}}, "has_edge": False}
    return {"trained_at": "2026-01-01T00:00:00Z", "n_rows": 10, "sessions": 5,
            "tickers": ["NVDA"], "horizons": {"5": hm(), "15": hm()}}


def test_write_artifacts_mueve_todo_junto_si_no_hay_error(tmp_path):
    artifact_dir = tmp_path / "1m_dir"
    meta = _meta_dos_horizontes()
    models = {5: "model5", 15: "model15"}

    report = T._write_artifacts(meta, models, artifact_dir)

    assert (artifact_dir / "xgb_h5.joblib").exists()
    assert (artifact_dir / "xgb_h15.joblib").exists()
    assert (artifact_dir / "meta.json").exists()
    assert (artifact_dir / "report.md").read_text() == report
    # no debe quedar ningún directorio temporal huérfano junto a artifact_dir.
    assert [p for p in tmp_path.iterdir() if p != artifact_dir] == []


def test_write_artifacts_es_atomico_todo_o_nada(tmp_path, monkeypatch):
    """M3: un fallo a mitad de volcado nunca deja modelos nuevos junto a un
    meta.json viejo (desalineados entre sí)."""
    artifact_dir = tmp_path / "1m_dir"
    artifact_dir.mkdir()
    (artifact_dir / "meta.json").write_text('{"old": true}')
    (artifact_dir / "xgb_h5.joblib").write_bytes(b"viejo")

    meta = _meta_dos_horizontes()
    models = {5: "model5", 15: "model15"}

    calls = {"n": 0}
    real_dump = T.joblib.dump

    def flaky_dump(obj, path):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return real_dump(obj, path)

    monkeypatch.setattr(T.joblib, "dump", flaky_dump)

    with pytest.raises(RuntimeError, match="boom"):
        T._write_artifacts(meta, models, artifact_dir)

    assert (artifact_dir / "meta.json").read_text() == '{"old": true}'
    assert (artifact_dir / "xgb_h5.joblib").read_bytes() == b"viejo"
    assert not (artifact_dir / "xgb_h15.joblib").exists()
    assert [p for p in tmp_path.iterdir() if p != artifact_dir] == []


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
    # R2: n_jobs=1 para que el hist builder de XGBoost sea determinista entre
    # runners (con n_jobs=-1 el resultado multi-hilo puede variar).
    model, meta = T.train_horizon(ds, 5, n_folds=2, min_train_days=25,
                                  params={"n_estimators": 40, "max_depth": 3, "n_jobs": 1})
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
    # M1: baselines por fold (no solo en el holdout final).
    for fm in meta["folds"]:
        assert set(fm["baselines"]) == {"majority", "momentum", "reversion"}


def _bars_con_senal(n_days: int = 60, seed: int = 1, start: str = "2026-01-05",
                    drift: float = 0.003) -> pd.DataFrame:
    """Control positivo (M1): deriva de signo aleatorio POR DÍA (mitad de los
    días sube todo el día, mitad baja), sumada al ruido de cada barra. Así el
    retorno futuro real (de donde sale la label) y el momentum intradía
    (ret_15_z) quedan correlacionados con la deriva del día: hay una señal
    real que un modelo —y el baseline de momentum— pueden aprender."""
    rng = np.random.default_rng(seed)
    frames, price = [], 100.0
    for d in pd.bdate_range(start, periods=n_days):
        sign = 1.0 if rng.uniform() < 0.5 else -1.0
        idx = pd.date_range(f"{d.date()} 09:30", periods=390, freq="1min",
                            tz="America/New_York")
        rets = rng.normal(0, 0.001, 390) + sign * drift
        close = price * np.exp(np.cumsum(rets))
        open_ = np.r_[price * np.exp(rng.normal(0, 0.0002)), close[:-1]]
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


def test_control_positivo_con_senal_plantada_detecta_ventaja():
    """M1: con una deriva diaria real plantada en los datos sintéticos, la
    compuerta debe dar has_edge=True (contraparte del test de ruido puro)."""
    n_days = 60
    ctx = {"SPY": synth_bars(n_days, seed=11), "QQQ": synth_bars(n_days, seed=12),
           "SMH": synth_bars(n_days, seed=13)}
    bars = _bars_con_senal(n_days, seed=1)
    feat = F.build_features(bars, "NVDA", ctx, synth_news(50, seed=1, days=n_days * 1.5),
                            fomc_days=set())
    ds = T.assemble({"NVDA": feat})
    # R2: n_jobs=1 para que el hist builder de XGBoost sea determinista entre
    # runners (con n_jobs=-1 el resultado multi-hilo puede variar).
    model, meta = T.train_horizon(ds, 15, n_folds=3, min_train_days=30,
                                  params={"n_estimators": 60, "max_depth": 3, "n_jobs": 1})
    assert meta["has_edge"] is True
    # R2: con drift=0.0006 boot_edge_lo rondaba ~0.022 (margen justo). Un
    # barrido de drift (ver hallazgo R2) muestra que el hueco entre el modelo
    # y el mejor baseline (momentum) NO crece con la deriva más allá de
    # drift≈0.0004: ahí el modelo ya acierta ~94-95% mientras momentum ronda
    # el mismo nivel, así que boot_edge_lo pasa por un pico estrecho (~0.05)
    # y LUEGO baja y se estabiliza en una meseta ancha (~0.02) a partir de
    # drift>=0.001, porque momentum también satura en ~97% (una fracción fija
    # de barras -las primeras de cada sesión, con ret_15_z aún poco fiable-
    # que ningún nivel de deriva resuelve). Usar el pico estrecho sería
    # frágil (cualquier diferencia mínima de punto flotante entre runners
    # puede cruzarlo), justo el tipo de fragilidad que este fix busca evitar;
    # se elige drift=0.003, bien dentro de la meseta estable y lejos de
    # cualquier transición, con boot_edge_lo≈0.02 reproducible.
    assert meta["holdout"]["boot_edge_lo"] >= 0.015
