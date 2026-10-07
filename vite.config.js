import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // React num chunk próprio: não reduz bytes, mas o hash só muda quando o
    // React muda, então o navegador não rebaixa 138 KiB a cada deploy.
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'scheduler'] } } },
  },
  server: {
    open: true,
    // Encaminha as chamadas /api para o backend Express (server/index.js).
    proxy: { '/api': 'http://localhost:3001' },
  },
})
