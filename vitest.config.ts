import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Solo las funciones puras del Lab.
 *
 * No hay entorno DOM ni testing-library a propósito: lo que se prueba aquí es
 * aritmética de trading (P&L, tamaño de posición, guardarraíles), que no
 * necesita renderizar nada. Los módulos que tocan `localStorage` se cubren con
 * un doble mínimo en el propio test.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
