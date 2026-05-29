import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const chunkGroups = {
  react: ['react', 'react-dom', 'react-router-dom'],
  motion: ['framer-motion'],
  charts: ['recharts'],
  realtime: ['socket.io-client'],
  capture: ['react-webcam'],
  http: ['axios'],
};

const manualChunks = (id) => {
  if (!id.includes('node_modules')) return undefined;
  const normalized = id.replace(/\\/g, '/');
  const match = Object.entries(chunkGroups).find(([, packages]) => (
    packages.some(pkg => normalized.includes(`/node_modules/${pkg}/`))
  ));
  return match?.[0];
};

const quietProxyAbort = (proxy) => {
  proxy.on('error', (err) => {
    if (['ECONNABORTED', 'ECONNRESET', 'EPIPE'].includes(err?.code)) return;
    console.error('[vite] proxy error:', err);
  });
};

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        configure: quietProxyAbort,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        configure: quietProxyAbort,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        ws: true,
        configure: quietProxyAbort,
      }
    }
  }
})
