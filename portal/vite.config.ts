import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Hosted as a GitHub Pages PROJECT site at https://<user>.github.io/vendor-risk-portal/,
// so assets must resolve under that sub-path.
export default defineConfig({
  base: '/vendor-risk-portal/',
  plugins: [react()],
  // styles.css imports the canonical design tokens from ../design-system (outside the portal
  // root), so let Vite's dev server read one level up.
  server: { fs: { allow: ['..'] } },
});
