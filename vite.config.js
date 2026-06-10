import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // Encaminha as chamadas /api para o backend Express (server/index.js).
    proxy: { '/api': 'http://localhost:3001' },
  },
})
