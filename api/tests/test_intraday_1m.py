"""Inferencia de 1 minuto.

El test que importa es el de equivalencia: `incremental_features` y
`add_1m_features` tienen que dar exactamente lo mismo. Si divergen, el modelo
recibe entradas distintas de las que vio al entrenar y sirve basura sin fallar.
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import intraday_1m
from train_xgb_1m import BARS_PER_SESSION, FEATURE_COLS, add_1m_features


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


def test_la_equivalencia_se_mantiene_con_gap_real():
    # El fixture de un solo día hace que ambas rutas den gap=0 y "coincidan"
    # trivialmente. Con dos sesiones y hueco de apertura, el gap es la feature
    # que puede desalinear entrenamiento e inferencia sin que nada falle.
    d1 = _session("2026-08-27", n=40)
    d2 = _session("2026-08-28", n=40)
    d2[["open", "high", "low", "close"]] += 5.0  # hueco al alza
    hist = pd.concat([d1, d2], ignore_index=True)

    prev_close = float(d1["close"].iloc[-1])
    esperado = add_1m_features(hist)[FEATURE_COLS].iloc[-1].fillna(0.0).values
    obtenido = np.asarray(intraday_1m.incremental_features(d2, prev_close), dtype=float)

    assert obtenido == pytest.approx(esperado, rel=1e-9, abs=1e-12)


@pytest.mark.parametrize("n", [1, 2, 3, 6, 16])
def test_la_equivalencia_se_mantiene_con_pocas_barras(n):
    # Zona donde los lags (i<5) y los agregados (i<15) aún no tienen historia.
    df = _session(n=n)
    esperado = add_1m_features(df)[FEATURE_COLS].iloc[-1].fillna(0.0).values
    obtenido = np.asarray(intraday_1m.incremental_features(df), dtype=float)

    assert obtenido == pytest.approx(esperado, rel=1e-9, abs=1e-12)


def test_la_equivalencia_se_mantiene_sobre_barras_sinteticas():
    # Lo que de verdad pasa dentro del bucle: a partir del segundo paso, `work`
    # mezcla barras reales con las sintéticas que el propio bucle añadió.
    work = _session(n=60)
    ultimo = pd.Timestamp(work["dt_et"].iloc[-1])
    precio = float(work["close"].iloc[-1])

    for paso in range(1, 6):
        precio *= 1.0005
        ultimo += pd.Timedelta(minutes=1)
        work = pd.concat([work, pd.DataFrame([{
            "dt_et": ultimo, "open": precio, "high": precio,
            "low": precio, "close": precio, "volume": 1000.0,
        }])], ignore_index=True)

        esperado = add_1m_features(work)[FEATURE_COLS].iloc[-1].fillna(0.0).values
        obtenido = np.asarray(intraday_1m.incremental_features(work), dtype=float)
        assert obtenido == pytest.approx(esperado, rel=1e-9, abs=1e-12), f"paso {paso}"


def test_predict_from_bars_rechaza_una_sesion_vacia():
    vacia = _session(n=0)
    with pytest.raises(ValueError):
        intraday_1m._predict_from_bars(_Modelo(0.0), {"sigma_1m": 0.001}, vacia, 5)


def test_el_horizonte_se_recorta_al_cierre_de_sesion():
    # A 5 barras del cierre (BARS_PER_SESSION=390), pedir 30 min de horizonte
    # no puede proyectar más allá de las 16:00 ET.
    n_real = BARS_PER_SESSION - 5
    out = intraday_1m._predict_from_bars(_Modelo(0.0001), {"sigma_1m": 0.001},
                                          _session(n=n_real), 30)

    assert out["horizon_min"] == 5
    assert len(out["predicted"]) == 5


def test_sesion_completa_no_proyecta_nada():
    # Sesión ya cerrada (390 barras reales): fuera de horario o con el
    # retraso del plan Starter, no hay "próximos minutos" que inventar.
    out = intraday_1m._predict_from_bars(_Modelo(0.0001), {"sigma_1m": 0.001},
                                          _session(n=BARS_PER_SESSION), 30)

    assert out["horizon_min"] == 0
    assert out["predicted"] == []


def test_load_1m_model_rechaza_features_desalineadas(tmp_path, monkeypatch):
    # meta_1m_{T}.json guarda feature_cols precisamente para que la inferencia
    # no pueda usar otro orden (spec). Si el meta declara otras features que
    # las actuales de FEATURE_COLS, hay que negarse a servir en vez de dejar
    # que XGBoost reciba entradas en el orden equivocado sin protestar.
    monkeypatch.setattr(intraday_1m, "ARTIFACT_DIR", tmp_path)
    intraday_1m._CACHE.clear()

    joblib.dump({"modelo": "falso"}, tmp_path / "xgb_1m_TEST.joblib")
    otras_features = list(reversed(FEATURE_COLS))
    (tmp_path / "meta_1m_TEST.json").write_text(json.dumps({"feature_cols": otras_features}))

    with pytest.raises(FileNotFoundError, match="otro orden de features"):
        intraday_1m.load_1m_model("TEST")
