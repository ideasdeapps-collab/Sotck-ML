import { describe, expect, it } from 'vitest';
import { check, dailyLossReached, type GuardrailContext } from './guardrails';
import { DEFAULT_CONFIG } from './store';
import type { CopilotProposal } from './types';

/** 2026-08-28 (viernes) a las 10:00 ET — sesión regular, en horario de verano. */
const REGULAR = Math.floor(Date.UTC(2026, 7, 28, 14, 0) / 1000);
const PREMARKET = Math.floor(Date.UTC(2026, 7, 28, 11, 0) / 1000);
const AFTERHOURS = Math.floor(Date.UTC(2026, 7, 28, 21, 0) / 1000);

const proposal: CopilotProposal = {
  ticker: 'NVDA',
  timeframe: '5m',
  source: 'plan',
  direction: 'long',
  entryType: 'retroceso a soporte',
  entry: [99.5, 100.5],
  entryMid: 100,
  stopLoss: 98,
  takeProfit: [104, 108],
  riskReward: 2,
  lastPrice: 100,
  shares: 50,
  riskAmount: 100,
  checklist: [],
  reasons: [],
  hash: 'plan|long|100.00|98.00|104.00',
};

function context(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    config: { ...DEFAULT_CONFIG },
    dataSource: 'polygon',
    candleTime: REGULAR,
    balance: 100000,
    hasOpenPosition: false,
    tradesToday: 0,
    realisedToday: 0,
    capital: 100000,
    lastStopAt: null,
    now: Date.UTC(2026, 7, 28, 14, 0),
    ...overrides,
  };
}

describe('check', () => {
  it('lets a clean setup through', () => {
    expect(check(proposal, context())).toEqual([]);
  });

  it('never operates on simulated candles', () => {
    expect(check(proposal, context({ dataSource: 'demo' }))[0]).toMatch(/simuladas/i);
  });

  it('accepts cached and stale Polygon data', () => {
    expect(check(proposal, context({ dataSource: 'polygon-cached' }))).toEqual([]);
    expect(check(proposal, context({ dataSource: 'polygon-stale' }))).toEqual([]);
  });

  it('refuses to trade outside the regular session', () => {
    expect(check(proposal, context({ candleTime: PREMARKET }))[0]).toMatch(/premarket/i);
    expect(check(proposal, context({ candleTime: AFTERHOURS }))[0]).toMatch(/after-hours/i);
  });

  it('allows one position per ticker', () => {
    expect(check(proposal, context({ hasOpenPosition: true }))[0]).toContain('NVDA');
  });

  it('stops at the daily trade cap', () => {
    expect(check(proposal, context({ tradesToday: 3 }))[0]).toMatch(/Tope de 3 operaciones/);
    expect(check(proposal, context({ tradesToday: 2 }))).toEqual([]);
  });

  it('blocks once the daily loss limit is reached', () => {
    // 2% de 100 000 = 2 000.
    expect(check(proposal, context({ realisedToday: -2000 }))[0]).toMatch(/Pérdida máxima diaria/);
    expect(check(proposal, context({ realisedToday: -1999 }))).toEqual([]);
  });

  it('holds fire during the cooldown and releases when it expires', () => {
    const now = Date.UTC(2026, 7, 28, 14, 0);

    const during = check(proposal, context({ now, lastStopAt: now - 5 * 60_000 }));
    expect(during[0]).toMatch(/Enfriamiento/);

    expect(check(proposal, context({ now, lastStopAt: now - 16 * 60_000 }))).toEqual([]);
  });

  it('rejects a size the balance cannot fund', () => {
    // 50 acciones a 100 = 5 000 de nocional.
    expect(check(proposal, context({ balance: 4000 }))[0]).toMatch(/Saldo insuficiente/);
  });

  it('rejects a sub-share size', () => {
    expect(check({ ...proposal, shares: 0 }, context())).toContain('Tamaño calculado inferior a una acción');
  });

  it('reports every reason it has, not just the first', () => {
    const blockers = check(proposal, context({ dataSource: 'demo', candleTime: PREMARKET, tradesToday: 9 }));
    expect(blockers).toHaveLength(3);
  });
});

describe('dailyLossReached', () => {
  it('is false with the limit disabled', () => {
    const config = { ...DEFAULT_CONFIG, maxDailyLossPct: 0 };
    expect(dailyLossReached({ realisedToday: -5000, capital: 100000, config })).toBe(false);
  });

  it('ignores profit', () => {
    expect(dailyLossReached({ realisedToday: 5000, capital: 100000, config: DEFAULT_CONFIG })).toBe(false);
  });
});
