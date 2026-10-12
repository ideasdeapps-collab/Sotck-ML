/**
 * Respuestas reales recortadas (AAPL, premarket del 12-oct-2026), compartidas
 * por los tests de parsers y del informe. Polygon es la excepción: sin clave en
 * local, su forma sale de la documentación de `/v2/reference/news` y de
 * `api/sentiment.py`, que ya la consume.
 */

export const NOW = Date.UTC(2026, 9, 12, 18, 0); // 14:00 ET

export const polygonNews = {
  status: 'OK',
  results: [
    {
      id: 'p1',
      title: "Apple's Price Ahead of Earnings Looks Stretched",
      article_url: 'https://www.benzinga.com/a',
      published_utc: '2026-10-12T16:00:00Z',
      publisher: { name: 'Benzinga' },
      insights: [
        { ticker: 'AAPL', sentiment: 'positive', sentiment_reasoning: 'Demand beats estimates' },
        { ticker: 'MSFT', sentiment: 'neutral' },
      ],
    },
    {
      id: 'p2',
      title: 'Chip stocks slide as memory costs climb',
      article_url: 'https://www.reuters.com/b',
      published_utc: '2026-10-12T15:00:00Z',
      publisher: { name: 'Reuters' },
      insights: [{ ticker: 'NVDA', sentiment: 'negative' }],
    },
    { id: 'p3', title: '', article_url: 'https://example.com/c', published_utc: '2026-10-12T14:00:00Z' },
  ],
};

export const yahooRss = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0"><channel><title>Yahoo! Finance: AAPL News</title>
<item>
  <description>Apple beat earnings eight times in a row.</description>
  <link>https://247wallst.com/investing/2026/10/12/apple/?.tsrc=rss</link>
  <pubDate>Mon, 12 Oct 2026 17:15:56 +0000</pubDate>
  <title>Apple’s Price Ahead of Earnings Looks Stretched</title>
</item>
<item>
  <link>https://www.fool.com/a</link>
  <pubDate>Mon, 12 Oct 2026 16:30:00 +0000</pubDate>
  <title><![CDATA[Apple & AI: what's next]]></title>
</item>
<item><link>https://x.com/b</link><title>Sin fecha</title></item>
</channel></rss>`;

export const googleRss = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>"AAPL stock when:1d" - Google News</title><item><title>New Apple TV Expected: What Matters for AAPL Stock - Yahoo Finance</title><link>https://news.google.com/rss/articles/CBMi?oc=5</link><guid isPermaLink="false">CBMi</guid><pubDate>Mon, 12 Oct 2026 15:16:12 GMT</pubDate><description>&lt;a href="https://news.google.com/x"&gt;New Apple TV&lt;/a&gt;</description><source url="https://finance.yahoo.com">Yahoo Finance</source></item><item><title>AT&amp;T &#39;beats&#39; on churn - Reuters</title><link>https://news.google.com/rss/articles/CBMj?oc=5</link><pubDate>Mon, 12 Oct 2026 14:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;

export const macroRss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><title>Markets wobble as Taiwan Strait tensions flare - Bloomberg</title><link>https://news.google.com/rss/articles/CBMk</link><pubDate>Mon, 12 Oct 2026 16:45:00 GMT</pubDate><source url="https://www.bloomberg.com">Bloomberg</source></item></channel></rss>`;

export const nasdaqRatings = {
  data: {
    symbol: 'aapl',
    meanRatingType: 'Hold',
    ratingsSummary: "Based on 29 analysts offering recommendations for 'AAPL'.",
    upgradesDowngrades: [],
    brokerNames: ['B OF A GLBL RES', 'BAIRD R W'],
  },
  status: { rCode: 200 },
};

export const nasdaqTarget = {
  data: {
    symbol: 'aapl',
    consensusOverview: { lowPriceTarget: 245.0, highPriceTarget: 400.0, priceTarget: 338.31, buy: 16, sell: 4, hold: 9 },
  },
  status: { rCode: 200 },
};

export const nasdaqEarnings = {
  data: {
    reportText:
      "Apple Inc. Common Stock is expected* to report earnings on  11/02/2026 after market close.  The report will be for the fiscal Quarter ending Sep 2026.  According to Zacks Investment Research, based on  8 analysts'  forecasts, the consensus EPS forecast for the quarter is $1.98.  The reported EPS for the same quarter last year was $1.85.",
    heading: 'AAPL Earnings Date',
  },
  status: { rCode: 200 },
};

export const nasdaqInsiders = {
  data: {
    numberOfTrades: {
      rows: [
        { insiderTrade: 'Number of Open Market Buys', months3: '0', months12: '0' },
        { insiderTrade: 'Number of Sells', months3: '18', months12: '41' },
        { insiderTrade: 'Total Insider Trades', months3: '18', months12: '41' },
      ],
    },
    numberOfSharesTraded: {
      rows: [
        { insiderTrade: 'Number of Shares Bought', months3: '0', months12: '0' },
        { insiderTrade: 'Number of Shares Sold', months3: '676,371', months12: '1,357,575' },
        { insiderTrade: 'Net Activity', months3: '(676,371)', months12: '(1,357,575)' },
      ],
    },
    transactionTable: {
      totalRecords: '110',
      table: {
        rows: [
          { insider: 'NEWSTEAD JENNIFER', relation: 'Officer', lastDate: '10/06/2026', transactionType: 'Automatic Sell', ownType: 'Direct', sharesTraded: '2,399', lastPrice: '$332.01', sharesHeld: '39,593' },
          { insider: 'TERNUS JOHN', relation: 'Officer', lastDate: '10/02/2026', transactionType: 'Automatic Sell', ownType: 'Direct', sharesTraded: '25,412', lastPrice: '$331.38', sharesHeld: '59,567' },
        ],
      },
    },
  },
  status: { rCode: 200 },
};

/** Inicio de la sesión regular del 12-oct-2026 (09:30 ET). */
export const REGULAR_START = Date.UTC(2026, 9, 12, 13, 30) / 1000;

/** Yahoo v8 chart en premarket: la última barra es de hoy, el cierre regular es del viernes. */
export function yahooChart(over: { price: number; time: number; regularMarketPrice: number; regularMarketTime: number; previousClose: number }) {
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: over.regularMarketPrice,
            regularMarketTime: over.regularMarketTime,
            previousClose: over.previousClose,
            chartPreviousClose: over.previousClose,
            currentTradingPeriod: { regular: { start: REGULAR_START, end: REGULAR_START + 6.5 * 3600 } },
          },
          timestamp: [over.time - 60, over.time],
          indicators: { quote: [{ close: [over.price, over.price] }] },
        },
      ],
      error: null,
    },
  };
}

/** Premarket: 08:15 ET de hoy; el último cierre regular es el viernes a las 16:00 ET. */
export const aaplPremarket = yahooChart({
  price: 337.67,
  time: 1791807327,
  regularMarketPrice: 336.64,
  regularMarketTime: 1791576000,
  previousClose: 340.42,
});

export const vixChart = yahooChart({ price: 18.4, time: 1791576000, regularMarketPrice: 18.4, regularMarketTime: 1791576000, previousClose: 17.36 });
export const spyChart = yahooChart({ price: 777.0, time: 1791807327, regularMarketPrice: 779.34, regularMarketTime: 1791576000, previousClose: 780.0 });

export const llmOk = {
  score: 32,
  emotion: 'optimismo',
  summary: 'Apple sube en premarket; Polygon marca la noticia principal como positiva.',
  risks: ['Earnings en 21 días', 'Ventas de insiders'],
};
