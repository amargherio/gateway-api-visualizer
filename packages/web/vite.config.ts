import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import svelteConfig from './svelte.config.js';

export default defineConfig({
  plugins: [svelte({ ...svelteConfig })],
  server: {
    port: 5173
  },
  build: {
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
});
