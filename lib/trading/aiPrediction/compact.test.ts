import { describe, expect, it } from 'vitest';
import { compactJson } from './compact';

describe('compactJson', () => {
  it('redondea, recorta listas a sus últimos elementos, corta textos y quita nulos', () => {
    expect(
      compactJson({ a: 1.23456789, b: [1, 2, 3, 4], c: 'abcdef', d: null, e: { f: NaN } }, { maxArray: 2, maxString: 3 })
    ).toEqual({ a: 1.23457, b: [3, 4], c: 'abc…', e: {} });
  });
});
