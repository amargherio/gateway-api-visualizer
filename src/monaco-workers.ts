// The manager host patch sends Monaco's bootstrap and createData messages.
// Vite bundles the ESM worker sources without loading the full language bundle.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'yaml') {
      return new Worker(new URL('monaco-yaml/yaml.worker.js', import.meta.url), { type: 'module' });
    }
    return new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
      type: 'module',
    });
  },
};
