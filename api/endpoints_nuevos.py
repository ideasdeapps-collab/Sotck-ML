"""
endpoints_nuevos.py — Fragmento para pegar en api/main.py
=========================================================
Agrega los 2 endpoints nuevos (sentimiento y técnico). Las gráficas intradía
y de señales NO cambian de endpoint (solo se corrigió el eje X en el frontend).

CÓMO INTEGRAR:
1) En la zona de imports de main.py, junto a los otros módulos, añade:

       from sentiment import forecast_with_sentiment
       from technical import technical_analysis

2) Pega los dos @app.get(...) de abajo junto al resto de endpoints.
   Ambos reutilizan tu función existente `predict_curve(ticker, horizon)`.
"""

# --- PEGAR EN main.py -------------------------------------------------------

@app.get("/forecast-sentiment")
def forecast_sentiment(ticker: str, horizon: int = 30):
    """Curva XGBoost ajustada por sentimiento de noticias (Polygon /reference/news).
    Devuelve ml_only, ml_plus_sentiment, score de sentimiento y noticias."""
    try:
        return forecast_with_sentiment(predict_curve, ticker, horizon)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/technical")
def technical(ticker: str, horizon: int = 20, zigzag: float = 0.03):
    """Análisis técnico mixto: histórico + predicción + ZigZag + Elliott + Fibonacci."""
    try:
        return technical_analysis(predict_curve, ticker, horizon, zigzag_pct=zigzag)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))
