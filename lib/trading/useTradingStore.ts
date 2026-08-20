"use client";
import { useSyncExternalStore } from "react";
import type { SeriesMarker, Time } from "lightweight-charts";

export type TradingState = {
  ticker: string;
  timeframe: string;
  mode: string;
  capital: number;
  indicators: { ema20: boolean; ema50: boolean; vwap: boolean; bollinger: boolean };
  signal: any;
  markers: SeriesMarker<Time>[];
  candles: any[];
  session: boolean;
  live: boolean;
  status: string;
};

let state: TradingState = {
  ticker: "NVDA",
  timeframe: "1m",
  mode: "Live",
  capital: 100000,
  indicators: { ema20: true, ema50: true, vwap: true, bollinger: true },
  signal: null,
  markers: [],
  candles: [],
  session: false,
  live: false,
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
  setTimeframe: (timeframe: string) => patch({ timeframe }),
  setMode: (mode: string) => patch({ mode }),
  setSignal: (signal: any) => patch({ signal }),
  setMarkers: (markers: SeriesMarker<Time>[]) => patch({ markers }),
  setCandles: (candles: any[]) => patch({ candles }),
  addCandle: (candle: any) => patch({ candles: [...state.candles.slice(-500), candle] }),
  setSession: (session: boolean) => patch({ session }),
  setLive: (live: boolean) => patch({ live }),
  setStatus: (status: string) => patch({ status }),
};

export function useTradingStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, ...actions };
}

export function getTradingState() {
  return state;
}
