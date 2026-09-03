import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // The exact triangle-intersection suites are intentionally CPU-heavy.
    // Serial file execution keeps CI results deterministic and prevents the
    // runner RPC from timing out while several geometry audits compete.
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Model-comparison sandboxes intentionally contain copied test trees.
    // Never count or execute those snapshots as project verification.
    exclude: ['**/node_modules/**', '**/dist/**', '**/work/**', '**/tmp/**', '**/.git/**'],
  },
  build: {
    // Three.js is an intentional shared runtime chunk; keep the application
    // bundle separate while warning only above the known vendor envelope.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: 'index.html',
        holdoutReview: 'holdout-review.html',
      },
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
    entries: ['index.html', 'holdout-review.html'],
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
