# XGBoost de 1 minuto: dirección a 5/15/30 min con confianza

> Diseño acordado el 2026-09-23. Estado: aprobado, pendiente de plan de implementación.

## Problema

El modelo de 1 minuto (`training/train_xgb_1m.py`, `api/intraday_1m.py`, `/predict-1m`) no aporta
señal. Historial de cada reentreno diario en `main` (31-ago → 24-sep-2026):

| Modelo | Dir.Acc | R² |
|---|---|---|
| 1m NVDA | 48.3–50.0 % | siempre < 0 |
| 1m QQQ | 48.0–51.0 % | ≈ 0, casi siempre < 0 |
| 1m SNDK | 48.6–50.4 % | siempre < 0 |
| 15m intradía | 42–62 %, salta de un día a otro | < 0 |

R² negativo = peor que predecir «sin cambio». Con ~4 500 muestras de test, ±1 % es ruido.

Causas:

1. **Target**: el retorno del siguiente minuto es casi ruido puro; una regresión con error cuadrático
   predice ≈ 0 con signo aleatorio.
2. **Recursión**: la curva de 30 min encadena 30 predicciones y acumula el error.
3. **Información**: solo ve su propio precio; ni mercado, ni sector, ni noticias. Y solo 60 días,
   cuando el plan Starter da 5 años.
4. **Validación**: un único corte 80/20, sin baselines, sin medir el acierto cuando el modelo está
   seguro.

## Lo que se va a hacer

Cambiar la pregunta: **¿subirá o bajará en 5, 15 y 30 minutos, más allá del ruido, y con qué
probabilidad?** El modelo se **abstiene** cuando no está seguro. Un **modelo agrupado** (varios
tickers líquidos, el ticker como feature) por horizonte.

Objetivo realista: ~51–53 % sobre todos los minutos; **55–60 % en el subconjunto confiado** (20–30 %
de los minutos). Solo se presenta como señal si supera a los baselines fuera de muestra (compuerta
más abajo).

## Lo que NO se va a hacer

- **No se toca el modelo de 1m actual** ni `/predict-1m`: el frontend depende de ellos. Se retira
  solo cuando el nuevo demuestre en vivo que acierta más.
- **No hay features incrementales duplicadas.** Sin recursión, la inferencia calcula una sola fila
  con la misma función que el entrenamiento. Una definición, cero divergencia posible.
- **No se usan trades/quotes tick a tick**: no están garantizados en Starter. La microestructura sale
  de lo que ya traen las barras (`n`, `vw`).

## Datos

- Tickers de entrenamiento: NVDA QQQ SNDK TSM AVGO META AMAT MU. Contexto: SPY, QQQ, SMH.
- 1 año de barras de 1 min, sesión regular (~98 k barras por ticker, ~800 k filas en total).
- Caché pickle en `training/.cache_1m/` (gitignored), descarga incremental. Pickle y no Parquet:
  `pyarrow` no está en `api/requirements.txt` y no merece entrar solo para una caché.
- Todo se alinea por `dt_et`; en la fila t solo se usan barras con inicio ≤ t.

## Features

Retornos y volatilidades en unidades de σ del ticker, para que el modelo agrupado sea comparable
entre tickers.

- **Tiempo/sesión**: `tod_sin/cos`, `bars_left`, `ret_from_open`, `dist_vwap`, `gap` (mismas
  definiciones que `add_1m_features`) + z-score del gap contra sus 60 días.
- **Momentum/volatilidad**: retornos 1/5/15/30/60 min; volatilidad realizada 15/60; rango;
  z-score del volumen **contra la misma hora del día** (media de 20 días).
- **Microestructura**: transacciones `n` relativas al día, `(close − vw)/close`, volumen por
  transacción.
- **Mercado/sector**: retornos 1/5/15 de SPY, QQQ, SMH; `rs_15 = ret15 − β·ret15_QQQ` con β móvil.
  Para QQQ, el contexto de mercado es SPY.
- **Noticias** (`/v2/reference/news`, `insights`): nº de noticias en 60 min y 24 h, sentimiento neto
  24 h (pos − neg), minutos desde la última noticia (tope). Solo noticias con `published_utc ≤ t`.
- **Eventos**: `is_earnings_day`, `days_since_earnings` (tope), `is_macro_day`, minutos hasta las
  14:00 ET en día FOMC. Earnings: Polygon Starter no trae calendario de resultados (es un add-on), y `filing_date` de
  `/vX/reference/financials` es la fecha del 10-Q, días o semanas después del reporte. Se usa en su
  lugar `event_day = |gap z| > 3`, que se conoce en la apertura y marca el día posterior al reporte
  (y cualquier otro shock). Macro: `training/macro_calendar.csv` con las decisiones FOMC; el informe de
  empleo se aproxima como el primer viernes de cada mes.
- **Ticker**: categórico (`enable_categorical=True`, `tree_method="hist"`).

## Labels

Para h ∈ {5, 15, 30}: `r_h = ln(C_{t+h}/C_t)`, sin cruzar el cierre de sesión (NaN si t+h cae
fuera). Label 1 si `r_h > δ_h`, 0 si `r_h < −δ_h`; **las filas con |r_h| ≤ δ_h se excluyen**.
`δ_h = 0.25·σ_h`, σ_h de los 20 días previos por ticker.

## Entrenamiento y validación

- `XGBClassifier` por horizonte (`binary:logistic`, hist, early stopping).
- **Walk-forward por día**: ~8 folds mensuales; entrena con todo lo anterior, prueba el mes
  siguiente. Como las labels no cruzan sesiones, cortar por día completo basta para no filtrar.
- **Baselines** sobre el mismo test: clase mayoritaria, momentum `sign(ret_15)`, reversión
  `−sign(dist_vwap)`.
- **Umbral τ_h**: se elige sobre las predicciones fuera de muestra de los folds anteriores y se
  mide en el último. Métricas: precisión con |p − 0.5| ≥ τ, cobertura, intervalo de Wilson 95 %.
- **Compuerta** (en `meta.json`): `has_edge = true` solo si la cota inferior de Wilson del acierto
  confiado supera 50 % y al mejor baseline, con cobertura ≥ 10 %. Si no, el endpoint devuelve la
  probabilidad con `has_edge=false` y la UI dice «sin ventaja demostrada».
- `meta.json`: `feature_cols` (validado al cargar, como `load_1m_model`), τ_h, métricas por fold,
  baselines, métricas por hora del día, top 15 importancias.

Artefactos en `api/artifacts/1m_dir/` (`xgb_h5.joblib`, `xgb_h15.joblib`, `xgb_h30.joblib`,
`meta.json`). El subdirectorio evita que el glob `xgb_1m_*` de `/models-1m` los liste.

## Inferencia: `GET /signal-1m?ticker=`, `/signal-1m-score` y `/models-1m-dir`

Barras de hoy del ticker y del contexto + 20 días previos (para los z-scores por hora) + noticias
recientes → features de la **última barra real** → tres modelos. Respuesta:

```json
{
  "ticker": "NVDA", "as_of": "…", "last_close": 0.0,
  "horizons": [{"h": 5, "p_up": 0.57, "direction": "up", "confident": true,
                "tau": 0.06, "oos_precision": 0.56, "coverage": 0.24, "has_edge": true,
                "path_close": 0.0}],
  "note": "…~15 min de retraso (plan Starter)…"
}
```

`path_close = last_close·exp((2p − 1)·E|r_h|)` es un trazo indicativo para el overlay.

## Acierto real (en vivo)

Cada llamada a `/signal-1m` se guarda en Supabase `signals_1m` (ticker, as_of, h, p_up, confident,
anchor). `GET /signal-1m/score?ticker=&days=` resuelve el resultado con barras reales y reporta el
acierto en vivo, con y sin filtro de confianza, junto a los baselines. Mismo patrón que
`api/intraday_store.py` (no-op sin Supabase).

## Frontend

La leyenda de 1m del Trading Lab muestra por horizonte: dirección, probabilidad, «confiado /
se abstiene», `has_edge` y el acierto en vivo.

## CI

Paso nuevo en `.github/workflows/retrain.yml`, aislado como los demás (si falla no afecta al resto).

## Pruebas

- Las labels no cruzan el cierre; la banda muerta excluye filas.
- Sin fuga: las features en t no cambian si se alteran barras o noticias posteriores a t.
- Walk-forward: ningún día en train y test a la vez.
- Compuerta: `has_edge` es false si el modelo no supera al baseline.
- `feature_cols` desalineadas → error al cargar.
- Los tests existentes del modelo de 1m siguen verdes.
