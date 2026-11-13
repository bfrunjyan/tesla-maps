import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tesla's in-car browser is Chromium; keep the output conservative.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rolldownOptions: {
      output: {
        // Big libraries in their own long-cached files: after a deploy the car
        // re-downloads only the (small) app code.
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl/, priority: 2 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
  // MapLibre 6 loads its worker relative to its own module URL; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5174,
    strictPort: true,
    // API server (npm run dev:api) runs on 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
