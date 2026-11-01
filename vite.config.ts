import { defineConfig } from 'vite';
import { cctvProxy } from './server/proxy.js';

export default defineConfig({
  plugins: [cctvProxy()],
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
