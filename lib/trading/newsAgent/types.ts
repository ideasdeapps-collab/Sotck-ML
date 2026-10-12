/** Tipos del agente de noticias: lo que sale de cada fuente y el informe que ve el panel. */

export type Sentiment = 'positive' | 'negative' | 'neutral';

export type HeadlineOrigin = 'polygon' | 'yahoo' | 'google';

/** Titular tal como lo devuelve un parser, antes de deduplicar. */
export type RawHeadline = {
  title: string;
  url: string;
  source: string;
  /** Epoch en ms. */
  publishedAt: number;
  origin: HeadlineOrigin;
  /** Solo Polygon: sentimiento del artículo hacia el ticker. */
  sentiment?: Sentiment;
  reasoning?: string;
};

export type Headline = RawHeadline & { id: string };

export type AnalystRatings = { consensus: string; analysts: number | null };

export type PriceTarget = { target: number; low: number; high: number; buy: number; hold: number; sell: number };

export type EarningsTiming = 'antes de apertura' | 'tras el cierre';

export type EarningsDate = { date: string; timing: EarningsTiming | null; eps: number | null };

export type InsiderTrade = { name: string; relation: string; date: string; type: string; shares: number; price: number | null };

export type InsiderActivity = { buys3m: number; sells3m: number; netShares3m: number; latest: InsiderTrade[] };

export type DayChange = { price: number; change: number };

export const EMOTIONS = ['miedo', 'cautela', 'neutral', 'optimismo', 'euforia'] as const;
export type Emotion = (typeof EMOTIONS)[number];

export type LlmReport = { score: number; emotion: Emotion; summary: string; risks: string[] };

export type NewsData = {
  price: number | null;
  polygon: { positive: number; negative: number; neutral: number; score: number } | null;
  analysts: {
    consensus: string;
    analysts: number | null;
    buy: number;
    hold: number;
    sell: number;
    target: number | null;
    targetVsPrice: number | null;
  } | null;
  earnings: (EarningsDate & { days: number }) | null;
  insiders: InsiderActivity | null;
  market: { vix: number | null; vixChange: number | null; spyChange: number | null } | null;
  momentum: { change1d: number; change5d: number; rsi14: number } | null;
};

export type NewsReport = {
  ticker: string;
  /** Epoch en ms. */
  generatedAt: number;
  llm:
    | ({ ok: true; at: number; model: string; note?: string } & LlmReport)
    | { ok: false; reason: string };
  data: NewsData;
  headlines: Headline[];
  macro: Headline[];
  failures: string[];
};
