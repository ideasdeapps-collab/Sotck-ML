# XGBoost intradía de 1 minuto, como overlay del Trading Lab

> Diseño acordado el 2026-08-30. Estado: aprobado, pendiente de plan de implementación.

## Problema

El Lab tiene un modelo intradía de XGBoost, pero opera en barras de **15 minutos**
(`training/train_xgb_intraday.py`, `api/intraday_ml.py`, overlay `sessionCurve`). El gráfico, en
cambio, arranca en **1 minuto** y es la temporalidad en la que se mira de verdad — el plan intradía,
las mechas y el copiloto trabajan ahí. En 1m no hay ninguna curva predictiva: el overlay de sesión
aparece deshabilitado con *«Solo en 15m»*.

Lo que se quiere: un modelo propio de 1 minuto, entrenado con datos de Polygon del plan Starter,
expuesto como un overlay más del Lab.

## Lo que NO se va a hacer, y por qué

**No se predice hasta el cierre.** El modelo de 15m proyecta recursivamente hasta las 16:00 ET: 26
pasos como mucho. A un minuto serían **390**, con dos consecuencias que lo descartan:

- Cada paso de `_predict_session_from_bars` recalcula *todas* las features sobre el DataFrame
  completo, que además crece. Es cuadrático, y el proxy `/api/ml` corta a los 45 s.
- 390 retornos acotados por el clamp se encadenan en una recta con pendiente constante. El tramo
  lejano no contiene información; solo parece que sí.

**El horizonte es de 30 minutos** (parámetro `horizon`, tope 60). Es el mismo orden de magnitud de
pasos que el modelo de 15m ya sostiene, y es el plazo en el que una barra de un minuto tiene algo
que decir.

**No se toca el modelo de 15 minutos.** `BARS_PER_SESSION = 26` es una constante de módulo que
`api/intraday_ml.py` importa; parametrizarla obligaría a tocar un camino que hoy funciona y del que
dependen un endpoint, un overlay y el workflow de reentreno. El de 1 minuto vive aparte.

## Advertencia que el producto debe llevar encima

A un minuto, y con datos diferidos, **la exactitud direccional esperable ronda el 50 %**. El modelo
de 15m ya lo admite en su propia nota (`"Señal intradía débil (Dir.Acc ~50%); contexto, no
certeza."`). Esto es contexto de mercado, **no una señal de entrada**, y el overlay tiene que decirlo
donde se lee, no solo en un JSON.

El plan Starter de Polygon sirve **datos con ~15 minutos de retraso** (`env.example`). La curva
arranca donde acaban los datos disponibles, que no es el precio de ahora. Las velas del gráfico
vienen del mismo feed diferido, así que curva y velas están alineadas entre sí — lo que hay que
comunicar es que ese punto de partida ya es pasado.

---

## Diseño

### 1. Paginación en el cliente de Polygon

`api/polygon_client.py` gana `get_paginated(url, ttl, max_pages=20)`, que acumula `results` siguiendo
el `next_url` de la respuesta y añadiéndole la API key. Veinte páginas de 50 000 barras cubren de
sobra 60 días de un minuto; si se alcanza el tope, se registra un aviso en vez de devolver un recorte
callado.

No es un accesorio: hoy `get_json` con `limit=50000` **trunca en silencio**. 60 días de barras de un
minuto son ~23 000 de sesión regular, pero la respuesta cruda incluye premarket y after-hours y se
pasa del tope. Sin esto, el modelo se entrenaría con un recorte arbitrario y nadie se enteraría.

El tope de páginas evita que un `next_url` en bucle cuelgue un entrenamiento. Se respeta el
rate-limit y la caché existentes reutilizando `_throttle` y `_cache`.

### 2. Entrenamiento — `training/train_xgb_1m.py` (nuevo)

Módulo independiente, mismo esqueleto que `train_xgb_intraday.py`.

| | 15 minutos (existente) | 1 minuto (nuevo) |
|---|---|---|
| Barras por sesión | 26 | 390 |
| Ventana | 120 días | 60 días (~23 000 barras) |
| Target | `ln(C_{t+1}/C_t)` | igual |
| Artefactos | `xgb_intraday_{T}` | `xgb_1m_{T}`, `meta_1m_{T}` |
| Clamp | `sigma_15m` × K | `sigma_1m` × K |

Hiperparámetros idénticos (`n_estimators=300, max_depth=4, learning_rate=0.03`): no hay motivo para
inventar otros, y mantenerlos hace comparables las métricas de los dos modelos.

**Features.** Se conserva la familia de doce —hora del día en seno y coseno, barras restantes,
retorno desde la apertura, distancia al VWAP, rango relativo, volumen relativo, gap y retornos
rezagados— con dos cambios obligados por la granularidad:

- Los lags pasan de 4 a **5**. Cuatro barras de 15 minutos son una hora de memoria; cuatro de un
  minuto son cuatro minutos, que es ruido.
- Se añaden **`ret_5m` y `ret_15m`**, retornos agregados. Sin contexto de medio plazo el modelo solo
  ve microestructura, y a un minuto eso es casi todo ruido.

`meta_1m_{T}.json` guarda `feature_cols`, para que la inferencia no pueda usar otro orden.

### 3. Inferencia — `api/intraday_1m.py` (nuevo)

`predict_next_minutes(ticker, horizon=30)`:

1. Descarga las barras de 1 min de la última sesión regular disponible (paginado, TTL 60 s).
2. Proyecta `horizon` barras hacia delante, con el mismo clamp de ±K·σ.
3. Devuelve la curva y el contexto de la predicción.

**Features incrementales.** El bucle no recalcula el DataFrame entero por paso: mantiene
acumuladores de VWAP, media expansiva de volumen, apertura del día y los lags como valores sueltos.
Es lo que hace el endpoint viable.

El riesgo de esto está claro y es el que manda en la sección de pruebas: **dos definiciones de las
mismas features**. Si se separan, el modelo recibe entradas distintas de las que vio al entrenar y
sirve basura sin fallar. La defensa es un test de equivalencia, no la disciplina.

Respuesta:

```json
{
  "ticker": "NVDA",
  "session_date": "2026-08-28",
  "bars_real": 312,
  "horizon_min": 30,
  "last_real_close": 106.61,
  "last_real_time": "2026-08-28T15:12:00-04:00",
  "predicted": [{ "time": "...", "close": 106.7, "predicted": true }],
  "clamp": { "sigma_1m": 0.0004, "cap_per_bar": 0.0012, "bars_clamped": 0 },
  "model_meta": { "mae": 0.0003, "r2": 0.01, "directional_accuracy": 0.51 },
  "note": "Curva recursiva de 1 min a 30 minutos vista, acotada por clamp. Datos con ~15 min de retraso (plan Starter). Señal débil: contexto, no certeza."
}
```

Sin Elliott: el de 15m lo calcula y aquí no aporta — a 30 barras no hay estructura de ondas que
contar.

### 4. API y proxy

- `GET /predict-1m?ticker=NVDA&horizon=30` → `predict_next_minutes`. 404 si no hay artefacto, 400 en
  el resto, como `/predict-intraday`.
- `GET /models-1m` → `{"available": [...]}` listando `xgb_1m_*.joblib`, como `/models-intraday`.

En la allow-list de `app/api/ml/[...path]/route.ts`: `'predict-1m': 30` —es casi en vivo, y la TTL
del proxy no debe tapar el refresco— y `'models-1m': 300`, igual que sus hermanos.

### 5. Overlay

| Pieza | Cambio |
|---|---|
| `types/trading.ts` | Tipo `OneMinutePrediction`; `TickerCapabilities` gana `oneMinute` |
| `lib/trading/capabilities.ts` | Consulta también `/models-1m` |
| `lib/trading/mlApi.ts` | `fetchOneMinuteCurve(ticker, horizon)` |
| `lib/trading/overlays/registry.ts` | Fuente `'oneMinute'`; overlay `intraday1m` en «Curvas predictivas», `timeframes: ['1m']`, `capability: 'oneMinute'` |
| `lib/trading/overlays/remoteData.ts` | Su `case` |
| `lib/trading/overlays/paint.ts` | Línea discontinua desde la última vela real, misma forma que `sessionCurve` con otro color |
| `components/trading/ChartPanel.tsx` | Leyenda bajo la cabecera |

**La leyenda es parte del diseño, no un adorno.** Con el overlay encendido aparece una línea con la
hora de la última barra real, el horizonte, la exactitud direccional del modelo y el aviso del
retraso del plan Starter. Reutiliza el patrón de `elliottLegend`, que ya resuelve exactamente esto
para el oscilador de Elliott.

El gating existente hace el resto: en cualquier temporalidad que no sea 1m el toggle sale
deshabilitado con su motivo, y en un ticker sin artefacto entrenado, con *«Sin modelo entrenado para
este ticker»*.

### 6. Reentreno

Paso nuevo en `.github/workflows/retrain.yml`, con la forma de los que ya hay:

```yaml
ONE_MIN_TICKERS: "NVDA QQQ SNDK"
ONE_MIN_DAYS: 60
```

**Entrenar más tickers**, en orden de menos a más permanente:

1. En local: `python training/train_xgb_1m.py --ticker AMD --days 60`
2. A mano desde Actions: el workflow ya acepta `tickers` como input.
3. Permanente: añadirlo a `ONE_MIN_TICKERS` en `retrain.yml`.

El overlay aparece solo para cualquier ticker que tenga artefacto, porque `/models-1m` lista el
directorio. No hay ninguna lista que mantener en el frontend.

### 7. Pruebas

Se añade **pytest** a `api/requirements.txt` — primer test de Python del repo, acotado a lo puro,
con el mismo criterio que se aplicó a vitest: solo donde un fallo sería silencioso.

| Test | Qué protege |
|---|---|
| Equivalencia de features | Que las incrementales de `intraday_1m.py` coincidan con `add_intraday_features` sobre las mismas barras. **Es el test que justifica la optimización.** |
| Paginación | Que `get_paginated` siga `next_url`, acumule y pare en el tope, con respuestas simuladas |
| Clamp | Que un retorno disparado se acote a ±K·σ y quede contado en `bars_clamped` |
| Horizonte | Que `horizon` se respete y se limite a 60 |

Del lado TS no hacen falta pruebas nuevas: el overlay es una fuente más en un registro que ya está
cubierto por su gating.

## Verificación de extremo a extremo

1. `python training/train_xgb_1m.py --ticker NVDA --days 60` produce artefactos y una métrica de
   exactitud direccional. **Si sale muy por encima del 55 %, sospechar de fuga de datos antes que
   celebrarlo**: el target es el retorno de la barra siguiente y es fácil colarlo en una feature.
2. `uvicorn main:app` y `curl '/predict-1m?ticker=NVDA'` devuelve 30 puntos; `/models-1m` lista los
   tres tickers.
3. `curl '/predict-1m?ticker=AAPL'` devuelve 404 con instrucciones, no un 500.
4. En `/trading`, NVDA en 1m: el overlay se enciende y dibuja la curva desde la última vela; la
   leyenda muestra hora, horizonte, exactitud y el aviso de retraso.
5. En 5m el toggle sale deshabilitado con *«Solo en 1m»*; en un ticker sin modelo, con *«Sin modelo
   entrenado para este ticker»*.
6. `pytest`, `npm test`, `npx tsc --noEmit` y `npm run build`.
7. Medir el tiempo de `/predict-1m`: tiene que quedarse holgadamente por debajo de los 45 s del
   proxy. Si no, el horizonte o el enfoque incremental están mal.
