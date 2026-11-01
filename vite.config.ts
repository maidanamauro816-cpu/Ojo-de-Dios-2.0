import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true
  },
  preview: {
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
