import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // UTC, unlike the display zone of the tests (America/Santiago): code that reads the process
    // zone instead of the one it is given gives the wrong answer on every machine.
    env: { TZ: 'UTC' },
  },
});
