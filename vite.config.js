import { defineConfig } from 'vite';
import { resolve } from 'path';

const r = p => resolve(process.cwd(), p);

export default defineConfig({
  base: '/token-cost-sim/',
  build: {
    rollupOptions: {
      input: {
        main:       r('index.html'),
        quadratic:  r('pages/quadratic.html'),
        sim:        r('pages/simulator.html'),
        oneshot:    r('pages/one-shot.html'),
        contextTax: r('pages/context-tax.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    reporters: ['verbose'],
  },
});
