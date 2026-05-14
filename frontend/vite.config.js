import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          charts: ['recharts'],
          realtime: ['socket.io-client'],
          capture: ['react-webcam'],
          http: ['axios'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        configure: quietProxyAbort,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        configure: quietProxyAbort,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
        configure: quietProxyAbort,
      }
    }
  }
})
