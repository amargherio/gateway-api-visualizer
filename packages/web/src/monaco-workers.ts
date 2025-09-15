// Custom Monaco Environment providing only the workers we need (editor + JSON + YAML)
// Dynamic imports so they can be code-split.

// NOTE: Using monaco-editor-core; workers must be referenced directly.
// Vite will bundle these as separate chunks.

// We intentionally do NOT include all default languages to keep bundle size small.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'yaml') {
      // NOTE: yaml.worker.js from monaco-yaml is built as a classic (AMD) worker, not an ES module.
      // Using { type: 'module' } prevents the AMD loader from executing properly, leading to
      // missing RPC methods like 'doValidation' (manifesting as: Missing requestHandler or method: doValidation).
      // Therefore we intentionally omit the second options argument for the YAML worker.
      return new Worker(new URL('monaco-yaml/yaml.worker.js', import.meta.url));
    }
    // The core editor worker shipped in monaco-editor-core is ESM-friendly; keep module type for tree-shaken build.
    return new Worker(new URL('monaco-editor-core/esm/vs/editor/editor.worker.start.js', import.meta.url), { type: 'module' });
  }
};
