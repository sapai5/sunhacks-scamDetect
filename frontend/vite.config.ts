import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared types with the Lambdas, and the pure rules/test scripts reused by the mock backend.
      '@contracts': fromRoot('../contracts/index.ts'),
      '@backend': fromRoot('../backend'),
    },
  },
  test: { environment: 'node' },
});
