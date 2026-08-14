import {fileURLToPath, URL} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: sourceRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': sourceRoot,
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist-source-renderer/', import.meta.url)),
    emptyOutDir: true,
  },
});
