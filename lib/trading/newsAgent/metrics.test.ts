import { describe, expect, it } from 'vitest';
import { analystSummary, earningsInfo, headlineId, mergeHeadlines, momentum, normalizeTitle, polygonSentiment } from './metrics';
import { NOW } from './fixtures';
import type { Candle } from '../marketData';
import type { Headline, RawHeadline } from './types';

const HOUR = 3_600_000;

const raw = (over: Partial<RawHeadline>): RawHeadline => ({
  title: 'Titular',
  url: 'https://example.com',
  source: 'Fuente',
  publishedAt: NOW - HOUR,
  origin: 'yahoo',
  ...over,
});

describe('mergeHeadlines', () => {
  it('une fuentes, quita duplicados y prefiere la versión de Polygon aunque llegue después', () => {
    const merged = mergeHeadlines(
      [
        [raw({ title: 'Apple’s Price Ahead of Earnings', origin: 'yahoo', publishedAt: NOW - HOUR })],
        [raw({ title: "Apple's price ahead of earnings!", origin: 'polygon', sentiment: 'positive', publishedAt: NOW - 2 * HOUR })],
        [raw({ title: 'Otra noticia', origin: 'google', publishedAt: NOW - 3 * HOUR })],
      ],
      NOW
    );

    expect(merged.map((item) => item.origin)).toEqual(['polygon', 'google']);
    expect(merged[0].sentiment).toBe('positive');
    expect(merged[0].id).toBe(headlineId(normalizeTitle("Apple's price ahead of earnings!")));
  });

  it('descarta lo de más de 24 h, ordena por fecha y respeta el tope', () => {
    const merged = mergeHeadlines(
      [[raw({ title: 'vieja', publishedAt: NOW - 25 * HOUR }), raw({ title: 'a', publishedAt: NOW - 3 * HOUR }), raw({ title: 'b', publishedAt: NOW - HOUR }), raw({ title: 'c', publishedAt: NOW - 2 * HOUR })]],
      NOW,
      2
    );
    expect(merged.map((item) => item.title)).toEqual(['b', 'c']);
  });

  it('un id estable por titular: el mismo texto da el mismo id', () => {
    expect(headlineId('apple sube')).toBe(headlineId('apple sube'));
    expect(headlineId('apple sube')).not.toBe(headlineId('apple baja'));
  });
});

describe('polygonSentiment', () => {
  const withSentiment = (sentiment?: Headline['sentiment']): Headline => ({ ...raw({ sentiment }), id: Math.random().toString() });

  it('cuenta y da un score neto de −100 a 100', () => {
    const headlines = ['positive', 'positive', 'positive', 'negative', 'neutral', undefined].map((s) => withSentiment(s as Headline['sentiment']));
    expect(polygonSentiment(headlines)).toEqual({ positive: 3, negative: 1, neutral: 1, score: 40 });
  });

  it('sin titulares con sentimiento devuelve null', () => {
    expect(polygonSentiment([withSentiment(undefined)])).toBeNull();
  });
});

describe('earningsInfo', () => {
  const earnings = { date: '2026-11-02', timing: 'tras el cierre' as const, eps: 1.98 };

  it('días hasta la fecha en el calendario de Nueva York', () => {
    expect(earningsInfo(earnings, NOW)).toEqual({ ...earnings, days: 21 });
  });

  it('a las 23:30 ET sigue contando desde el día ET, aunque en UTC ya sea mañana', () => {
    expect(earningsInfo(earnings, Date.UTC(2026, 9, 13, 3, 30))!.days).toBe(21);
  });

  it('sin fecha, null', () => {
    expect(earningsInfo(null, NOW)).toBeNull();
  });
});

describe('analystSummary', () => {
  const target = { target: 338.31, low: 245, high: 400, buy: 16, hold: 9, sell: 4 };

  it('consenso, reparto y distancia del objetivo al precio', () => {
    expect(analystSummary({ consensus: 'Hold', analysts: 29 }, target, 337.7)).toEqual({
      consensus: 'Hold',
      analysts: 29,
      buy: 16,
      hold: 9,
      sell: 4,
      target: 338.31,
      targetVsPrice: 0.2,
    });
  });

  it('sin precio no hay distancia; sin ninguna fuente, null', () => {
    expect(analystSummary(null, target, null)!.targetVsPrice).toBeNull();
    expect(analystSummary({ consensus: 'Buy', analysts: null }, null, 100)!.target).toBeNull();
    expect(analystSummary(null, null, 100)).toBeNull();
  });
});

describe('momentum', () => {
  const rising = (count: number): Candle[] =>
    Array.from({ length: count }, (_, i) => ({ time: i * 86400, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i, volume: 1 }));

  it('cambio a 1 y 5 días y RSI 14', () => {
    expect(momentum(rising(20))).toEqual({ change1d: 0.85, change5d: 4.39, rsi14: 100 });
  });

  it('con menos de 15 velas no hay RSI: null', () => {
    expect(momentum(rising(10))).toBeNull();
  });
});
