import { defineConfig, type Connect, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import svelteConfig from './svelte.config.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO = 'gateway-api-visualizer';

// Run after static-file handling, but before Vite's HTML transform middleware.
function missingPageFallback(
  loadHtml: (url: string) => string | Promise<string>,
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const pathname = request.url?.split('?')[0];
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      !request.headers.accept?.includes('text/html') ||
      pathname === '/index.html' ||
      pathname === '/404.html'
    ) {
      next();
      return;
    }
    try {
      const html = await loadHtml(request.originalUrl || request.url || '/');
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : html);
    } catch (error) {
      next(error);
    }
  };
}

const missingPagePlugin: Plugin = {
  name: 'missing-page',
  configureServer(server) {
    return () => {
      server.middlewares.use(
        missingPageFallback((url) =>
          server.transformIndexHtml(
            '/404.html',
            readFileSync(resolve(server.config.root, '404.html'), 'utf8'),
            url,
          ),
        ),
      );
    };
  },
  configurePreviewServer(server) {
    const html = readFileSync(
      resolve(server.config.root, server.config.build.outDir, '404.html'),
      'utf8',
    );
    return () => {
      server.middlewares.use(missingPageFallback(() => html));
    };
  },
};

export default defineConfig(({ mode }) => {
  // Safely read package version
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
    version = pkg.version || version;
  } catch (e) {
    // ignore
  }
  // Attempt to get current git short hash. If unavailable (e.g. tarball), fallback.
  let gitHash = 'unknown';
  try {
    gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (e) {
    // ignore
  }
  const buildId = `${version}+${gitHash}`;
  return {
    base: mode === 'development' ? '/' : `/${REPO}/`,
    appType: 'mpa',
    plugins: [svelte({ ...svelteConfig }), missingPagePlugin],
    optimizeDeps: {
      // This CommonJS dependency is only reached inside the YAML worker.
      include: ['monaco-yaml > path-browserify'],
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __GIT_HASH__: JSON.stringify(gitHash),
      __BUILD_ID__: JSON.stringify(buildId),
    },
    server: {
      port: 5173,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Preserve Vite 7's browser support floor during the bundler migration.
      target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
        },
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'monaco',
                test: /monaco-editor[\\/]esm[\\/]vs[\\/]editor\.js$/,
                includeDependenciesRecursively: true,
              },
            ],
          },
        },
      },
    },
  };
});
