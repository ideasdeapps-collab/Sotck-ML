import { etParts } from '../chartTime';
import { calculateRSI } from '../indicators';
import type { Candle } from '../marketData';
import type { AnalystRatings, EarningsDate, Headline, NewsData, PriceTarget, RawHeadline } from './types';

/** Lo que se calcula sin IA. Todo puro: los números que ve el usuario salen de aquí, no de GPT. */

export const MAX_HEADLINES = 20;
export const MAX_MACRO = 6;

const DAY_MS = 86_400_000;
/** Relojes de las fuentes algo adelantados no deben tirar un titular recién publicado. */
const FUTURE_SKEW_MS = 5 * 60_000;

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/** Clave de deduplicación: «Apple’s Price…» de Yahoo y «Apple's price…!» de Polygon son la misma noticia. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü]+/g, ' ')
    .trim();
}

/** FNV-1a de 32 bits: id estable sin depender de `crypto`, que el cliente no necesita. */
export function headlineId(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Une titulares de varias fuentes: últimas 24 h, sin duplicados, más recientes
 * primero. Si una noticia está en Polygon y en un RSS, gana la de Polygon
 * porque trae el sentimiento.
 */
export function mergeHeadlines(lists: RawHeadline[][], now: number, max = MAX_HEADLINES): Headline[] {
  const byKey = new Map<string, Headline>();

  for (const item of lists.flat()) {
    if (now - item.publishedAt > DAY_MS || item.publishedAt - now > FUTURE_SKEW_MS) continue;

    const key = normalizeTitle(item.title);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing && !(item.origin === 'polygon' && existing.origin !== 'polygon')) continue;

    byKey.set(key, { ...item, id: headlineId(key) });
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, max);
}

export function polygonSentiment(headlines: Headline[]): NewsData['polygon'] {
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const headline of headlines) if (headline.sentiment) counts[headline.sentiment] += 1;

  const total = counts.positive + counts.negative + counts.neutral;
  if (total === 0) return null;

  return { ...counts, score: Math.round(((counts.positive - counts.negative) / total) * 100) };
}

/** Días de calendario entre hoy en Nueva York y la fecha de earnings. */
export function earningsInfo(earnings: EarningsDate | null, now: number): NewsData['earnings'] {
  if (!earnings) return null;

  const toUtc = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };

  const days = Math.round((toUtc(earnings.date) - toUtc(etParts(now / 1000).date)) / DAY_MS);
  return { ...earnings, days };
}

export function analystSummary(ratings: AnalystRatings | null, target: PriceTarget | null, price: number | null): NewsData['analysts'] {
  if (!ratings && !target) return null;

  return {
    consensus: ratings?.consensus ?? 'n/d',
    analysts: ratings?.analysts ?? null,
    buy: target?.buy ?? 0,
    hold: target?.hold ?? 0,
    sell: target?.sell ?? 0,
    target: target?.target ?? null,
    targetVsPrice: target && price ? round((target.target / price - 1) * 100, 1) : null,
  };
}

/** Sobre velas diarias: hacen falta 15 para el RSI 14. */
export function momentum(candles: Candle[]): NewsData['momentum'] {
  if (candles.length < 15) return null;

  const close = (back: number) => candles[candles.length - 1 - back].close;
  const rsi = calculateRSI(candles, 14)[candles.length - 1];
  if (!Number.isFinite(rsi)) return null;

  return {
    change1d: round((close(0) / close(1) - 1) * 100),
    change5d: round((close(0) / close(5) - 1) * 100),
    rsi14: round(rsi, 1),
  };
}
