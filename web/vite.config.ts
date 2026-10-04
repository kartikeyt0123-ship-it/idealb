import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
  build: {
    // The engineering terminal (Monaco) is lazy-loaded, so it lands in its own chunk.
    chunkSizeWarningLimit: 4000,
  },
});
