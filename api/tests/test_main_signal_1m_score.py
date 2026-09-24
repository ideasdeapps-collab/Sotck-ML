"""M4: /signal-1m-score valida el ticker contra los que sirve el modelo,
igual que /signal-1m, antes de tocar Supabase o Polygon."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

import main


def test_signal_1m_score_404_si_el_ticker_no_esta_servido(monkeypatch):
    monkeypatch.setattr(main.signal_1m_store, "enabled", lambda: True)
    monkeypatch.setattr(main, "load_signal_models",
                        lambda: ({}, {"tickers": ["NVDA", "QQQ"]}))

    with pytest.raises(HTTPException) as exc_info:
        main.signal_1m_score("TSLA")

    assert exc_info.value.status_code == 404
    assert "TSLA" in str(exc_info.value.detail)


def test_signal_1m_score_normaliza_a_mayusculas_si_esta_servido(monkeypatch):
    monkeypatch.setattr(main.signal_1m_store, "enabled", lambda: True)
    monkeypatch.setattr(main, "load_signal_models",
                        lambda: ({}, {"tickers": ["NVDA"]}))
    seen = {}

    def fake_get_signals(t, since):
        seen["ticker"] = t
        return []

    monkeypatch.setattr(main.signal_1m_store, "get_signals", fake_get_signals)

    out = main.signal_1m_score("nvda")

    assert out == {"n_signals": 0, "horizons": {}}
    assert seen["ticker"] == "NVDA"
