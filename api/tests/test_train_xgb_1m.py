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
