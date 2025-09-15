import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import svelteConfig from './svelte.config.js';

const REPO = "gateway-api-visualizer";

export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : `/${REPO}/`,
  plugins: [svelte({ ...svelteConfig })],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: [
            'monaco-editor-core/esm/vs/editor/editor.api'
          ]
        }
      }
    }
  }
}));
