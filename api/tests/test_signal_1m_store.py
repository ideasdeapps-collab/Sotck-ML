"""Scorer en vivo de la señal de dirección."""
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import signal_1m_store as store


def _bars(closes: dict) -> pd.DataFrame:
    return pd.DataFrame({"dt_et": [pd.Timestamp(k, tz="America/New_York") for k in closes],
                         "close": list(closes.values())})


def _row(as_of, p, confident, mom=True, h=5):
    return {"ticker": "NVDA", "as_of": pd.Timestamp(as_of, tz="America/New_York").isoformat(),
            "h": h, "p_up": p, "confident": confident, "anchor_close": 100.0,
            "dead_band": 0.001, "momentum_up": mom}


def test_score_resuelve_acierta_plano_y_pendiente():
    bars = _bars({"2026-09-22 10:05": 100.5,    # sube: acierta el p=0.6
                  "2026-09-22 10:06": 99.0,     # baja: falla el p=0.7
                  "2026-09-22 10:07": 100.05})  # plano (dentro de la banda)
    rows = [_row("2026-09-22 10:00", 0.6, True),
            _row("2026-09-22 10:01", 0.7, False, mom=False),
            _row("2026-09-22 10:02", 0.4, True),
            _row("2026-09-22 15:58", 0.6, True)]   # su +5 no existe todavía
    out = store.score_signals(rows, bars)
    s = out["horizons"]["5"]
    assert out["n_signals"] == 4
    assert s["resolved"] == 3 and s["pending"] == 1
    assert s["flat_share"] == 1 / 3
    assert s["acc_all"] == 0.5            # 1 de 2 no planas
    assert s["acc_confident"] == 1.0      # la única confiada no plana acertó
    assert s["coverage"] == 0.5
    assert s["acc_momentum"] == 1.0       # momentum: sube acierta, baja acierta


def test_score_sin_filas():
    assert store.score_signals([], _bars({})) == {"n_signals": 0, "horizons": {}, "truncated": False}


def test_score_signals_propaga_truncated():
    bars = _bars({"2026-09-22 10:05": 100.5})
    rows = [_row("2026-09-22 10:00", 0.6, True)]
    out = store.score_signals(rows, bars, truncated=True)
    assert out["truncated"] is True


def test_save_signal_sin_supabase_es_noop(monkeypatch):
    monkeypatch.setattr(store, "_ENABLED", False)
    assert store.save_signal({"ticker": "NVDA", "horizons": []}) == 0


def test_get_signals_pide_desc_y_devuelve_asc(monkeypatch):
    monkeypatch.setattr(store, "_ENABLED", True)
    monkeypatch.setattr(store, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(store, "SUPABASE_KEY", "fake-key")

    captured = {}
    desc_rows = [
        {"ticker": "NVDA", "as_of": "2026-09-22T10:02:00+00:00", "h": 5},
        {"ticker": "NVDA", "as_of": "2026-09-22T10:01:00+00:00", "h": 5},
        {"ticker": "NVDA", "as_of": "2026-09-22T10:00:00+00:00", "h": 5},
    ]

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return desc_rows

    def fake_get(url, headers=None, timeout=None, params=None):
        captured["params"] = params
        return FakeResponse()

    monkeypatch.setattr(store.requests, "get", fake_get)

    out = store.get_signals("NVDA", "2026-09-22T00:00:00Z")

    assert captured["params"]["order"] == "as_of.desc"
    assert captured["params"]["limit"] == str(store.SIGNALS_LIMIT)
    assert [r["as_of"] for r in out] == [
        "2026-09-22T10:00:00+00:00", "2026-09-22T10:01:00+00:00", "2026-09-22T10:02:00+00:00",
    ]
