import { parseYahooChart } from '../liveQuote/sources';
import type {
  AnalystRatings,
  DayChange,
  EarningsDate,
  HeadlineOrigin,
  InsiderActivity,
  PriceTarget,
  RawHeadline,
  Sentiment,
} from './types';

/**
 * Fuentes del agente de noticias: URLs y parsers puros.
 *
 * Misma convención que `lib/trading/liveQuote/sources.ts`: cada parser recibe
 * lo ya descargado y devuelve el dato o null, nunca lanza. Nasdaq, Yahoo y
 * Google News son endpoints no oficiales; una forma que no se reconoce degrada
 * ese bloque a «n/d» y el resto del informe sale igual.
 */

const NASDAQ = 'https://api.nasdaq.com/api';

export const MACRO_QUERY = '(geopolitical OR tariffs OR "Federal Reserve" OR sanctions) markets when:1d';

export const newsUrls = {
  polygon: (ticker: string, apiKey: string) =>
    `https://api.polygon.io/v2/reference/news?ticker=${encodeURIComponent(ticker)}&order=desc&sort=published_utc&limit=20&apiKey=${encodeURIComponent(apiKey)}`,
  yahooRss: (ticker: string) =>
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
  googleRss: (query: string) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
  /** Entre comillas: sin ellas «AAPL stock» trae artículos de dividendos de otras empresas. */
  tickerQuery: (ticker: string) => `"${ticker}" when:1d`,
  ratings: (ticker: string) => `${NASDAQ}/analyst/${encodeURIComponent(ticker)}/ratings`,
  target: (ticker: string) => `${NASDAQ}/analyst/${encodeURIComponent(ticker)}/targetprice`,
  earnings: (ticker: string) => `${NASDAQ}/analyst/${encodeURIComponent(ticker)}/earnings-date`,
  insiders: (ticker: string) =>
    `${NASDAQ}/company/${encodeURIComponent(ticker)}/insider-trades?limit=10&type=ALL&sortColumn=lastDate&sortOrder=DESC`,
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** "18" -> 18, "(676,371)" -> -676371, "$332.01" -> 332.01; lo demás, null. */
function nasdaqNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const number = Number(raw.replace(/[(),$\s]/g, ''));
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

const SENTIMENTS: Sentiment[] = ['positive', 'negative', 'neutral'];

/** Polygon `/v2/reference/news`: el sentimiento viene por ticker en `insights[]`. */
export function parsePolygonNews(json: any, ticker: string): RawHeadline[] | null {
  const results = json?.results;
  if (!Array.isArray(results)) return null;

  const symbol = ticker.toUpperCase();

  return results.flatMap((item: any): RawHeadline[] => {
    const title = text(item?.title);
    const url = text(item?.article_url);
    const publishedAt = Date.parse(item?.published_utc);
    if (!title || !url || !Number.isFinite(publishedAt)) return [];

    const insight = (Array.isArray(item.insights) ? item.insights : []).find(
      (entry: any) => String(entry?.ticker ?? '').toUpperCase() === symbol
    );
    const sentiment = SENTIMENTS.includes(insight?.sentiment) ? (insight.sentiment as Sentiment) : undefined;

    return [
      {
        title,
        url,
        source: text(item.publisher?.name) || 'Polygon',
        publishedAt,
        origin: 'polygon',
        ...(sentiment ? { sentiment } : {}),
        ...(sentiment && text(insight.sentiment_reasoning) ? { reasoning: text(insight.sentiment_reasoning) } : {}),
      },
    ];
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * RSS 2.0 de Yahoo Finance y Google News, con regex: en el servidor no hay
 * DOMParser y los dos feeds son planos. Google añade « - Fuente» al titular y
 * trae la fuente en `<source>`; Yahoo no la trae y se usa el dominio del enlace.
 */
export function parseRss(xml: unknown, origin: Exclude<HeadlineOrigin, 'polygon'>): RawHeadline[] | null {
  if (typeof xml !== 'string' || !xml.includes('<rss')) return null;

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.flatMap((item): RawHeadline[] => {
    const tag = (name: string) => {
      const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item);
      return match ? decodeXml(match[1].trim()).trim() : '';
    };

    let title = tag('title');
    const url = tag('link');
    const publishedAt = Date.parse(tag('pubDate'));
    let source = tag('source');

    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    if (!source) source = (origin === 'yahoo' && hostOf(url)) || (origin === 'yahoo' ? 'Yahoo Finance' : 'Google News');

    if (!title || !url || !Number.isFinite(publishedAt)) return [];
    return [{ title, url, source, publishedAt, origin }];
  });
}

export function parseNasdaqRatings(json: any): AnalystRatings | null {
  const consensus = text(json?.data?.meanRatingType);
  if (!consensus) return null;

  const count = /Based on (\d+) analysts/.exec(String(json.data.ratingsSummary ?? ''))?.[1];
  return { consensus, analysts: count ? Number(count) : null };
}

export function parseNasdaqTarget(json: any): PriceTarget | null {
  const overview = json?.data?.consensusOverview;
  const target = Number(overview?.priceTarget);
  if (!overview || overview.priceTarget == null || !Number.isFinite(target) || target <= 0) return null;

  const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

  return {
    target,
    low: count(overview.lowPriceTarget),
    high: count(overview.highPriceTarget),
    buy: count(overview.buy),
    hold: count(overview.hold),
    sell: count(overview.sell),
  };
}

/** El dato va en prosa dentro de `reportText`; se extrae con regex. */
export function parseNasdaqEarnings(json: any): EarningsDate | null {
  const report = String(json?.data?.reportText ?? '');
  const date = /earnings on\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(report);
  if (!date) return null;

  const [, month, day, year] = date;
  const timing = /after market close/i.test(report)
    ? 'tras el cierre'
    : /before market open/i.test(report)
      ? 'antes de apertura'
      : null;
  const eps = /consensus EPS forecast for the quarter is \$\s?(-?\d+(?:\.\d+)?)/.exec(report)?.[1];

  return { date: `${year}-${month}-${day}`, timing, eps: eps === undefined ? null : Number(eps) };
}

export function parseNasdaqInsiders(json: any): InsiderActivity | null {
  const data = json?.data;
  const trades: any[] = data?.numberOfTrades?.rows ?? [];
  const shares: any[] = data?.numberOfSharesTraded?.rows ?? [];

  const row = (rows: any[], label: string) => nasdaqNumber(rows.find((entry) => entry?.insiderTrade === label)?.months3);

  const buys3m = row(trades, 'Number of Open Market Buys');
  const sells3m = row(trades, 'Number of Sells');
  if (buys3m === null || sells3m === null) return null;

  const latest = (data?.transactionTable?.table?.rows ?? []).slice(0, 5).map((entry: any) => ({
    name: text(entry?.insider),
    relation: text(entry?.relation),
    date: text(entry?.lastDate),
    type: text(entry?.transactionType),
    shares: nasdaqNumber(entry?.sharesTraded) ?? 0,
    // Las operaciones fuera de mercado (donaciones, entregas por impuestos) vienen con precio 0.
    price: nasdaqNumber(entry?.lastPrice) || null,
  }));

  return { buys3m, sells3m, netShares3m: row(shares, 'Net Activity') ?? 0, latest };
}

/**
 * Último precio (con pre y post-market) y su cambio del día.
 *
 * Antes de que abra la sesión de hoy, `regularMarketPrice` es el cierre de ayer
 * y `previousClose` el de anteayer: el cambio de premarket se mide contra el
 * primero. Con la sesión ya abierta, contra el segundo.
 */
export function parseDayChange(json: any): DayChange | null {
  const quote = parseYahooChart(json);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!quote || !meta) return null;

  const sessionStart = Number(meta.currentTradingPeriod?.regular?.start);
  const beforeOpen = Number.isFinite(sessionStart) && Number(meta.regularMarketTime) < sessionStart;
  const base = Number(beforeOpen ? meta.regularMarketPrice : (meta.previousClose ?? meta.chartPreviousClose));

  if (!Number.isFinite(base) || base <= 0) return null;
  return { price: quote.price, change: (quote.price / base - 1) * 100 };
}
