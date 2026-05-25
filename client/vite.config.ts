import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 5173; proxy /api to the Express server on 4100.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
