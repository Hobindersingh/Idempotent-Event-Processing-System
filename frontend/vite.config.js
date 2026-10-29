import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the backend during local development so the browser
    // never hits a CORS preflight (the Vite dev server and the backend are on
    // different ports). Requests to /accounts, /dlq, /metrics and /healthz are
    // forwarded transparently; everything else is served by Vite itself.
    proxy: {
      '/accounts': 'http://localhost:8000',
      '/dlq': 'http://localhost:8000',
      '/metrics': 'http://localhost:8000',
      '/healthz': 'http://localhost:8000',
    },
  },
  preview: { port: 5173 },
});
