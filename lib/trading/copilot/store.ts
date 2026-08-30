'use client';

import { useSyncExternalStore } from 'react';
import { etParts } from '../chartTime';
import type { CopilotConfig, CopilotEvent, CopilotState } from './types';

/**
 * Estado del copiloto, persistido en `localStorage` igual que el diario de
 * sesión (`dayTrading/journal.ts`): los contadores del día y el registro de
 * decisiones no significan nada si una recarga los pone a cero.
 *
 * Una excepción deliberada: `enabled` NO se persiste. Un agente que abre
 * posiciones solo tiene que arrancar apagado y esperar un click, igual que los
 * overlays arrancan todos en `false`. Reabrir una pestaña no es autorizar nada.
 */

const STORAGE_KEY = 'trading-lab:copilot:v1';
const MAX_EVENTS = 60;

export const DEFAULT_CONFIG: CopilotConfig = {
  maxTradesPerDay: 3,
  maxDailyLossPct: 0.02,
  cooldownMinutes: 15,
  useLlm: true,
  minLlmConfidence: 60,
};

/** Fecha ET, para que los contadores giren con la sesión y no a medianoche local. */
export function sessionDay(now = Date.now()): string {
  return etParts(Math.floor(now / 1000)).date;
}

function initialState(): CopilotState {
  return {
    enabled: false,
    config: { ...DEFAULT_CONFIG },
    events: [],
    day: sessionDay(),
    tradesToday: 0,
    realisedToday: 0,
    lastStopAt: null,
  };
}

let state: CopilotState = initialState();
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    const { enabled, ...persisted } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Almacenamiento lleno o bloqueado: el copiloto sigue, solo deja de
    // recordar entre recargas.
  }
}

function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return;

    state = {
      ...state,
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS) : [],
      day: typeof parsed.day === 'string' ? parsed.day : state.day,
      tradesToday: Number.isFinite(parsed.tradesToday) ? parsed.tradesToday : 0,
      realisedToday: Number.isFinite(parsed.realisedToday) ? parsed.realisedToday : 0,
      lastStopAt: Number.isFinite(parsed.lastStopAt) ? parsed.lastStopAt : null,
    };

    rollDay();
    emit();
  } catch {
    // Payload corrupto: se empieza limpio en vez de romper en cada render.
  }
}

function patch(next: Partial<CopilotState>) {
  state = { ...state, ...next };
  persist();
  emit();
}

/** Reinicia los contadores diarios si la sesión ET ya cambió. */
function rollDay() {
  const today = sessionDay();
  if (state.day === today) return;
  state = { ...state, day: today, tradesToday: 0, realisedToday: 0, lastStopAt: null };
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const copilot = {
  setEnabled(enabled: boolean) {
    hydrate();
    rollDay();
    patch({ enabled });
  },

  setConfig(next: Partial<CopilotConfig>) {
    hydrate();
    patch({ config: { ...state.config, ...next } });
  },

  /**
   * Añade una entrada al registro.
   *
   * Los bloqueos se deduplican contra el evento anterior: el mismo motivo se
   * repetiría cada 15 s con cada vela nueva y taparía todo lo demás.
   */
  log(event: Omit<CopilotEvent, 'id' | 'at'>): CopilotEvent | null {
    hydrate();
    rollDay();

    const previous = state.events[0];
    if (
      event.kind === 'blocked' &&
      previous?.kind === 'blocked' &&
      previous.ticker === event.ticker &&
      previous.reasons.join('|') === event.reasons.join('|')
    ) {
      return null;
    }

    const entry: CopilotEvent = { ...event, id: newId(), at: Date.now() };
    patch({ events: [entry, ...state.events].slice(0, MAX_EVENTS) });
    return entry;
  },

  /** Una apertura ejecutada consume cupo del día. */
  countTrade() {
    hydrate();
    rollDay();
    patch({ tradesToday: state.tradesToday + 1 });
  },

  /** Un cierre suma su resultado al día y, si fue un stop, arranca el enfriamiento. */
  settle(pnl: number, wasStop: boolean) {
    hydrate();
    rollDay();
    patch({
      realisedToday: state.realisedToday + pnl,
      lastStopAt: wasStop ? Date.now() : state.lastStopAt,
    });
  },

  clearEvents() {
    hydrate();
    patch({ events: [] });
  },

  resetDay() {
    hydrate();
    patch({ day: sessionDay(), tradesToday: 0, realisedToday: 0, lastStopAt: null });
  },
};

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
/** Referencia estable: crear el estado en cada llamada haría bucle en el servidor. */
const SERVER_STATE: CopilotState = initialState();
const getServerSnapshot = () => SERVER_STATE;

export function useCopilot(): CopilotState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Estado actual sin suscribirse — el motor lo lee dentro del tick. */
export function getCopilotState(): CopilotState {
  hydrate();
  rollDay();
  return state;
}
