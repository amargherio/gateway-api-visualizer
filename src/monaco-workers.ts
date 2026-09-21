// The editor and monaco-yaml share Monaco's initialize/createData worker protocol.
// Vite bundles the ESM worker sources without loading the full language bundle.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'yaml') {
      return new Worker(new URL('monaco-yaml/yaml.worker.js', import.meta.url), { type: 'module' });
    }
    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });
  }
};
