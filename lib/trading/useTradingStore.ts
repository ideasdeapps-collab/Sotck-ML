"use client";
import { useSyncExternalStore } from "react";
import type { SeriesMarker, Time } from "lightweight-charts";
import { DEFAULT_OVERLAYS, type OverlayId, type OverlayState } from "./overlays/registry";
import type { PlanBias } from "./dayTrading/intradayPlan";
import type { TickerCapabilities } from "@/types/trading";

export type TradingState = {
  ticker: string;
  timeframe: string;
  mode: string;
  capital: number;
  /** Which chart overlays are switched on. */
  overlays: OverlayState;
  /** Direction the intraday plan is built for; shared by the chart and the panel. */
  planBias: PlanBias;
  /** Fraction of capital risked per trade, as the management panel has it. */
  riskPerTrade: number;
  /** Which predictive curves exist for the current ticker; null until probed. */
  capabilities: TickerCapabilities | null;
  /** False when the ML API could not be reached at all. */
  apiReachable: boolean;
  watchlist: string[];
  signal: any;
  markers: SeriesMarker<Time>[];
  candles: any[];
  session: boolean;
  live: boolean;
  portfolioVersion: number;
  dataError: string;
  status: string;
};

let state: TradingState = {
  ticker: "NVDA",
  timeframe: "1m",
  mode: "Live",
  capital: 100000,
  watchlist: ["NVDA", "AMD", "TSLA", "AAPL", "SNDK", "MSFT", "SPY"],
  overlays: { ...DEFAULT_OVERLAYS },
  planBias: "auto",
  riskPerTrade: 0.01,
  capabilities: null,
  apiReachable: false,
  signal: null,
  markers: [],
  candles: [],
  session: false,
  live: false,
  portfolioVersion: 0,
  dataError: "",
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
  setDataError: (dataError: string) => patch({ dataError }),
  bumpPortfolio: () => patch({ portfolioVersion: state.portfolioVersion + 1 }),
  setStatus: (status: string) => patch({ status }),
  setOverlay: (id: OverlayId, on: boolean) => patch({ overlays: { ...state.overlays, [id]: on } }),
  setPlanBias: (planBias: PlanBias) => patch({ planBias }),
  setRiskPerTrade: (riskPerTrade: number) => patch({ riskPerTrade }),
  setCapabilities: (capabilities: TickerCapabilities | null, apiReachable: boolean) =>
    patch({ capabilities, apiReachable }),
};

export function useTradingStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, ...actions };
}

export function getTradingState() {
  return state;
}
