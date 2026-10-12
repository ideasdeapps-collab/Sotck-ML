import { describe, expect, it } from 'vitest';
import { parsePrediction, resample } from './llm';

const targets = [1, 2, 3, 4, 5].map((i) => i * 300_000);

describe('parsePrediction', () => {
  it('normaliza la respuesta y asigna cada precio a su hora', () => {
    const parsed = parsePrediction(
      JSON.stringify({ sesgo: 'Alcista', confianza: 140, razonamiento: ' Sube. ', niveles_clave: ['VWAP 100', 3], precios: [100, 101, 102, 101, 103] }),
      targets,
      100
    );
    if (typeof parsed === 'string') throw new Error(parsed);

    expect(parsed.bias).toBe('alcista');
    expect(parsed.confidence).toBe(100);
    expect(parsed.reasoning).toBe('Sube.');
    expect(parsed.keyLevels).toEqual(['VWAP 100']);
    expect(parsed.points).toEqual(targets.map((t, i) => ({ t, p: [100, 101, 102, 101, 103][i] })));
  });

  it('remuestrea si la IA contó un punto de más', () => {
    const parsed = parsePrediction({ sesgo: 'bearish', confianza: 60, precios: [100, 100, 100, 100, 100, 100] }, targets, 100);
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.bias).toBe('bajista');
    expect(parsed.points).toHaveLength(5);
  });

  it('rechaza json roto, precios absurdos o listas muy cortas', () => {
    expect(parsePrediction('no json', targets, 100)).toMatch(/json/);
    expect(parsePrediction({ sesgo: 'alcista', precios: [100, 100, 100, 100, 200] }, targets, 100)).toMatch(/imposibles/);
    expect(parsePrediction({ sesgo: 'alcista', precios: [100, 101] }, targets, 100)).toMatch(/2 precios/);
    expect(parsePrediction({ sesgo: 'quizá', precios: [100] }, targets, 100)).toMatch(/Sesgo/);
  });
});

describe('resample', () => {
  it('mantiene los extremos e interpola en medio', () => {
    expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
    expect(resample([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });
});
