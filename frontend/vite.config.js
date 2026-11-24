import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://server:8000',
        ws: true,
      },
    },
  },
});
