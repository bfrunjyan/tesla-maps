import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tesla's in-car browser is Chromium; keep the output conservative.
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2020' },
  worker: { format: 'es' },
  // MapLibre 6 loads its worker relative to its own module URL; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { port: 5174, strictPort: true },
})
