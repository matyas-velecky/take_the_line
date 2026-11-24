import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/': {
        target: 'http://server:8000',
        ws: true,
      },
    },
  },
});
