import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import svelteConfig from './svelte.config.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPO = "gateway-api-visualizer";

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
    gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore','pipe','ignore'] }).toString().trim();
  } catch (e) {
    // ignore
  }
  const buildId = `${version}+${gitHash}`;
  return {
    base: mode === 'development' ? '/' : `/${REPO}/`,
    plugins: [svelte({ ...svelteConfig })],
    optimizeDeps: {
      // This CommonJS dependency is only reached inside the YAML worker.
      include: ['monaco-yaml > path-browserify']
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __GIT_HASH__: JSON.stringify(gitHash),
      __BUILD_ID__: JSON.stringify(buildId)
    },
    server: {
      port: 5173
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Preserve Vite 7's browser support floor during the bundler migration.
      target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'monaco',
                test: /monaco-editor[\\/]esm[\\/]vs[\\/]editor\.js$/,
                includeDependenciesRecursively: true
              }
            ]
          }
        }
      }
    }
  };
});
