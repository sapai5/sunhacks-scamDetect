import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The service worker is its own entry and must be served as /sw.js (no hash) for registration.
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        sw: fileURLToPath(new URL('src/sw.ts', import.meta.url)),
      },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  server: {
    // contracts/ and backend/ (shared types, rules, test scripts) live outside this folder.
    fs: { allow: ['..'] },
  },
});
