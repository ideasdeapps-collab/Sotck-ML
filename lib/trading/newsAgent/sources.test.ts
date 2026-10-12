import { describe, expect, it } from 'vitest';
import {
  parseDayChange,
  parseNasdaqEarnings,
  parseNasdaqInsiders,
  parseNasdaqRatings,
  parseNasdaqTarget,
  parsePolygonNews,
  parseRss,
} from './sources';
import {
  REGULAR_START,
  aaplPremarket,
  googleRss,
  nasdaqEarnings,
  nasdaqInsiders,
  nasdaqRatings,
  nasdaqTarget,
  polygonNews,
  yahooChart,
  yahooRss,
} from './fixtures';

describe('parsePolygonNews', () => {
  it('lee titular, editor, hora y el sentimiento hacia el ticker pedido', () => {
    const items = parsePolygonNews(polygonNews, 'aapl');
    expect(items).toHaveLength(2);
    expect(items![0]).toEqual({
      title: "Apple's Price Ahead of Earnings Looks Stretched",
      url: 'https://www.benzinga.com/a',
      source: 'Benzinga',
      publishedAt: Date.UTC(2026, 9, 12, 16),
      origin: 'polygon',
      sentiment: 'positive',
      reasoning: 'Demand beats estimates',
    });
  });

  it('sin insight para el ticker no inventa sentimiento', () => {
    expect(parsePolygonNews(polygonNews, 'AAPL')![1].sentiment).toBeUndefined();
  });

  it('una respuesta de error devuelve null', () => {
    expect(parsePolygonNews({ status: 'ERROR', error: 'bad key' }, 'AAPL')).toBeNull();
    expect(parsePolygonNews(null, 'AAPL')).toBeNull();
  });
});

describe('parseRss', () => {
  it('Yahoo: titular, enlace, hora y el dominio como fuente; descarta items sin fecha', () => {
    const items = parseRss(yahooRss, 'yahoo')!;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Apple’s Price Ahead of Earnings Looks Stretched',
      url: 'https://247wallst.com/investing/2026/10/12/apple/?.tsrc=rss',
      source: '247wallst.com',
      publishedAt: Date.UTC(2026, 9, 12, 17, 15, 56),
      origin: 'yahoo',
    });
    expect(items[1]).toMatchObject({ title: "Apple & AI: what's next", source: 'fool.com' });
  });

  it('Google: quita el sufijo « - Fuente» y decodifica entidades', () => {
    const items = parseRss(googleRss, 'google')!;
    expect(items[0]).toMatchObject({ title: 'New Apple TV Expected: What Matters for AAPL Stock', source: 'Yahoo Finance', origin: 'google' });
    expect(items[1]).toMatchObject({ title: "AT&T 'beats' on churn", source: 'Reuters' });
  });

  it('lo que no es RSS devuelve null', () => {
    expect(parseRss('<html><body>blocked</body></html>', 'yahoo')).toBeNull();
    expect(parseRss(null, 'google')).toBeNull();
  });
});

describe('Nasdaq', () => {
  it('consenso y número de analistas', () => {
    expect(parseNasdaqRatings(nasdaqRatings)).toEqual({ consensus: 'Hold', analysts: 29 });
    expect(parseNasdaqRatings({ data: null })).toBeNull();
  });

  it('precio objetivo y reparto compra/mantener/venta', () => {
    expect(parseNasdaqTarget(nasdaqTarget)).toEqual({ target: 338.31, low: 245, high: 400, buy: 16, hold: 9, sell: 4 });
    expect(parseNasdaqTarget({ data: { consensusOverview: { priceTarget: null } } })).toBeNull();
  });

  it('fecha de earnings, momento y BPA de consenso', () => {
    expect(parseNasdaqEarnings(nasdaqEarnings)).toEqual({ date: '2026-11-02', timing: 'tras el cierre', eps: 1.98 });

    const before = { data: { reportText: 'XYZ is expected* to report earnings on 01/28/2027 before market open. The consensus EPS forecast for the quarter is $-0.12.' } };
    expect(parseNasdaqEarnings(before)).toEqual({ date: '2027-01-28', timing: 'antes de apertura', eps: -0.12 });

    expect(parseNasdaqEarnings({ data: { reportText: 'Earnings date not available.' } })).toBeNull();
  });

  it('insiders: compras, ventas y acciones netas a 3 meses, y las últimas operaciones', () => {
    const activity = parseNasdaqInsiders(nasdaqInsiders)!;
    expect(activity).toMatchObject({ buys3m: 0, sells3m: 18, netShares3m: -676371 });
    expect(activity.latest[0]).toEqual({
      name: 'NEWSTEAD JENNIFER',
      relation: 'Officer',
      date: '10/06/2026',
      type: 'Automatic Sell',
      shares: 2399,
      price: 332.01,
    });
    expect(parseNasdaqInsiders({ data: null })).toBeNull();
  });

  it('una operación fuera de mercado (precio 0) queda sin precio', () => {
    const json = structuredClone(nasdaqInsiders);
    json.data.transactionTable.table.rows[0].lastPrice = '$0';
    expect(parseNasdaqInsiders(json)!.latest[0].price).toBeNull();
  });
});

describe('parseDayChange', () => {
  it('en premarket compara con el último cierre regular, no con el de anteayer', () => {
    const change = parseDayChange(aaplPremarket)!;
    expect(change.price).toBe(337.67);
    expect(change.change).toBeCloseTo((337.67 / 336.64 - 1) * 100, 6);
  });

  it('con la sesión regular abierta compara con el cierre anterior', () => {
    const json = yahooChart({ price: 342, time: REGULAR_START + 3600, regularMarketPrice: 342, regularMarketTime: REGULAR_START + 3600, previousClose: 336.64 });
    expect(parseDayChange(json)!.change).toBeCloseTo((342 / 336.64 - 1) * 100, 6);
  });

  it('forma desconocida devuelve null', () => {
    expect(parseDayChange({ chart: { result: null } })).toBeNull();
  });
});
