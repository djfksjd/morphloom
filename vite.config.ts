import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js is an intentional shared runtime chunk; keep the application
    // bundle separate while warning only above the known vendor envelope.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
          return undefined;
        },
      },
    },
  },
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
