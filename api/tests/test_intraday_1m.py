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
