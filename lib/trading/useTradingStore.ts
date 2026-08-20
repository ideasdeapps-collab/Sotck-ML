"use client";
import { useSyncExternalStore } from "react";
import type { SeriesMarker, Time } from "lightweight-charts";

export type TradingState = {
  ticker: string;
  timeframe: string;
  mode: string;
  capital: number;
  indicators: { ema20: boolean; ema50: boolean; vwap: boolean; bollinger: boolean };
  watchlist: string[];
  signal: any;
  markers: SeriesMarker<Time>[];
  candles: any[];
  session: boolean;
  live: boolean;
  portfolioVersion: number;
  status: string;
};

let state: TradingState = {
  ticker: "NVDA",
  timeframe: "1m",
  mode: "Live",
  capital: 100000,
  watchlist: ["NVDA", "AMD", "TSLA", "AAPL", "SNDK", "MSFT", "SPY"],
  indicators: { ema20: true, ema50: true, vwap: true, bollinger: true },
  signal: null,
  markers: [],
  candles: [],
  session: false,
  live: false,
  portfolioVersion: 0,
  status: "Idle",
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function patch(next: Partial<TradingState>) {
  state = { ...state, ...next };
  emit();
}

export const actions = {
  setTicker: (ticker: string) => patch({ ticker }),
  setCapital: (capital: number) => patch({ capital }),
  addToWatchlist: (ticker: string) => {
    const symbol = ticker.trim().toUpperCase();
    if (!symbol || state.watchlist.includes(symbol)) return;
    patch({ watchlist: [...state.watchlist, symbol] });
  },
  removeFromWatchlist: (ticker: string) =>
    patch({ watchlist: state.watchlist.filter((item) => item !== ticker) }),
  setTimeframe: (timeframe: string) => patch({ timeframe }),
  setMode: (mode: string) => patch({ mode }),
  setSignal: (signal: any) => patch({ signal }),
  setMarkers: (markers: SeriesMarker<Time>[]) => patch({ markers }),
  setCandles: (candles: any[]) => patch({ candles }),
  addCandle: (candle: any) => patch({ candles: [...state.candles.slice(-500), candle] }),
  setSession: (session: boolean) => patch({ session }),
  setLive: (live: boolean) => patch({ live }),
  bumpPortfolio: () => patch({ portfolioVersion: state.portfolioVersion + 1 }),
  setStatus: (status: string) => patch({ status }),
};

export function useTradingStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, ...actions };
}

export function getTradingState() {
  return state;
}
