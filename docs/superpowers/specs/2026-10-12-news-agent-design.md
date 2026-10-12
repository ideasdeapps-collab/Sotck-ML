# Agente de noticias del Trading Lab

> Diseño acordado el 2026-10-12. Estado: aprobado en conversación, pendiente de revisión de esta spec.

## Problema

El Lab enseña precio, overlays técnicos y modelos, pero nada de **por qué** se mueve el ticker: no
hay noticias, ni contexto de earnings, analistas, ventas de directivos, geopolítica o humor del
mercado. Hoy, para eso hay que salir del Lab.

Lo que se quiere: un agente que, para el ticker seleccionado y **cada 5 minutos**, junte noticias y
datos de mercado de la web y de Polygon (plan Starter, clave ya configurada), y los resuma en un
**cuadro de texto bajo el gráfico**.

## Decisiones tomadas

- **Híbrido.** Los números salen de fuentes estructuradas y se calculan sin IA. GPT
  (`OPENAI_MODEL`, por defecto `gpt-4o-mini`, la misma clave que el copiloto) solo **redacta**:
  sentimiento, emoción dominante, resumen y riesgos, a partir de esos números y los titulares. Nunca
  inventa una cifra que el usuario no pueda comprobar en la línea de datos.
- **Solo lectura.** Un cuadro de texto entre el gráfico y la rejilla de paneles. No dibuja en el
  gráfico, no alimenta al copiloto, no guarda histórico.
- **Solo con el Lab abierto.** Lo dispara el navegador cada 5 min con la pestaña visible, y al
  cambiar de ticker. Sin cron ni Supabase.
- **Una sola ruta en el servidor** que recoge todo en paralelo y llama a GPT como mucho una vez.
  Descartado usar la herramienta `web_search` de OpenAI: ~25× más cara por consulta, 10–20 s de
  latencia y fuentes que no se controlan ni se pueden verificar.

## Fuera de alcance

Histórico en Supabase, marcadores de noticias en el gráfico, contexto para el copiloto, alertas,
varios tickers a la vez. Cualquiera de ellos es un cambio aparte.

## Diseño

### 1. Fuentes — `lib/trading/newsAgent/sources.ts` (nuevo)

Parsers puros, uno por fuente, con la convención de `lib/trading/liveQuote/sources.ts`: reciben el
JSON o el XML ya descargado y devuelven el dato o `null`; **nunca lanzan**. Las URLs se construyen
con funciones exportadas para que la ruta solo haga `fetch`.

| Bloque | Fuente | Qué se extrae |
|---|---|---|
| Noticias del ticker | Polygon `GET /v2/reference/news?ticker=X&order=desc&sort=published_utc&limit=20` (`POLYGON_API_KEY`) | título, editor, URL, `published_utc`, y del `insights[]` del ticker: `sentiment` y `sentiment_reasoning` |
| Noticias del ticker | RSS de Yahoo `feeds.finance.yahoo.com/rss/2.0/headline?s=X` y Google News `news.google.com/rss/search?q="X"+when:1d` (entre comillas: sin ellas cuela artículos de otras empresas) | título, enlace, `pubDate`, fuente |
| Geopolítica / macro | Google News RSS, consulta fija: `(geopolitical OR tariffs OR "Federal Reserve" OR sanctions) markets when:1d` | título, enlace, `pubDate`, fuente |
| Analistas | Nasdaq `api/analyst/X/ratings` y `api/analyst/X/targetprice` | `meanRatingType`, nº de analistas, compra/mantener/venta, precio objetivo medio, mínimo y máximo |
| Earnings | Nasdaq `api/analyst/X/earnings-date` | fecha, antes/después del cierre y BPA de consenso, leídos de `reportText` con regex |
| Directivos | Nasdaq `api/company/X/insider-trades?limit=10&type=ALL&sortColumn=lastDate&sortOrder=DESC` | compras/ventas a 3 meses (`numberOfTrades`), acciones netas a 3 meses, y las últimas 5 operaciones (nombre, cargo, fecha, tipo, acciones, precio) |
| Humor del mercado | Yahoo v8 chart de `^VIX` y `SPY` (`parseYahooChart` existente más `meta.chartPreviousClose`) | nivel y % de cambio del día |
| Momentum | `getCandles(X, '1d')` de `lib/trading/marketData.ts` en el servidor | % 1 día, % 5 días, RSI 14 (con `calculateIndicators`) |

El ticker se valida con `isValidTicker` antes de entrar en ninguna URL. Las peticiones a Nasdaq y
Yahoo llevan el mismo `User-Agent` de navegador que `/api/market/live-quote`; sin él Nasdaq no
responde. Cada `fetch` tiene un timeout de 5 s.

**Fear & Greed de CNN no se usa:** responde `418 I'm a teapot` a cualquier cliente que no sea un
navegador. El VIX y el SPY cubren ese papel.

### 2. Cálculo sin IA — `lib/trading/newsAgent/metrics.ts` (nuevo)

Funciones puras:

- `mergeHeadlines(lists, now)`: une Polygon, Yahoo y Google; descarta las de más de 24 h; elimina
  duplicados por título normalizado (minúsculas, sin puntuación ni sufijo «- Fuente»), dando
  prioridad a la versión de Polygon porque trae sentimiento; ordena por fecha descendente; máximo 20
  titulares de ticker y 6 de macro. Cada titular lleva un `id` estable (hash del título normalizado).
- `polygonSentiment(headlines)`: positivas, negativas, neutrales y score neto en [−100, 100].
- `earningsInfo(earnings, now)`: días hasta la fecha en calendario de Nueva York.
- `insiderSummary(insiders)`: compras y ventas a 3 meses y la operación más reciente.
- `analystSummary(ratings, target, price)`: consenso, reparto y distancia del objetivo al precio, en %.
- `momentum(candles)`: % 1 día, % 5 días y RSI 14.

Todo lo que falte sale como `null`, y el cuadro lo muestra como «n/d».

### 3. GPT — `lib/trading/newsAgent/llm.ts` (nuevo)

- `buildBrief(data, headlines, macro)`: objeto compacto con los números de la sección 2 y los
  titulares (título, fuente, hora y, si es de Polygon, su sentimiento). Sin cuerpos de artículo: los
  RSS no los traen y el coste se dispararía.
- Esquema JSON estricto, igual que `VERDICT_SCHEMA` en `/api/copilot`:
  `{ score: int −100..100, emotion: 'miedo'|'cautela'|'neutral'|'optimismo'|'euforia', summary: string, risks: string[] (2–4) }`.
- Prompt de sistema, en español: analista de mercado; solo puede usar los datos y titulares
  recibidos; cita los números; 3–4 frases; menciona la geopolítica solo si afecta al ticker o al
  mercado; sin disclaimers.
- `shouldAskLlm(previous, headlineIds, now)`: devuelve true si no hay resumen previo, si aparece
  algún titular cuyo id no estaba en la llamada anterior, o si el resumen tiene más de 60 min (para
  que no cite un VIX que ya no es). Si no, se reutiliza el resumen anterior.

### 4. Ruta — `app/api/news-agent/route.ts` (nuevo)

`GET /api/news-agent?ticker=X[&force=1]`

1. Valida el ticker.
2. Caché por ticker de 5 min. `force=1` se la salta solo si el último informe tiene más de 60 s
   (es el botón ↻).
3. Descarga todas las fuentes con `Promise.allSettled`. Cada fuente que falle añade un texto a
   `failures[]` y deja su bloque en `null`.
4. Calcula las métricas.
5. Si `shouldAskLlm` lo pide y hay `OPENAI_API_KEY`, llama a Chat Completions (timeout de 20 s,
   `json_schema` estricto). Hay un tope de **100 llamadas a GPT por día y por instancia**; al
   pasarlo, se reutiliza el último resumen y `llm.reason` lo explica.
6. Responde:

```ts
type NewsReport = {
  ticker: string;
  generatedAt: number;            // epoch ms
  llm: { ok: true; score: number; emotion: string; summary: string; risks: string[]; at: number; model: string }
     | { ok: false; reason: string };
  data: {
    price: number | null;
    polygon: { positive: number; negative: number; neutral: number; score: number } | null;
    analysts: { consensus: string; buy: number; hold: number; sell: number; target: number; targetVsPrice: number | null } | null;
    earnings: { date: string; timing: 'antes de apertura' | 'tras el cierre' | null; days: number; eps: number | null } | null;
    insiders: { buys3m: number; sells3m: number; netShares3m: number; latest: InsiderTrade[] } | null;
    market: { vix: number; vixChange: number; spyChange: number } | null;
    momentum: { change1d: number; change5d: number; rsi14: number } | null;
  };
  headlines: Headline[];          // ticker, ≤ 20
  macro: Headline[];              // geopolítica/macro, ≤ 6
  failures: string[];
};
```

Las cachés y el tope viven en memoria: en Vercel cada instancia lleva los suyos. Es aceptable, porque
el objetivo es que una pestaña abierta no gaste de más, no llevar una contabilidad exacta.

`maxDuration = 30`.

### 5. Cliente — `lib/trading/useNewsAgent.ts` y `components/trading/NewsAgentPanel.tsx` (nuevos)

- **Hook:** sondeo cada 5 min con la pestaña visible, consulta inmediata al cambiar de ticker o al
  volver a la pestaña, y protección contra dos cadenas de sondeo a la vez (el `inFlight` de
  `useLiveQuote`). `refresh()` llama con `force=1` y queda deshabilitado 60 s.
- **Panel:** se monta en `app/trading/page.tsx` entre `<ChartPanel />` y `.trading-grid`, a todo el
  ancho. Lee el ticker de `useTradingStore`. Contenido:
  1. Cabecera: `Agente de noticias · X · actualizado HH:MM ET · próxima en m:ss` y el botón ↻.
  2. Barra de sentimiento (−100..100) con la emoción dominante, ambos de GPT.
  3. Resumen de GPT, y debajo los riesgos y catalizadores como lista en línea.
  4. Línea de datos sin IA: earnings · analistas · insiders · VIX/SPY · momentum · Polygon %+/−.
  5. `<details>` con los titulares: hora ET, fuente, punto de sentimiento si viene de Polygon, y
     enlace (`target="_blank" rel="noopener noreferrer"`). Otro `<details>` para los de macro.
  6. Sin GPT, aviso `Sin resumen de GPT: <motivo>`; si hay `failures`, `Fuentes sin datos: …`.
- Estilos en `app/trading/trading.css`, con la paleta oscura del Lab.

### 6. Pruebas (vitest, sin red)

- `sources.test.ts`: cada parser contra respuestas reales recortadas (capturadas el 2026-10-12),
  más los casos de forma desconocida, `null` y HTML, que deben devolver `null`.
- `metrics.test.ts`: deduplicación entre fuentes con prioridad para Polygon, corte de 24 h, score de
  Polygon, días a earnings cruzando la medianoche ET, resumen de insiders y momentum.
- `llm.test.ts`: `shouldAskLlm` (sin previo, titular nuevo, mismos titulares, resumen de más de
  60 min) y validación de la respuesta de GPT: una emoción fuera del enum o un score fuera de rango
  se descartan.

## Verificación de extremo a extremo

1. `npx tsc --noEmit` y `npx vitest run` limpios.
2. `next dev` y `curl /api/news-agent?ticker=AAPL` (y NVDA, SPY, un ticker inexistente): todos los
   bloques rellenos o con su motivo en `failures`, y `llm.ok` true con `OPENAI_API_KEY`.
3. Una segunda llamada dentro de los 5 min sale de la caché y no llama a GPT.
4. Sin `OPENAI_API_KEY`, el informe sale con `llm.ok: false` y los datos completos.
5. Visual en el Lab desplegado: el cuadro bajo el gráfico, el refresco a los 5 min y el cambio de
   ticker.

## Riesgos

- Nasdaq, Yahoo y Google News son **endpoints no oficiales**: pueden cambiar o bloquear las IPs de
  Vercel. Cada uno degrada a «n/d» por separado y se ve en `failures`.
- GPT puede interpretar mal un titular. Por eso el resumen va junto a la línea de datos verificable
  y los titulares enlazados.
- El sentimiento de Polygon llega con el retraso de su feed de noticias, no en tiempo real.
