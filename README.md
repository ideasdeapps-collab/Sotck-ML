# 📈 Stock ML — Predicción (XGBoost) + Simulación de Escenarios (Monte Carlo)

Web app para **curvas de predicción de stocks** y **simulación de escenarios de riesgo**, con datos de **Polygon.io**. Diseñada para tu stack: **Next.js + Vercel** (frontend), **FastAPI** (API de ML) y **GitHub Actions** (reentrenamiento).

```
stock-ml/
├── training/
│   ├── train_xgb.py        # Entrena XGBoost con datos de Polygon + features técnicas
│   ├── backtest.py         # Backtesting walk-forward (predicho vs. real + estrategia)
│   └── seed_history.py     # Siembra inicial de forecasts en Supabase (18 tickers)
├── api/
│   ├── main.py             # API FastAPI: /predict /forecast /intraday /signals ...
│   ├── simulate.py         # Monte Carlo (GBM) → bandas P5–P95
│   ├── intraday.py         # Chartismo (S/R, estructura, breakouts) + price action
│   ├── signals.py          # Señales combinadas: XGBoost diario × estructura intradía
│   ├── polygon_client.py   # Cliente Polygon con rate-limit 5/min + caché (plan free)
│   ├── supabase_client.py  # Persistencia de forecasts en Supabase
│   ├── requirements.txt
│   ├── Dockerfile
│   └── artifacts/          # Modelos (.joblib) + metadatos + backtests (.json)
├── app/
│   ├── TabbedApp.tsx            # Contenedor de pestañas (une las 4 vistas)
│   ├── StockForecastChart.tsx   # Gráfica: histórico + predicción + escenarios
│   ├── BacktestChart.tsx        # Gráfica: predicciones PASADAS vs. reales
│   ├── IntradayChart.tsx        # Velas intradía + chartismo + price action
│   ├── SignalsTab.tsx           # 3ª pestaña: curva de señal + alertas + veredicto
│   └── Dashboard.tsx            # Tabla ordenable de los 18 tickers
├── supabase/
│   └── schema.sql          # Tablas forecast_runs / forecast_points + vista de precisión
├── .github/workflows/
│   ├── retrain.yml         # Reentrena + backtest + snapshot a Supabase (18 tickers)
│   └── signals-scan.yml    # Escaneo de señales en horario de mercado (free-tier safe)
└── .env.example
```

## 🎯 Tickers configurados

El workflow entrena y hace backtest de estos 18 símbolos (editables en `retrain.yml`):

`SNDK · SMH · AMAT · TSM · QQQ · NVDA · MU · XLI · AVGO · SPCX · KOID · BOTZ · IGV · ASML · META · SKHY · SOXX · IDGT`

## 🧠 Cómo funciona

| Capa | Qué hace |
|------|----------|
| **Predicción (XGBoost)** | Predice el retorno log del día siguiente con features técnicas (SMA, RSI, MACD, momentum, volatilidad). Se aplica de forma **recursiva** para construir la curva a N días. |
| **Simulación (Monte Carlo + GBM)** | Genera 10 000 trayectorias con Movimiento Browniano Geométrico usando μ y σ históricos → devuelve **bandas de probabilidad P5–P95 / P25–P75**. |

> La predicción da la trayectoria "esperada"; la simulación da el **rango de riesgo**. Juntas forman el abanico ejecutivo del gráfico.

## ✅ Tests

```bash
npm test          # vitest, solo las funciones puras del Lab
```

Cubren la aritmética que no puede fallar en silencio: P&L de largos y cortos y persistencia de la
cuenta simulada (`lib/trading/paperEngine.test.ts`), la política de decisión del copiloto
(`lib/trading/copilot/policy.test.ts`) y sus guardarraíles (`lib/trading/copilot/guardrails.test.ts`).

## 🚀 Puesta en marcha

### 1. Entrenar un modelo (local)
```bash
cd stock-ml
pip install -r api/requirements.txt
export POLYGON_API_KEY=tu_key        # en Windows: set POLYGON_API_KEY=...
python training/train_xgb.py --ticker AAPL --years 5
```
Genera `api/artifacts/xgb_AAPL.joblib` y `meta_AAPL.json`.

### 2. Levantar la API
```bash
cd api
uvicorn main:app --reload --port 8000
```
Abre **http://localhost:8000/docs** (Swagger) para probar los endpoints.

### 3. Frontend (Next.js)
```bash
npm install recharts
# copia app/StockForecastChart.tsx a tu proyecto Next.js
```
En `.env.local`:
```
NEXT_PUBLIC_ML_API_URL=http://localhost:8000
```
Usa el componente:
```tsx
import StockForecastChart from "@/components/StockForecastChart";
export default function Page() { return <StockForecastChart />; }
```

## ☁️ Despliegue en producción

- **API de ML → Render / Railway / Fly.io / Hugging Face Spaces** (usa el `Dockerfile`). Vercel Functions no es ideal para XGBoost por tamaño/tiempo.
- **Frontend → Vercel** (como ya lo usas). Apunta `NEXT_PUBLIC_ML_API_URL` a la URL pública de la API.
- **Reentrenamiento → GitHub Actions.** Guarda `POLYGON_API_KEY` en *Settings → Secrets*. El workflow corre cada lunes o manualmente (*Run workflow*).

## 🗄️ Histórico de forecasts en Supabase

1. **Crea las tablas:** copia `supabase/schema.sql` en *Supabase → SQL Editor → Run*. Crea `forecast_runs`, `forecast_points` y la vista `forecast_accuracy`.
2. **Configura el backend** con las credenciales (usa la *service_role key*, solo en el servidor):
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   ```
3. **Automático:** cada llamada a `/forecast` con `save:true` guarda una corrida. El endpoint `/backfill-actuals` rellena los precios reales de días ya ocurridos, para comparar.
4. **Grafica el pasado:** el componente `BacktestChart.tsx` (modo *Histórico Supabase*) dibuja predicción vs. real con la banda P5–P95.

> Si no configuras Supabase, la API sigue funcionando: el guardado simplemente se omite (no-op).

## 🔬 Backtesting

Mide qué tan bien habría acertado el modelo en el pasado (walk-forward, reentrenando periódicamente):

```bash
python training/backtest.py --ticker NVDA --years 5 --test-days 120
```
Genera `api/artifacts/backtest_NVDA.json` con:
- **Precisión direccional** (¿acierta el signo del movimiento?)
- **MAPE** del precio reconstruido
- **Estrategia** (largo si la predicción es positiva) vs. **Buy & Hold** + Sharpe
- Serie predicho vs. real para graficar (componente `BacktestChart.tsx`, modo *Backtest*)

## 📉 Curva intradía: chartismo + price action

Análisis intradía con barras por minuto de Polygon (`intraday.py` + componente `IntradayChart.tsx`):

**Chartismo (estructura de mercado):**
- Pivotes fractales (swing highs/lows) de 5 velas
- Niveles de **soporte y resistencia** por clustering de pivotes (con nº de toques = fuerza)
- **Estructura de tendencia**: alcista (HH/HL), bajista (LH/LL) o lateral
- **Breakouts** de S/R confirmados con volumen (≥1.5× el promedio)

**Price action (patrones de vela):**
- Martillo / Shooting Star (pin bars), Doji
- Envolvente alcista / bajista (engulfing)
- Estrella de la mañana / del atardecer (3 velas)

```bash
curl "http://localhost:8000/intraday?ticker=NVDA&interval=5&days=1"
```
El componente dibuja velas japonesas, líneas S/R, marcadores ▲▼◆ de patrones y ◯ de breakouts, más la etiqueta de tendencia y VWAP.

> ⚠️ Las barras intradía requieren un plan de Polygon con acceso a *minute aggregates*.

## 🔔 Señales combinadas (3ª pestaña)

Cruza el **sesgo diario de XGBoost** con la **estructura intradía** para generar alertas más robustas por *confluencia* (`signals.py` + `SignalsTab.tsx`):

- **Curva de señal:** score de confluencia por vela (EMA) — área verde/roja según sesgo.
- **Alertas de alta confianza:** cuando el intradía confirma el diario, ej. *"predicción alcista + breakout de resistencia con volumen"*. Se marcan como ✓ **alineada con diario**.
- **Veredicto:** STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL.

```bash
curl "http://localhost:8000/signals?ticker=NVDA&interval=15&days=2"
curl "http://localhost:8000/signals-scan"   # escanea los 18 (throttled)
```

### ⚙️ Ajustes para el PLAN GRATUITO de Polygon
El free tier permite **5 llamadas/min** y entrega datos con **15 min de retraso**. Todo está diseñado para no romper la cuota:

| Mecanismo | Detalle |
|-----------|---------|
| **Rate-limiter** (`polygon_client.py`) | Estrangula TODAS las llamadas a ≤5/min (ventana deslizante, thread-safe). Si llega un `429`, espera y reintenta. |
| **Caché por TTL** | Intradía 15 min (= el retraso del dato), diario 1 h. No se gastan llamadas de más. |
| **Intervalo 15 min por defecto** | No tiene sentido pedir menos: el dato viene diferido 15 min igual. |
| **Auto-refresh mínimo 15 min** | El frontend no deja refrescar más rápido. |
| **Escaneo espaciado** | `signals-scan.yml` recorre 1 ticker cada 15 s, solo en horario de mercado (13:30–20:00 UTC = 7:30–14:00 Morelia). |

> Con esto, un escaneo de los 18 tickers tarda unos minutos **por diseño**: prioriza no exceder la cuota. Si algún día quieres tiempo real, basta subir a un plan de pago; el código no cambia.

## 🧭 Dashboard de los 18 tickers

`Dashboard.tsx` (fuente `GET /dashboard`) muestra una **tabla ordenable** con, por ticker: precio, precisión direccional de backtest, MAPE, retorno de la estrategia vs. buy&hold, Sharpe y volatilidad. Clic en cualquier encabezado para ordenar.

## 🌱 Siembra inicial del histórico

Para que la gráfica de predicciones pasadas tenga datos desde el día uno:
```bash
python training/seed_history.py                    # los 18 tickers
python training/seed_history.py --tickers NVDA META --horizon 30
```
Genera un forecast por ticker, lo guarda en Supabase y rellena los precios reales.

## 🤖 Copiloto de paper trading (Trading Lab)

En `/trading`, el panel **Copiloto** se enciende con un click y a partir de ahí opera la cuenta
simulada por su cuenta, con los setups que el propio Lab ya calcula — no inventa ninguno:

- **De dónde salen las operaciones.** Del plan intradía (S/R, entrada, TP1/TP2, stop) y de la
  estrategia de mechas. Una zona de mecha *activa* — el precio está dentro de la zona de rechazo
  ahora mismo — manda sobre el plan. Elliott no genera operaciones: entra como contexto.
- **Tamaño.** `planTrade` (mismo 1 % de riesgo y R:R mínimo de 1.5 que `api/risk_manager.py`),
  recortado además a lo que el efectivo permite comprar.
- **Guardarraíles**, evaluados siempre y al final: nunca opera velas simuladas ni fuera de la sesión
  regular, una posición por ticker, tope de operaciones al día, pérdida máxima diaria (que **apaga**
  el copiloto), enfriamiento tras un stop y saldo suficiente.
- **Gestión.** Cierra en stop, TP1 o TP2, y anota cada operación en el diario de sesión.
- **Registro.** Todo lo que hace — y lo que descarta — queda escrito con sus razones.

Arranca siempre apagado: reabrir la pestaña no reactiva nada. La cuenta, los contadores del día y el
registro sí sobreviven a la recarga (`localStorage`).

### El veredicto de GPT (opcional)

Con `OPENAI_API_KEY` definida, cada operación pasa por GPT antes de ejecutarse. **El modelo no
propone precios**: recibe el setup ya cerrado y responde `approve` / `wait` / `reject` con una
confianza y una explicación, que quedan en el registro. Sin la clave el copiloto funciona igual, solo
con reglas, y lo dice en el panel.

La clave la lee únicamente el route handler `app/api/copilot` — sin prefijo `NEXT_PUBLIC_`, igual que
`ML_API_URL`, así que nunca llega al navegador. Se consulta **una vez por setup** (mientras los
niveles no se muevan es la misma operación), con un mínimo de 60 s entre llamadas, un tope por sesión
y caché de 5 min en el servidor: el gráfico refresca cada 15 s y sin ese control una sola sesión
abierta costaría miles de llamadas al día.

```bash
OPENAI_API_KEY=sk-...        # opcional
OPENAI_MODEL=gpt-4o-mini     # por defecto
```

⚠️ Cuenta simulada, con fines educativos. No es una recomendación de inversión.

## 🔌 Endpoints

| Método | Ruta | Cuerpo / Query | Devuelve |
|--------|------|----------------|----------|
| GET | `/health` | — | estado |
| GET | `/models` | — | tickers entrenados |
| POST | `/predict` | `{ticker, horizon}` | histórico + curva XGBoost |
| POST | `/simulate` | `{ticker, horizon, n_sims}` | bandas Monte Carlo |
| POST | `/forecast` | `{ticker, horizon, n_sims, save}` | **predicción + simulación** (+ guarda en Supabase) |
| GET | `/forecast-history` | `?ticker=NVDA&limit_runs=5` | corridas pasadas guardadas |
| POST | `/backfill-actuals` | `?ticker=NVDA&days=60` | rellena precios reales |
| GET | `/backtest` | `?ticker=NVDA` | resultado de backtest |
| GET | `/dashboard` | — | métricas de todos los tickers (tabla) |
| GET | `/intraday` | `?ticker=NVDA&interval=15&days=1` | **velas + chartismo + price action** |
| GET | `/signals` | `?ticker=NVDA&interval=15&days=2` | **señales combinadas** (curva + alertas + veredicto) |
| GET | `/signals-scan` | `?tickers=NVDA,META` | escaneo de watchlist (throttled) |
| GET | `/predict-1m` | `?ticker=NVDA&horizon=30` | **curva recursiva de 1 min** de los próximos minutos |
| GET | `/models-1m` | — | tickers con modelo de 1 min entrenado |

Ejemplo:
```bash
curl -X POST http://localhost:8000/forecast \
  -H "Content-Type: application/json" \
  -d '{"ticker":"NVDA","horizon":30,"n_sims":10000,"save":true}'
```

## ⏱️ Modelo de 1 minuto

Overlay **«Curva ML 1m (+30 min)»** del Trading Lab, solo en temporalidad 1m y solo para tickers
con modelo entrenado (`NVDA`, `QQQ`, `SNDK` por defecto).

Proyecta 30 minutos, no hasta el cierre: 390 pasos recursivos de retorno acotado se aplanan en una
recta sin información, y el bucle no cabría en el tiempo de respuesta del proxy.

**Dos cosas que el overlay dice en pantalla y conviene repetir aquí:** el plan Starter de Polygon
sirve datos con ~15 minutos de retraso, así que la curva arranca en un punto que ya es pasado; y a
un minuto la exactitud direccional ronda el 50 %. Es contexto de mercado, no una señal de entrada.

Entrenar otros tickers:
```bash
python training/train_xgb_1m.py --ticker AMD --days 60
```
O de forma permanente, añadiéndolos a `ONE_MIN_TICKERS` en `.github/workflows/retrain.yml`. El
overlay aparece solo para cualquier ticker que tenga artefacto: `/models-1m` lista el directorio.

## ⚠️ Aviso
Esta herramienta es para análisis y educación. Los mercados son estocásticos; **ningún modelo garantiza precios futuros**. Úsala como apoyo a la decisión, no como consejo de inversión.
