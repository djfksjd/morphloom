import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 4173,
    strictPort: true,
    watch: {
      ignored: ['**/work/**', '**/dist/**', '**/benchmarks/results/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
