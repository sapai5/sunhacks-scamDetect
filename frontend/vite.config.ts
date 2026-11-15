import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // contracts/ and backend/ (shared types, rules, test scripts) live outside this folder.
    fs: { allow: ['..'] },
  },
});
