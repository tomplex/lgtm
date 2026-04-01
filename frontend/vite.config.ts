import { defineConfig } from 'vite';

export default defineConfig({
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
});
