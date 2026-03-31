import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/data': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/items': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/commits': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/context': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/file': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/submit': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/comments': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/events': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
    },
  },
});
