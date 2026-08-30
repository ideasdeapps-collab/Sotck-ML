'use client';

import { useSyncExternalStore } from 'react';
import { crossedDown, crossedUp } from './planAlerts';
import type { IntradayPlan, PlanDirection } from './intradayPlan';

/**
 * A log of the plans the user actually committed to, and how they turned out.
 *
 * Kept in `localStorage` rather than Supabase on purpose. The backend's
 * `/intraday-snapshot` store is a different thing despite the similar name: it
 * records the ML session *curve* to score the model against a "no change"
 * baseline, not a trade the user took, and `score_snapshots` would make no
 * sense of entry/stop levels. A per-browser journal needs no backend, no
 * deploy and no auth, and works the moment you click save.
 *
 * Each entry carries its own levels, so an old trade resolves against today's
 * price without depending on the plan currently on screen.
 */

const STORAGE_KEY = 'trading-lab:journal:v1';
const MAX_ENTRIES = 200;

export type JournalOutcome = 'open' | 'tp1' | 'tp2' | 'stop';

export type JournalEntry = {
  id: string;
  ticker: string;
  timeframe: string;
  direction: PlanDirection;
  entryType: string;
  entry: [number, number];
  entryMid: number;
  stopLoss: number;
  takeProfit: [number, number];
  riskReward: number;
  shares: number;
  riskAmount: number;
  savedAt: number;
  savedPrice: number;
  outcome: JournalOutcome;
  /** Last price this entry was evaluated against, so crossings need no re-scan. */
  lastSeenPrice: number;
  closedAt?: number;
  exitPrice?: number;
};

let state: JournalEntry[] = [];
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked storage must not take the panel down; the journal just
    // stops surviving reloads.
  }
}

/**
 * Reads storage once, on the client.
 *
 * Deliberately not called during render: the server snapshot is empty, so the
 * first client render has to be empty too or React reports a hydration
 * mismatch. Subscribing happens in an effect, which is safely after that.
 */
function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      state = parsed.filter((entry) => entry && typeof entry.id === 'string');
      emit();
    }
  } catch {
    // Corrupt payload — start clean rather than crash on every render.
  }
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
/** Stable empty reference: a new array each call would loop on the server. */
const EMPTY: JournalEntry[] = [];
const getServerSnapshot = () => EMPTY;

function id(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Lo único que el diario necesita de un plan.
 *
 * Estructural a propósito: `IntradayPlan` y el setup de la estrategia de mechas
 * lo satisfacen igual, así que ambos se guardan y se resuelven con la misma
 * maquinaria sin que el diario tenga que conocer ninguna de las dos estrategias.
 */
export type RecordablePlan = Pick<
  IntradayPlan,
  'direction' | 'entryType' | 'entry' | 'entryMid' | 'stopLoss' | 'takeProfit' | 'riskReward' | 'lastPrice'
>;

export function recordPlan(
  plan: RecordablePlan,
  context: { ticker: string; timeframe: string; shares: number; riskAmount: number }
): JournalEntry {
  const entry: JournalEntry = {
    id: id(),
    ticker: context.ticker,
    timeframe: context.timeframe,
    direction: plan.direction,
    entryType: plan.entryType,
    entry: plan.entry,
    entryMid: plan.entryMid,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    riskReward: plan.riskReward,
    shares: context.shares,
    riskAmount: context.riskAmount,
    savedAt: Date.now(),
    savedPrice: plan.lastPrice,
    outcome: 'open',
    lastSeenPrice: plan.lastPrice,
  };

  state = [entry, ...state].slice(0, MAX_ENTRIES);
  persist();
  emit();
  return entry;
}

export function removeEntry(entryId: string) {
  state = state.filter((entry) => entry.id !== entryId);
  persist();
  emit();
}

export function clearJournal() {
  state = [];
  persist();
  emit();
}

/**
 * Closes any open trade on `ticker` whose stop or targets the price just went
 * through. TP2 beats TP1 when a single move clears both.
 */
export function resolveOpenEntries(ticker: string, price: number): void {
  if (!Number.isFinite(price)) return;

  let changed = false;

  state = state.map((entry) => {
    if (entry.ticker !== ticker || entry.outcome !== 'open') return entry;

    const previous = entry.lastSeenPrice;
    if (previous === price) return entry;

    const long = entry.direction === 'long';
    const reached = (level: number) =>
      long ? crossedUp(previous, price, level) : crossedDown(previous, price, level);
    const stopped = long
      ? crossedDown(previous, price, entry.stopLoss)
      : crossedUp(previous, price, entry.stopLoss);

    let outcome: JournalOutcome = 'open';
    let exit = 0;

    if (reached(entry.takeProfit[1])) {
      outcome = 'tp2';
      exit = entry.takeProfit[1];
    } else if (reached(entry.takeProfit[0])) {
      outcome = 'tp1';
      exit = entry.takeProfit[0];
    } else if (stopped) {
      outcome = 'stop';
      exit = entry.stopLoss;
    }

    changed = true;

    return outcome === 'open'
      ? { ...entry, lastSeenPrice: price }
      : { ...entry, lastSeenPrice: price, outcome, exitPrice: exit, closedAt: Date.now() };
  });

  if (changed) {
    persist();
    emit();
  }
}

/** Realised result of a closed trade, in currency and in R multiples. */
export function entryResult(entry: JournalEntry): { pnl: number; r: number } | null {
  if (entry.outcome === 'open' || entry.exitPrice === undefined) return null;

  const perShare =
    entry.direction === 'long' ? entry.exitPrice - entry.entryMid : entry.entryMid - entry.exitPrice;
  const risk = Math.abs(entry.entryMid - entry.stopLoss);

  return { pnl: perShare * entry.shares, r: risk > 0 ? perShare / risk : 0 };
}

export function useJournal(): JournalEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Current entries without subscribing — mirrors `getTradingState()`. */
export function getJournal(): JournalEntry[] {
  hydrate();
  return state;
}
