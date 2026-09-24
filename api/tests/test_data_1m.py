"""Descarga y caché de barras de 1 min para el modelo de dirección."""
import datetime as dt
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import data_1m
from synth_1m import bars as synth_bars


def _ms(ts: str) -> int:
    return int(pd.Timestamp(ts, tz="America/New_York").tz_convert("UTC").value // 1_000_000)


def test_aggs_to_frame_filtra_la_sesion_y_conserva_vw_y_n():
    raw = [
        {"t": _ms("2026-09-22 09:29"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1, "vw": 1, "n": 1},
        {"t": _ms("2026-09-22 09:30"), "o": 2, "h": 2, "l": 2, "c": 2, "v": 2, "vw": 2.1, "n": 7},
        {"t": _ms("2026-09-22 15:59"), "o": 3, "h": 3, "l": 3, "c": 3, "v": 3, "vw": 3.1, "n": 9},
        {"t": _ms("2026-09-22 16:00"), "o": 4, "h": 4, "l": 4, "c": 4, "v": 4, "vw": 4, "n": 4},
    ]
    df = data_1m.aggs_to_frame(raw)
    assert list(df.columns) == data_1m.BAR_COLS
    assert list(df["close"]) == [2, 3]
    assert list(df["n"]) == [7, 9]
    assert list(df["vw"]) == [2.1, 3.1]


def test_aggs_to_frame_sin_vw_deja_nan_en_vez_de_fallar():
    raw = [{"t": _ms("2026-09-22 10:00"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    df = data_1m.aggs_to_frame(raw)
    assert df["vw"].isna().all() and df["n"].isna().all()


def test_merge_bars_se_queda_con_la_barra_nueva_si_se_solapan():
    old = synth_bars(n_days=2, seed=1)
    new = old.tail(10).copy()
    new["close"] = 999.0
    merged = data_1m.merge_bars(old, new)
    assert len(merged) == len(old)
    assert (merged.tail(10)["close"] == 999.0).all()


def test_last_sessions_recorta_por_sesiones_no_por_filas():
    df = synth_bars(n_days=5)
    out = data_1m.last_sessions(df, 2)
    assert out["dt_et"].dt.date.nunique() == 2
    assert out["dt_et"].dt.date.min() == df["dt_et"].dt.date.unique()[-2]


def test_load_bars_reutiliza_la_cache_y_solo_pide_desde_el_ultimo_dia(tmp_path, monkeypatch):
    monkeypatch.setattr(data_1m, "CACHE_DIR", tmp_path)
    full = synth_bars(n_days=10, start="2026-09-07")
    calls = []

    def fake_fetch(ticker, start, end, ttl=60):
        calls.append(start)
        return full[full["dt_et"].dt.date >= start].reset_index(drop=True)

    monkeypatch.setattr(data_1m, "fetch_bars", fake_fetch)
    today = dt.date(2026, 9, 19)
    first = data_1m.load_bars("NVDA", 5, today=today)
    second = data_1m.load_bars("NVDA", 5, today=today)

    last_day = full["dt_et"].dt.date.max()
    assert calls[1] == last_day          # la segunda vez solo re-descarga el último día
    assert calls[0] < calls[1]
    pd.testing.assert_frame_equal(first, second)
    assert first["dt_et"].dt.date.nunique() == 5
