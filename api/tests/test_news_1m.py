"""Noticias de Polygon → serie temporal de sentimiento por ticker."""
import sys
from pathlib import Path

import pandas as pd

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(API.parent / "training"))

import news_1m
from sentiment import ticker_sentiment


def test_ticker_sentiment_toma_el_insight_del_ticker_pedido():
    art = {"insights": [{"ticker": "AMD", "sentiment": "negative"},
                        {"ticker": "nvda", "sentiment": "positive", "sentiment_reasoning": "r"}]}
    assert ticker_sentiment(art, "NVDA") == ("positive", "r")
    assert ticker_sentiment({"insights": None}, "NVDA") == ("neutral", "")


def test_news_to_frame_ordena_deduplica_y_codifica_el_sentimiento():
    raw = [
        {"id": "b", "published_utc": "2026-09-22T15:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "negative"}]},
        {"id": "a", "published_utc": "2026-09-22T14:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "positive"}]},
        {"id": "a", "published_utc": "2026-09-22T14:00:00Z",
         "insights": [{"ticker": "NVDA", "sentiment": "positive"}]},
        {"id": "c", "published_utc": "2026-09-22T16:00:00Z",
         "insights": [{"ticker": "AMD", "sentiment": "positive"}]},
    ]
    df = news_1m.news_to_frame(raw, "NVDA")
    assert list(df.columns) == news_1m.NEWS_COLS
    assert list(df["id"]) == ["a", "b", "c"]
    assert list(df["sent"]) == [1, -1, 0]
    assert str(df["ts"].dt.tz) == "UTC"


def test_news_to_frame_vacio_devuelve_columnas():
    df = news_1m.news_to_frame([], "NVDA")
    assert list(df.columns) == news_1m.NEWS_COLS and df.empty


def test_load_news_usa_la_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(news_1m, "CACHE_DIR", tmp_path)
    calls = []
    frame = news_1m.news_to_frame([
        {"id": "a", "published_utc": "2026-09-20T14:00:00Z", "insights": []},
        {"id": "b", "published_utc": "2026-09-22T14:00:00Z", "insights": []},
    ], "NVDA")

    def fake_fetch(ticker, since, ttl=300):
        calls.append(since)
        return frame[frame["ts"].dt.date >= since].reset_index(drop=True)

    monkeypatch.setattr(news_1m, "fetch_news", fake_fetch)
    since = pd.Timestamp("2026-09-01").date()
    news_1m.load_news("NVDA", since)
    out = news_1m.load_news("NVDA", since)
    assert calls[1] == pd.Timestamp("2026-09-22").date()
    assert list(out["id"]) == ["a", "b"]
