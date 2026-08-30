'use client';

import { useSyncExternalStore } from 'react';

/**
 * Paper trading account for the Trading Lab.
 *
 * Persisted in `localStorage` with the same machinery as
 * `dayTrading/journal.ts`: the copilot's daily limits and its running P&L are
 * meaningless if a reload starts everything from zero, and a per-browser
 * account needs no backend, no auth and no deploy.
 *
 * Both directions are supported. A short reserves the same notional as a long
 * — it is a simulator, not a broker, so a flat 100% margin is the honest
 * simplification: it can never report a profit the capital could not have
 * funded.
 *
 * Components read it through `usePortfolio()`, never by calling `getPortfolio()`
 * during render: storage is only read on the client, so a render that consulted
 * it directly would disagree with the server's empty account and React would
 * report a hydration mismatch. `getPortfolio()` stays for the copilot's engine,
 * which runs inside an effect where that is not a concern.
 */

const STORAGE_KEY = 'trading-lab:portfolio:v1';
const INITIAL_BALANCE = 100000;
const MAX_HISTORY = 200;

export type PositionSide = 'long' | 'short';

/** Who opened the position — the copilot only ever manages its own. */
export type PositionOwner = 'manual' | 'copilot';

export type Position = {
  id: string;
  ticker: string;
  shares: number;
  entry: number;
  stop: number;
  target: number;
  /** Segundo objetivo, cuando la estrategia lo define. */
  target2?: number;
  side: PositionSide;
  owner: PositionOwner;
  openedAt: number;
};

/** What a caller has to supply; the rest defaults to a manual long. */
export type PositionInput = {
  ticker: string;
  shares: number;
  entry: number;
  stop: number;
  target: number;
  target2?: number;
  side?: PositionSide;
  owner?: PositionOwner;
};

export type ClosedTrade = {
  ticker: string;
  shares: number;
  entry: number;
  exit: number;
  side: PositionSide;
  owner: PositionOwner;
  pnl: number;
  closedAt: number;
};

export type Portfolio = {
  balance: number;
  positions: Position[];
  history: ClosedTrade[];
};

let balance = INITIAL_BALANCE;
let positions: Position[] = [];
let history: ClosedTrade[] = [];
let hydrated = false;

/**
 * Immutable view handed to React. Rebuilt on every mutation so
 * `useSyncExternalStore` sees a new reference exactly when something changed.
 */
let snapshot: Portfolio = { balance, positions, history };

const listeners = new Set<() => void>();

function emit() {
  snapshot = { balance, positions, history };
  listeners.forEach((listener) => listener());
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function persist() {
  emit();

  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ balance, positions, history }));
  } catch {
    // Storage full or blocked — the account just stops surviving reloads.
  }
}

/**
 * Reads storage once, on the client. Called from every public entry point
 * rather than at module load, so a server render never touches `window`.
 */
function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return;

    if (Number.isFinite(parsed.balance)) balance = parsed.balance;
    if (Array.isArray(parsed.positions)) {
      positions = parsed.positions.filter(
        (position: Position) => position && typeof position.ticker === 'string' && position.shares > 0
      );
    }
    if (Array.isArray(parsed.history)) history = parsed.history.slice(0, MAX_HISTORY);
  } catch {
    // Corrupt payload — start clean rather than crash on every render.
  }

  emit();
}

/** Cash committed when the position is opened, released when it is closed. */
function notional(position: Pick<Position, 'shares' | 'entry'>): number {
  return position.shares * position.entry;
}

export function openPosition(input: PositionInput): Position | null {
  hydrate();

  const side = input.side ?? 'long';
  const cost = input.shares * input.entry;

  if (!Number.isFinite(cost) || cost <= 0 || cost > balance) return null;

  const position: Position = {
    id: newId(),
    ticker: input.ticker,
    shares: input.shares,
    entry: input.entry,
    stop: input.stop,
    target: input.target,
    target2: input.target2,
    side,
    owner: input.owner ?? 'manual',
    openedAt: Date.now(),
  };

  balance -= cost;
  positions = [...positions, position];
  persist();

  return position;
}

/** Unrealised (or realised, at the exit price) result of a position. */
export function calculatePnL(position: Pick<Position, 'shares' | 'entry' | 'side'>, price: number): number {
  const perShare = position.side === 'short' ? position.entry - price : price - position.entry;
  return perShare * position.shares;
}

function release(position: Position, price: number): number {
  const pnl = calculatePnL(position, price);

  balance += notional(position) + pnl;
  positions = positions.filter((item) => item.id !== position.id);
  history = [
    {
      ticker: position.ticker,
      shares: position.shares,
      entry: position.entry,
      exit: price,
      side: position.side,
      owner: position.owner,
      pnl,
      closedAt: Date.now(),
    },
    ...history,
  ].slice(0, MAX_HISTORY);

  return pnl;
}

/**
 * Closes the position on `ticker`, or the identified one when several are open.
 * Returns the realised P&L, or null when there was nothing to close.
 */
export function closePosition(ticker: string, price: number, positionId?: string): number | null {
  hydrate();

  const position = positionId
    ? positions.find((item) => item.id === positionId)
    : positions.find((item) => item.ticker === ticker);

  if (!position || !Number.isFinite(price) || price <= 0) return null;

  const pnl = release(position, price);
  persist();

  return pnl;
}

/**
 * Closes every open position at the given prices — the copilot's kill switch.
 * A ticker with no price is left open rather than closed at a made-up one.
 */
export function closeAll(prices: Record<string, number>): number {
  hydrate();

  let realised = 0;

  for (const position of [...positions]) {
    const price = prices[position.ticker];
    if (!Number.isFinite(price) || price <= 0) continue;
    realised += release(position, price);
  }

  persist();
  return realised;
}

export function positionsOf(owner: PositionOwner, ticker?: string): Position[] {
  hydrate();
  return ownedBy(snapshot, owner, ticker);
}

/** Sets the starting capital. Refused while a position is open, since the
 *  balance would no longer reconcile with the money already committed. */
export function setCapital(amount: number): number | null {
  hydrate();

  if (positions.length > 0) return null;

  balance = amount;
  persist();
  return balance;
}

export function updateBalance(amount: number): number {
  hydrate();
  balance += amount;
  persist();
  return balance;
}

export function getPortfolio(): Portfolio {
  hydrate();
  return snapshot;
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
/** Stable empty account: the server has no storage to read. */
const SERVER_SNAPSHOT: Portfolio = { balance: INITIAL_BALANCE, positions: [], history: [] };
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function usePortfolio(): Portfolio {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Positions from a portfolio snapshot — pure, so it is safe during render. */
export function ownedBy(portfolio: Portfolio, owner: PositionOwner, ticker?: string): Position[] {
  return portfolio.positions.filter(
    (position) => position.owner === owner && (ticker === undefined || position.ticker === ticker)
  );
}

export function resetPortfolio(): Portfolio {
  hydrate();
  balance = INITIAL_BALANCE;
  positions = [];
  history = [];
  persist();
  return getPortfolio();
}

/** Test seam: drops the in-memory account and re-reads storage on next use. */
export function __resetForTests() {
  balance = INITIAL_BALANCE;
  positions = [];
  history = [];
  hydrated = false;
  snapshot = { balance, positions, history };
}
