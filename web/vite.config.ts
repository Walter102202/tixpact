import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // near-api-js pulls in the `util` polyfill, which reads Node's `process` when it loads; the
  // browser has none. Replace those reads at build time.
  define: {
    'process.env.NODE_DEBUG': 'false',
    'process.throwDeprecation': 'false',
    'process.traceDeprecation': 'false',
    'process.noDeprecation': 'false',
  },
  server: { port: 5173, strictPort: true },
});
