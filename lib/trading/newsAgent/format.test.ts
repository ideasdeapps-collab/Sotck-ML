import { describe, expect, it } from 'vitest';
import { countdown, dataLine } from './format';
import type { NewsData } from './types';

const empty: NewsData = { price: null, polygon: null, analysts: null, earnings: null, insiders: null, market: null, momentum: null };

describe('dataLine', () => {
  it('resume cada bloque con sus números', () => {
    const line = dataLine({
      price: 337.7,
      polygon: { positive: 7, negative: 2, neutral: 1, score: 50 },
      analysts: { consensus: 'Hold', analysts: 29, buy: 16, hold: 9, sell: 4, target: 338.31, targetVsPrice: 0.2 },
      earnings: { date: '2026-11-02', timing: 'tras el cierre', eps: 1.98, days: 21 },
      insiders: { buys3m: 0, sells3m: 18, netShares3m: -676371, latest: [] },
      market: { vix: 18.4, vixChange: 6.02, spyChange: -0.3 },
      momentum: { change1d: 0.86, change5d: 2.1, rsi14: 58.2 },
    });

    expect(line).toEqual([
      'Earnings 02-nov tras el cierre (en 21 d) · BPA est. $1.98',
      'Analistas Hold (16C/9M/4V) · obj. $338.31 (+0.2%)',
      'Insiders 3m: 0 compras / 18 ventas',
      'VIX 18.4 (+6.0%) · SPY -0.3%',
      'Momentum 1d +0.9% · 5d +2.1% · RSI 58',
      'Polygon 7+ / 2− / 1=',
    ]);
  });

  it('lo que falta sale como n/d', () => {
    expect(dataLine(empty)).toEqual(['Earnings n/d', 'Analistas n/d', 'Insiders n/d', 'VIX n/d', 'Momentum n/d', 'Polygon n/d']);
  });

  it('earnings de hoy y sin momento conocido', () => {
    const line = dataLine({ ...empty, earnings: { date: '2026-10-12', timing: null, eps: null, days: 0 } });
    expect(line[0]).toBe('Earnings 12-oct (hoy)');
  });
});

describe('countdown', () => {
  it('m:ss y nunca negativo', () => {
    expect(countdown(65_000)).toBe('1:05');
    expect(countdown(-5)).toBe('0:00');
  });
});
