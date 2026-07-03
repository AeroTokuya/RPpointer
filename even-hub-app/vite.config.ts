import { defineConfig } from 'vite'

// Even Hub apps are packaged as static assets with relative paths.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { target: 'es2020', outDir: 'dist' },
})
