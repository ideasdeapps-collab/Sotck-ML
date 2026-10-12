import { describe, expect, it } from 'vitest';
import { isValidTicker, parseNasdaqQuote, parseNasdaqTimestamp, parseYahooChart, yahooSymbol } from './sources';

/**
 * Respuestas reales recortadas (AAPL, premarket del 12-oct-2026). Sin red: si
 * Yahoo o Nasdaq cambian el formato, lo que se rompe es la ruta en producción,
 * no estos tests — por eso cada parser devuelve null en lugar de lanzar.
 */

const yahoo = {
  chart: {
    result: [
      {
        meta: { symbol: 'AAPL', regularMarketPrice: 336.64, regularMarketTime: 1791576000, currency: 'USD' },
        timestamp: [1791807120, 1791807180, 1791807240, 1791807327],
        indicators: { quote: [{ close: [337.7, 337.73, 337.76, 337.67] }] },
      },
    ],
    error: null,
  },
};

const nasdaq = {
  data: {
    symbol: 'AAPL',
    primaryData: {
      lastSalePrice: '$337.70',
      lastTradeTimestamp: 'Oct 12, 2026 8:15 AM ET',
      isRealTime: true,
    },
    secondaryData: { lastSalePrice: '$336.64', lastTradeTimestamp: 'Closed at Oct 9, 2026 4:00 PM ET', isRealTime: false },
    marketStatus: 'Pre-Market',
  },
  status: { rCode: 200 },
};

describe('parseYahooChart', () => {
  it('usa la última barra con cierre, que incluye pre y post-market', () => {
    expect(parseYahooChart(yahoo)).toEqual({ price: 337.67, time: 1791807327, source: 'yahoo' });
  });

  it('salta los cierres nulos del final', () => {
    const json = structuredClone(yahoo);
    json.chart.result[0].timestamp.push(1791807400);
    (json.chart.result[0].indicators.quote[0].close as (number | null)[]).push(null);
    expect(parseYahooChart(json)?.time).toBe(1791807327);
  });

  it('sin barras recurre al precio de la sesión regular', () => {
    const json = structuredClone(yahoo);
    json.chart.result[0].timestamp = [];
    json.chart.result[0].indicators.quote[0].close = [];
    expect(parseYahooChart(json)).toEqual({ price: 336.64, time: 1791576000, source: 'yahoo' });
  });

  it('un símbolo inexistente o una forma desconocida devuelven null', () => {
    expect(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } })).toBeNull();
    expect(parseYahooChart('<html>')).toBeNull();
    expect(parseYahooChart(null)).toBeNull();
  });
});

describe('parseNasdaqQuote', () => {
  it('lee el último precio y su hora ET', () => {
    expect(parseNasdaqQuote(nasdaq)).toEqual({
      price: 337.7,
      // 08:15 ET en horario de verano = 12:15 UTC
      time: Date.UTC(2026, 9, 12, 12, 15) / 1000,
      source: 'nasdaq',
    });
  });

  it('"Symbol not exists" devuelve null', () => {
    expect(parseNasdaqQuote({ data: null, status: { rCode: 400 } })).toBeNull();
  });

  it('un precio ilegible devuelve null', () => {
    const json = structuredClone(nasdaq);
    json.data.primaryData.lastSalePrice = 'N/A';
    expect(parseNasdaqQuote(json)).toBeNull();
  });
});

describe('parseNasdaqTimestamp', () => {
  it('acepta el prefijo "Closed at" y la tarde', () => {
    expect(parseNasdaqTimestamp('Closed at Oct 9, 2026 4:00 PM ET')).toBe(Date.UTC(2026, 9, 9, 20, 0) / 1000);
  });

  it('las 12 AM son medianoche y las 12 PM mediodía', () => {
    expect(parseNasdaqTimestamp('Jan 5, 2026 12:30 PM ET')).toBe(Date.UTC(2026, 0, 5, 17, 30) / 1000);
    expect(parseNasdaqTimestamp('Jan 5, 2026 12:30 AM ET')).toBe(Date.UTC(2026, 0, 5, 5, 30) / 1000);
  });

  it('un texto irreconocible devuelve null', () => {
    expect(parseNasdaqTimestamp('ayer')).toBeNull();
  });
});

describe('tickers', () => {
  it('solo deja pasar símbolos con forma de ticker', () => {
    expect(isValidTicker('AAPL')).toBe(true);
    expect(isValidTicker('BRK.B')).toBe(true);
    expect(isValidTicker('aapl')).toBe(false);
    expect(isValidTicker('AAPL/../x')).toBe(false);
    expect(isValidTicker('')).toBe(false);
  });

  it('Yahoo escribe las clases de acción con guion', () => {
    expect(yahooSymbol('BRK.B')).toBe('BRK-B');
  });
});
