import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  build: { rollupOptions: { output: { manualChunks: { framework: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } } } },
  server: {
    allowedHosts: ['web'],
    proxy: { '/api': { target: 'http://api:3000', configure(proxy) { proxy.on('proxyReq', (proxyRequest, request) => { proxyRequest.setHeader('X-Forwarded-For', request.socket.remoteAddress || '127.0.0.1'); }); } } },
    watch: { usePolling: process.env.VITE_POLLING === 'true' }
  }
});
