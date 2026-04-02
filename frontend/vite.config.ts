import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
      '/project': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
      '/projects': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
