import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';

// SPA fallback: serve index.html for /project/* routes so Vite HMR works
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/project/') && !req.url.includes('.')) {
          req.url = '/';
        }
        next();
      });
    },
  };
}

const backendPort = process.env.REVIEW_PORT || 9900;

export default defineConfig({
  root: 'frontend',
  plugins: [solidPlugin(), spaFallback()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/project': {
        target: `http://127.0.0.1:${backendPort}`,
        bypass(req) {
          // Only proxy API calls (JSON/SSE), not page navigations
          const accept = req.headers.accept || '';
          if (accept.includes('text/html')) return req.url;
        },
      },
      '/projects': {
        target: `http://127.0.0.1:${backendPort}`,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
