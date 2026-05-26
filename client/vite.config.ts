/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite runs this config in Node, so `process` exists at runtime; declare just the
// slice we read here so the browser tsconfig needn't pull in full @types/node.
declare const process: { env: Record<string, string | undefined> };

// Dev server port + API proxy target default to local dev (5173 → :4100) but can be
// overridden via env so the E2E harness (playwright.config.ts) can run on isolated
// ports without colliding with — or reusing — a running `npm run dev`.
const DEV_PORT = Number(process.env.CLIENT_DEV_PORT) || 5173;
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
