import { describe, expect, it, vi } from 'vitest';
import { DAILY_LLM_CALLS, buildReport, createAgentState, type AgentDeps } from './report';
import {
  NOW,
  aaplPremarket,
  googleRss,
  llmOk,
  macroRss,
  nasdaqEarnings,
  nasdaqInsiders,
  nasdaqRatings,
  nasdaqTarget,
  polygonNews,
  spyChart,
  vixChart,
  yahooRss,
} from './fixtures';
import type { Candle } from '../marketData';

const rising = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => ({ time: i * 86400, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i, volume: 1 }));

function json(url: string): unknown {
  if (url.includes('api.polygon.io')) return polygonNews;
  if (url.includes('/ratings')) return nasdaqRatings;
  if (url.includes('/targetprice')) return nasdaqTarget;
  if (url.includes('/earnings-date')) return nasdaqEarnings;
  if (url.includes('/insider-trades')) return nasdaqInsiders;
  if (url.includes('/chart/%5EVIX')) return vixChart;
  if (url.includes('/chart/SPY')) return spyChart;
  if (url.includes('/chart/AAPL')) return aaplPremarket;
  throw new Error(`URL inesperada ${url}`);
}

function text(url: string): string {
  if (url.includes('geopolitical')) return macroRss;
  if (url.includes('news.google.com')) return googleRss;
  return yahooRss;
}

function deps(over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    now: () => NOW,
    polygonKey: 'k',
    llmAvailable: true,
    model: 'gpt-test',
    json: vi.fn(async (url: string) => json(url)),
    text: vi.fn(async (url: string) => text(url)),
    dailyCandles: async () => ({ candles: rising(20), source: 'polygon' }),
    askLlm: vi.fn(async () => JSON.stringify(llmOk)),
    ...over,
  };
}

describe('buildReport', () => {
  it('junta todas las fuentes, calcula los números y pide el resumen a GPT', async () => {
    const d = deps();
    const report = await buildReport('AAPL', d, createAgentState());

    expect(report.failures).toEqual([]);
    expect(report.ticker).toBe('AAPL');
    expect(report.data.price).toBe(337.67);
    expect(report.data.analysts).toMatchObject({ consensus: 'Hold', buy: 16, target: 338.31 });
    expect(report.data.earnings).toMatchObject({ date: '2026-11-02', days: 21 });
    expect(report.data.insiders).toMatchObject({ buys3m: 0, sells3m: 18 });
    expect(report.data.market).toEqual({ vix: 18.4, vixChange: 0, spyChange: -0.3 });
    expect(report.data.momentum).toEqual({ change1d: 0.85, change5d: 4.39, rsi14: 100 });
    expect(report.data.polygon).toEqual({ positive: 1, negative: 0, neutral: 0, score: 100 });

    // «Apple's Price…» de Polygon y «Apple’s Price…» de Yahoo son la misma noticia.
    expect(report.headlines.filter((h) => h.title.toLowerCase().includes('price ahead'))).toHaveLength(1);
    expect(report.macro[0].title).toBe('Markets wobble as Taiwan Strait tensions flare');

    expect(report.llm).toEqual({ ok: true, ...llmOk, at: NOW, model: 'gpt-test' });
    expect(d.askLlm).toHaveBeenCalledTimes(1);
  });

  it('con los mismos titulares no vuelve a llamar a GPT', async () => {
    const state = createAgentState();
    const d = deps();
    await buildReport('AAPL', d, state);
    const later = await buildReport('AAPL', { ...d, now: () => NOW + 5 * 60_000 }, state);

    expect(d.askLlm).toHaveBeenCalledTimes(1);
    expect(later.llm).toMatchObject({ ok: true, at: NOW });
  });

  it('si todas las fuentes fallan, devuelve el informe vacío con los motivos y no llama a GPT', async () => {
    const boom = async () => {
      throw new Error('sin respuesta');
    };
    const d = deps({ json: boom, text: boom, dailyCandles: boom });
    const report = await buildReport('AAPL', d, createAgentState());

    expect(report.headlines).toEqual([]);
    expect(report.data).toEqual({ price: null, polygon: null, analysts: null, earnings: null, insiders: null, market: null, momentum: null });
    expect(report.failures).toHaveLength(12);
    expect(report.failures).toContain('Earnings: sin respuesta');
    expect(report.llm).toEqual({ ok: false, reason: 'Sin titulares que resumir' });
    expect(d.askLlm).not.toHaveBeenCalled();
  });

  it('sin POLYGON_API_KEY no pide noticias a Polygon y lo dice', async () => {
    const d = deps({ polygonKey: undefined });
    const report = await buildReport('AAPL', d, createAgentState());

    expect(report.failures).toContain('Polygon: falta POLYGON_API_KEY');
    expect((d.json as any).mock.calls.some(([url]: [string]) => url.includes('polygon'))).toBe(false);
  });

  it('con velas simuladas no calcula momentum', async () => {
    const report = await buildReport('AAPL', deps({ dailyCandles: async () => ({ candles: rising(20), source: 'demo' }) }), createAgentState());
    expect(report.data.momentum).toBeNull();
    expect(report.failures).toContain('Momentum: velas simuladas (sin POLYGON_API_KEY)');
  });

  it('sin clave de IA entrega datos y titulares sin resumen', async () => {
    const d = deps({ llmAvailable: false });
    const report = await buildReport('AAPL', d, createAgentState());

    expect(report.llm).toEqual({ ok: false, reason: 'Ni GEMINI_API_KEY ni OPENAI_API_KEY están configuradas — solo datos y titulares' });
    expect(report.headlines.length).toBeGreaterThan(0);
    expect(d.askLlm).not.toHaveBeenCalled();
  });

  it('al llegar al tope diario no llama a GPT', async () => {
    const state = createAgentState();
    state.budget = { day: '2026-10-12', calls: DAILY_LLM_CALLS };
    const d = deps();
    const report = await buildReport('AAPL', d, state);

    expect(d.askLlm).not.toHaveBeenCalled();
    expect(report.llm).toEqual({ ok: false, reason: `Tope de ${DAILY_LLM_CALLS} resúmenes de IA por día alcanzado` });
  });

  it('el tope se reinicia al cambiar el día en Nueva York', async () => {
    const state = createAgentState();
    state.budget = { day: '2026-10-11', calls: DAILY_LLM_CALLS };
    const d = deps();
    await buildReport('AAPL', d, state);
    expect(d.askLlm).toHaveBeenCalledTimes(1);
  });

  it('si GPT falla después de un resumen bueno, se queda el anterior con una nota', async () => {
    const state = createAgentState();
    await buildReport('AAPL', deps(), state);

    const failing = deps({
      now: () => NOW + 2 * 3_600_000,
      askLlm: async () => {
        throw new Error('OpenAI no respondió');
      },
    });
    const report = await buildReport('AAPL', failing, state);

    expect(report.llm).toMatchObject({ ok: true, at: NOW, note: 'Resumen anterior — OpenAI no respondió' });
  });

  it('un fallo de la IA no se reintenta hasta pasados 30 min', async () => {
    const state = createAgentState();
    const failing = deps({
      askLlm: vi.fn(async () => {
        throw new Error('Gemini no respondió');
      }),
    });
    await buildReport('AAPL', failing, state);
    const soon = await buildReport('AAPL', { ...failing, now: () => NOW + 5 * 60_000 }, state);

    expect(failing.askLlm).toHaveBeenCalledTimes(1);
    expect(soon.llm).toMatchObject({ ok: false });
    expect((soon.llm as { reason: string }).reason).toMatch(/próximo resumen de IA/);

    await buildReport('AAPL', { ...failing, now: () => NOW + 30 * 60_000 }, state);
    expect(failing.askLlm).toHaveBeenCalledTimes(2);
  });

  it('una respuesta de GPT con forma inválida no se pinta', async () => {
    const report = await buildReport('AAPL', deps({ askLlm: async () => '{"score": 999}' }), createAgentState());
    expect(report.llm).toEqual({ ok: false, reason: 'La IA devolvió un formato no reconocido' });
  });
});
