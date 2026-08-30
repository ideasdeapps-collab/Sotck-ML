import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  calculatePnL,
  closeAll,
  closePosition,
  getPortfolio,
  openPosition,
  positionsOf,
  setCapital,
} from './paperEngine';

/** Minimal `localStorage`, enough for the hydrate/persist round trip. */
function stubWindow() {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
  return store;
}

beforeEach(() => __resetForTests());
afterEach(() => {
  delete (globalThis as any).window;
  vi.resetModules();
});

describe('calculatePnL', () => {
  it('is direction aware', () => {
    const long = { shares: 10, entry: 100, side: 'long' as const };
    const short = { shares: 10, entry: 100, side: 'short' as const };

    expect(calculatePnL(long, 110)).toBe(100);
    expect(calculatePnL(long, 90)).toBe(-100);
    expect(calculatePnL(short, 90)).toBe(100);
    expect(calculatePnL(short, 110)).toBe(-100);
  });
});

describe('openPosition', () => {
  it('reserves the notional and defaults to a manual long', () => {
    const position = openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 });

    expect(position).not.toBeNull();
    expect(position!.side).toBe('long');
    expect(position!.owner).toBe('manual');
    expect(getPortfolio().balance).toBe(99000);
  });

  it('refuses a position the balance cannot fund', () => {
    expect(openPosition({ ticker: 'NVDA', shares: 10_000, entry: 100, stop: 98, target: 106 })).toBeNull();
    expect(getPortfolio().balance).toBe(100000);
    expect(getPortfolio().positions).toHaveLength(0);
  });

  it('reserves the same notional for a short', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 102, target: 94, side: 'short' });
    expect(getPortfolio().balance).toBe(99000);
  });
});

describe('closePosition', () => {
  it('returns the notional plus the profit on a winning long', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 });

    expect(closePosition('NVDA', 106)).toBe(60);
    expect(getPortfolio().balance).toBe(100060);
    expect(getPortfolio().positions).toHaveLength(0);
  });

  it('profits from a falling price on a short', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 102, target: 94, side: 'short' });

    expect(closePosition('NVDA', 94)).toBe(60);
    expect(getPortfolio().balance).toBe(100060);
  });

  it('loses on a short when the price rises', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 102, target: 94, side: 'short' });

    expect(closePosition('NVDA', 102)).toBe(-20);
    expect(getPortfolio().balance).toBe(99980);
  });

  it('records the side and owner in the history', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 102, target: 94, side: 'short', owner: 'copilot' });
    closePosition('NVDA', 94);

    const [trade] = getPortfolio().history;
    expect(trade.side).toBe('short');
    expect(trade.owner).toBe('copilot');
    expect(trade.pnl).toBe(60);
  });

  it('closes the identified position when two are open on the same ticker', () => {
    const manual = openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 })!;
    openPosition({ ticker: 'NVDA', shares: 5, entry: 100, stop: 98, target: 106, owner: 'copilot' });

    closePosition('NVDA', 110, manual.id);

    const open = getPortfolio().positions;
    expect(open).toHaveLength(1);
    expect(open[0].owner).toBe('copilot');
  });

  it('returns null when there is nothing to close', () => {
    expect(closePosition('NVDA', 100)).toBeNull();
  });
});

describe('closeAll', () => {
  it('closes what it has a price for and leaves the rest open', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 });
    openPosition({ ticker: 'AMD', shares: 10, entry: 50, stop: 49, target: 53 });

    expect(closeAll({ NVDA: 110 })).toBe(100);
    expect(getPortfolio().positions.map((position) => position.ticker)).toEqual(['AMD']);
  });
});

describe('positionsOf', () => {
  it('separates the copilot from the manual buttons', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 });
    openPosition({ ticker: 'AMD', shares: 10, entry: 50, stop: 49, target: 53, owner: 'copilot' });

    expect(positionsOf('copilot').map((position) => position.ticker)).toEqual(['AMD']);
    expect(positionsOf('copilot', 'NVDA')).toHaveLength(0);
  });
});

describe('setCapital', () => {
  it('is refused while a position is open', () => {
    openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106 });
    expect(setCapital(50000)).toBeNull();
    expect(getPortfolio().balance).toBe(99000);
  });

  it('applies when flat', () => {
    expect(setCapital(50000)).toBe(50000);
  });
});

describe('persistence', () => {
  it('survives a reload through localStorage', async () => {
    stubWindow();

    const first = await import('./paperEngine');
    first.__resetForTests();
    first.openPosition({ ticker: 'NVDA', shares: 10, entry: 100, stop: 98, target: 106, owner: 'copilot' });

    // A fresh module instance is what a page reload actually produces.
    vi.resetModules();
    const reloaded = await import('./paperEngine');
    const portfolio = reloaded.getPortfolio();

    expect(portfolio.balance).toBe(99000);
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0].owner).toBe('copilot');
  });

  it('starts clean on a corrupt payload instead of throwing', async () => {
    const store = stubWindow();
    store.set('trading-lab:portfolio:v1', '{not json');

    vi.resetModules();
    const reloaded = await import('./paperEngine');

    expect(reloaded.getPortfolio().balance).toBe(100000);
  });
});
