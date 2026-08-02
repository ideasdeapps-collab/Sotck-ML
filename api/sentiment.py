"""
sentiment.py — Serie ML + Noticias + Sentimiento
================================================
Toma la predicción de XGBoost que ya generamos y la AJUSTA con una señal de
sentimiento derivada de noticias reales de Polygon (endpoint /v2/reference/news,
incluido en el plan GRATUITO, actualizado cada hora, con 'insights' de sentimiento
por ticker).

Salida:
  - Serie "ml_only": la curva de predicción XGBoost original.
  - Serie "ml_plus_sentiment": la misma curva inclinada por el sentimiento agregado
    de las noticias recientes (tilt diario acotado).
  - Marcadores de noticias con su sentimiento (positive/negative/neutral) y titular.

Idea de gestión de riesgo: el sentimiento actúa como "modulador" del sesgo del
modelo. Si las noticias contradicen la predicción, la curva ajustada se aplana
(señal de precaución); si la confirman, se refuerza.
"""

from __future__ import annotations
import os
import datetime as dt

import numpy as np

from polygon_client import get_json, TTL_INTRADAY

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")

# Cuánto puede "inclinar" el sentimiento la curva por día (acotado, prudente).
MAX_DAILY_TILT = 0.0015   # ±0.15% por día de sesgo adicional máximo


# --------------------------------------------------------------------------- #
# 1. Noticias + sentimiento desde Polygon (plan gratuito)
# --------------------------------------------------------------------------- #
def fetch_news(ticker: str, limit: int = 20) -> list[dict]:
    """Descarga noticias recientes con insights de sentimiento por ticker."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    url = (
        f"https://api.polygon.io/v2/reference/news?ticker={ticker.upper()}"
        f"&order=desc&sort=published_utc&limit={limit}&apiKey={POLYGON_API_KEY}"
    )
    results = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    news = []
    for r in results:
        # 'insights' trae sentimiento por ticker cuando está disponible
        sentiment, reason = "neutral", ""
        for ins in r.get("insights", []):
            if ins.get("ticker", "").upper() == ticker.upper():
                sentiment = ins.get("sentiment", "neutral")
                reason = ins.get("sentiment_reasoning", "")
                break
        news.append({
            "published_utc": r.get("published_utc"),
            "title": r.get("title"),
            "publisher": r.get("publisher", {}).get("name"),
            "url": r.get("article_url"),
            "sentiment": sentiment,
            "reasoning": reason,
        })
    return news


def aggregate_sentiment(news: list[dict], half_life_days: float = 2.0) -> dict:
    """
    Convierte las noticias en un score neto [-1, 1] con decaimiento temporal:
    las noticias más recientes pesan más (half-life configurable).
    """
    if not news:
        return {"score": 0.0, "pos": 0, "neg": 0, "neu": 0, "n": 0}

    now = dt.datetime.now(dt.timezone.utc)
    val = {"positive": 1.0, "negative": -1.0, "neutral": 0.0}
    num, den = 0.0, 0.0
    pos = neg = neu = 0
    for n in news:
        s = n["sentiment"]
        pos += s == "positive"; neg += s == "negative"; neu += s == "neutral"
        try:
            ts = dt.datetime.fromisoformat(n["published_utc"].replace("Z", "+00:00"))
            age_days = max((now - ts).total_seconds() / 86400, 0)
        except Exception:
            age_days = 1.0
        w = 0.5 ** (age_days / half_life_days)   # decaimiento exponencial
        num += val.get(s, 0.0) * w
        den += w
    score = num / den if den else 0.0
    return {"score": round(float(score), 4),
            "pos": pos, "neg": neg, "neu": neu, "n": len(news)}


# --------------------------------------------------------------------------- #
# 2. Ajuste de la curva ML con el sentimiento
# --------------------------------------------------------------------------- #
def blend_forecast(prediction: dict, sentiment_score: float) -> dict:
    """
    Aplica un 'tilt' diario acotado a la curva de predicción según el sentimiento.
    tilt_por_dia = score * MAX_DAILY_TILT   (compuesto a lo largo del horizonte)
    """
    pred = prediction["prediction"]
    tilt = float(np.clip(sentiment_score, -1, 1)) * MAX_DAILY_TILT

    adjusted = []
    factor = 1.0
    for i, p in enumerate(pred, start=1):
        factor *= (1 + tilt)                      # compuesto por día
        adjusted.append({"date": p["date"],
                         "close": round(p["close"] * factor, 4)})
    return adjusted


# --------------------------------------------------------------------------- #
# 3. Orquestador
# --------------------------------------------------------------------------- #
def forecast_with_sentiment(predict_curve_fn, ticker: str, horizon: int = 30) -> dict:
    """
    predict_curve_fn: función de main.py que genera la curva XGBoost (se inyecta
    para evitar import circular).
    """
    prediction = predict_curve_fn(ticker, horizon)
    news = fetch_news(ticker, limit=20)
    agg = aggregate_sentiment(news)
    adjusted = blend_forecast(prediction, agg["score"])

    # Marcadores de noticias que caen dentro (o justo antes) del rango graficado
    markers = [{
        "date": (n["published_utc"] or "")[:10],
        "sentiment": n["sentiment"],
        "title": n["title"],
        "publisher": n["publisher"],
        "url": n["url"],
    } for n in news[:10]]

    # Interpretación para gestión de riesgo
    bias = prediction["prediction"][-1]["close"] - prediction["last_close"]
    if agg["score"] > 0.2 and bias > 0:
        stance = "Confluencia alcista: noticias refuerzan la predicción."
    elif agg["score"] < -0.2 and bias < 0:
        stance = "Confluencia bajista: noticias refuerzan la caída prevista."
    elif abs(agg["score"]) > 0.2 and np.sign(agg["score"]) != np.sign(bias):
        stance = "⚠️ Divergencia: el sentimiento contradice al modelo. Precaución."
    else:
        stance = "Sentimiento neutro o débil: domina la señal del modelo."

    return {
        "ticker": ticker.upper(),
        "last_close": prediction["last_close"],
        "history": prediction["history"],
        "ml_only": prediction["prediction"],
        "ml_plus_sentiment": adjusted,
        "sentiment": agg,
        "news": markers,
        "risk_note": stance,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
    }
