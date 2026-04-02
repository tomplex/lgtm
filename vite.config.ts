import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const backendPort = process.env.REVIEW_PORT || 9900;
const backendTarget = `http://127.0.0.1:${backendPort}`;

// Proxy API routes to the Express backend, serve index.html for page navigations
function projectProxy(): Plugin {
  return {
    name: 'project-proxy',
    configureServer(server) {
      // Runs before Vite's internal middleware.
      // /project/:slug/<subpath> with a subpath → proxy to backend (API call)
      // /project/:slug/ with no subpath → let Vite serve index.html (SPA navigation)
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        // Match /project/:slug/<something> — these are API calls
        const apiMatch = url.match(/^\/project\/[^/]+(\/[^?].*)$/);
        if (apiMatch) {
          // Let Vite's built-in proxy handle it (configured below)
          return next();
        }
        // /project/:slug/ or /project/:slug → SPA fallback
        if (url.match(/^\/project\/[^/]+\/?(\?.*)?$/)) {
          req.url = '/';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: 'frontend',
  plugins: [solidPlugin(), projectProxy()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // API calls: /project/:slug/data, /project/:slug/comments, etc.
      '/project': {
        target: backendTarget,
        bypass(req) {
          // Only proxy paths with a sub-resource (API calls)
          // Bare /project/:slug/ is handled by SPA fallback above
          const url = req.url || '';
          if (url.match(/^\/project\/[^/]+\/?(\?.*)?$/)) {
            return url; // skip proxy, serve from Vite
          }
        },
      },
      '/projects': {
        target: backendTarget,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
