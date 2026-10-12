import { describe, expect, it } from 'vitest';
import { LLM_INTERVAL_MS, buildBrief, parseLlmReport, shouldAskLlm } from './llm';
import { NOW, llmOk } from './fixtures';
import type { Headline, NewsData } from './types';

describe('shouldAskLlm', () => {
  it('sin intento previo pregunta', () => {
    expect(shouldAskLlm(null, NOW)).toBe(true);
  });

  it('como mucho una vez cada 30 min, haya o no titulares nuevos', () => {
    expect(shouldAskLlm(NOW - 10 * 60_000, NOW)).toBe(false);
    expect(shouldAskLlm(NOW - LLM_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(shouldAskLlm(NOW - LLM_INTERVAL_MS, NOW)).toBe(true);
  });
});

describe('parseLlmReport', () => {
  it('acepta la respuesta válida, como texto JSON o como objeto', () => {
    expect(parseLlmReport(JSON.stringify(llmOk))).toEqual(llmOk);
    expect(parseLlmReport(llmOk)).toEqual(llmOk);
  });

  it('se queda con 4 riesgos como mucho', () => {
    expect(parseLlmReport({ ...llmOk, risks: ['1', '2', '3', '4', '5'] })!.risks).toHaveLength(4);
  });

  it('descarta emoción fuera de la lista, score fuera de rango o no entero, resumen vacío y basura', () => {
    expect(parseLlmReport({ ...llmOk, emotion: 'pánico' })).toBeNull();
    expect(parseLlmReport({ ...llmOk, score: 150 })).toBeNull();
    expect(parseLlmReport({ ...llmOk, score: 12.5 })).toBeNull();
    expect(parseLlmReport({ ...llmOk, summary: ' ' })).toBeNull();
    expect(parseLlmReport({ ...llmOk, risks: 'ninguno' })).toBeNull();
    expect(parseLlmReport('{no es json')).toBeNull();
  });
});

describe('buildBrief', () => {
  const headline: Headline = {
    id: 'x',
    title: 'Apple sube',
    url: 'https://example.com/muy/largo',
    source: 'Benzinga',
    publishedAt: NOW - 3_600_000,
    origin: 'polygon',
    sentiment: 'positive',
    reasoning: 'Demanda fuerte',
  };

  const data = { price: 337.7, polygon: null, analysts: null, earnings: null, insiders: null, market: null, momentum: null } as NewsData;

  it('titulares compactos con hora ET y sentimiento de Polygon, sin URLs', () => {
    const brief = buildBrief({ ticker: 'AAPL', data, headlines: [headline], macro: [], now: NOW });
    expect(brief.ticker).toBe('AAPL');
    expect(brief.titulares[0]).toEqual({
      hora: '13:00 ET',
      fuente: 'Benzinga',
      titulo: 'Apple sube',
      sentimiento_polygon: 'positive',
      razon_polygon: 'Demanda fuerte',
    });
    expect(JSON.stringify(brief)).not.toContain('https://');
  });
});
