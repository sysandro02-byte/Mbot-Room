import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number(process.env.VITE_API_PORT || 3004);
const androidBuild = String(process.env.MBOTEROOM_ANDROID_BUILD || '').toLowerCase() === 'true';

export default defineConfig({
  base: androidBuild ? './' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/socket.io': {
        target: `http://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    minify: 'esbuild',
  },
});
