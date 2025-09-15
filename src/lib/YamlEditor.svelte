<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import '../monaco-workers';
  // Monaco core CSS pieces (standalone)
  import 'monaco-editor-core/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
  import 'monaco-editor-core/esm/vs/editor/standalone/browser/standalone-tokens.css';
  import 'monaco-editor-core/esm/vs/base/browser/ui/scrollbar/media/scrollbars.css';
  // Lazy loaded monaco
  let monaco: typeof import('monaco-editor-core') | null = null;
  let yamlReady = false;
  // Track current detected language for UI badge
  let currentLanguage: 'YAML' | 'JSON' = 'YAML';
  import * as yaml from 'js-yaml';
  import type { Gateway, AnyRoute } from './shared';

  export let initialValue: string = '';
  // height prop no longer used externally; removed to silence unused export warning
  
  let container: HTMLDivElement;
  let resizeObserver: ResizeObserver | null = null;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let validationErrors: Array<{ line: number; column: number; message: string }> = [];
  let parsedObjects: { gateways: Gateway[]; routes: AnyRoute[] } = { gateways: [], routes: [] };
  let selectedSample: 'basic' | 'multi' = 'basic';
  // Import sample YAML files as raw text so we don't rely on fetch paths that may map to index.html
  // Using relative paths to repo root; Vite should allow this in monorepo workspace. If not, fallback could move samples under /public.
  // @ts-ignore - raw import query
  import basicSample from '../../data/sample.yaml?raw';
  // @ts-ignore - raw import query
  import multiSample from '../../data/sample-multi-gateways.yaml?raw';
  
  const dispatch = createEventDispatcher<{
    parse: { gateways: Gateway[]; routes: AnyRoute[] };
    error: Array<{ line: number; column: number; message: string }>;
  }>();

  onMount(async () => {
    if (!monaco) {
      monaco = await import('monaco-editor-core/esm/vs/editor/editor.api');
    }
    if (!yamlReady) {
      try {
        const { configureMonacoYaml } = await import('monaco-yaml');
        const gatewayApiCompositeSchema = {
          $id: 'inmemory://schema/gateway-api.json',
          type: 'object',
          oneOf: [
            { $ref: '#/definitions/Gateway' },
            { $ref: '#/definitions/HTTPRoute' },
              { $ref: '#/definitions/TLSRoute' },
              { $ref: '#/definitions/TCPRoute' },
              { $ref: '#/definitions/GRPCRoute' }
          ],
          definitions: {
            BaseMetadata: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 1 },
                namespace: { type: 'string' },
                labels: { type: 'object', additionalProperties: { type: 'string' } },
                annotations: { type: 'object', additionalProperties: { type: 'string' } }
              }
            },
            Gateway: {
              type: 'object',
              required: ['apiVersion','kind','metadata','spec'],
              properties: {
                apiVersion: { const: 'gateway.networking.k8s.io/v1beta1' },
                kind: { const: 'Gateway' },
                metadata: { $ref: '#/definitions/BaseMetadata' },
                spec: { type: 'object', properties: {}, additionalProperties: true }
              }
            },
            HTTPRoute: {
              type: 'object',
              required: ['apiVersion','kind','metadata','spec'],
              properties: {
                apiVersion: { const: 'gateway.networking.k8s.io/v1beta1' },
                kind: { const: 'HTTPRoute' },
                metadata: { $ref: '#/definitions/BaseMetadata' },
                spec: { type: 'object', properties: {}, additionalProperties: true }
              }
            },
            TLSRoute: {
              type: 'object',
              required: ['apiVersion','kind','metadata','spec'],
              properties: {
                apiVersion: { const: 'gateway.networking.k8s.io/v1beta1' },
                kind: { const: 'TLSRoute' },
                metadata: { $ref: '#/definitions/BaseMetadata' },
                spec: { type: 'object', properties: {}, additionalProperties: true }
              }
            },
            TCPRoute: {
              type: 'object',
              required: ['apiVersion','kind','metadata','spec'],
              properties: {
                apiVersion: { const: 'gateway.networking.k8s.io/v1beta1' },
                kind: { const: 'TCPRoute' },
                metadata: { $ref: '#/definitions/BaseMetadata' },
                spec: { type: 'object', properties: {}, additionalProperties: true }
              }
            },
            GRPCRoute: {
              type: 'object',
              required: ['apiVersion','kind','metadata','spec'],
              properties: {
                apiVersion: { const: 'gateway.networking.k8s.io/v1beta1' },
                kind: { const: 'GRPCRoute' },
                metadata: { $ref: '#/definitions/BaseMetadata' },
                spec: { type: 'object', properties: {}, additionalProperties: true }
              }
            }
          }
        };
        configureMonacoYaml(monaco, {
          enableSchemaRequest: false,
          hover: true,
          completion: true,
          validate: true,
          format: true,
          schemas: [
            {
              uri: 'inmemory://schema/gateway-api.json',
              fileMatch: ['*'],
              schema: gatewayApiCompositeSchema
            }
          ]
        });
        yamlReady = true;
      } catch (e) {
        console.error('Failed to load monaco-yaml configureMonacoYaml', e);
      }
    }
    // Register language ids explicitly (guard against duplicates)
    if (!monaco.languages.getLanguages().some(l => l.id === 'yaml')) {
      monaco.languages.register({ id: 'yaml' });
    }
    // We don't add JSON language feature set (not bundled); keep id alias for potential future schema support
    if (!monaco.languages.getLanguages().some(l => l.id === 'json')) {
      monaco.languages.register({ id: 'json' });
    }
    monaco.languages.setMonarchTokensProvider('yaml', {
      tokenizer: {
        root: [
          [/^(\s*)([-+]?)(\s*)([^:\s]+)(\s*)(:)/, ['', 'tag', '', 'key', '', 'delimiter']],
          [/^(\s*)(-\s+)([^:\s]+)(\s*)(:)/, ['', 'tag', 'key', '', 'delimiter']],
          [/^(\s*)([^:\s]+)(\s*)(:)/, ['', 'key', '', 'delimiter']],
          [/^\s*-/, 'tag'],
          [/#.*$/, 'comment'],
          [/"[^"]*"/, 'string'],
          [/'[^']*'/, 'string'],
          [/\d+/, 'number'],
          [/true|false/, 'keyword'],
          [/null/, 'keyword'],
        ]
      }
    });

    // Define light theme
  monaco.editor.defineTheme('yamlLight', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'key', foreground: '0451a5' },
        { token: 'string', foreground: 'a31515' },
        { token: 'number', foreground: '098658' },
        { token: 'keyword', foreground: '0000ff' },
        { token: 'comment', foreground: '008000' },
        { token: 'delimiter', foreground: '000000' },
        { token: 'tag', foreground: '800000' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#24292e',
        'editor.lineHighlightBackground': '#f6f8fa',
        'editorLineNumber.foreground': '#586069',
        'editorLineNumber.activeForeground': '#24292e',
      }
    });

    // Define dark theme  
  monaco.editor.defineTheme('yamlDark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'key', foreground: '79c0ff' },
        { token: 'string', foreground: 'a5d6ff' },
        { token: 'number', foreground: '79c0ff' },
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'comment', foreground: '8b949e' },
        { token: 'delimiter', foreground: 'e6edf3' },
        { token: 'tag', foreground: 'ffa657' },
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#e6edf3',
        'editor.lineHighlightBackground': '#161b22',
        'editorLineNumber.foreground': '#7d8590',
        'editorLineNumber.activeForeground': '#e6edf3',
      }
    });

    // Determine initial theme
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const theme = isDark ? 'yamlDark' : 'yamlLight';

  editor = monaco.editor.create(container, {
    value: initialValue,
  language: 'yaml', // default (will auto-switch if JSON detected)
      theme: theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      folding: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
      lineHeight: 1.6,
      padding: { top: 16, bottom: 16 },
    });

    // Force layout after flex sizing settles
    requestAnimationFrame(() => editor?.layout());
    setTimeout(() => editor?.layout(), 250);

    // Observe container resize to force layout (sometimes automaticLayout misses flex changes)
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        editor?.layout();
      });
      resizeObserver.observe(container);
    }

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      if (editor) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'yamlDark' : 'yamlLight';
        monaco.editor.setTheme(newTheme);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Set up validation on content change
    editor.onDidChangeModelContent(() => {
      detectAndSetLanguage();
      validateContent();
    });

    // Initial validation
    detectAndSetLanguage();
    validateContent();

    // Cleanup observer on destroy
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  });

  onDestroy(() => {
    if (editor) {
      editor.dispose();
    }
  });

  function detectAndSetLanguage() {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const value = editor.getValue();
    const trimmed = value.trim();
    if (!trimmed) return;
  // Detect JSON if it starts with { or [ (no escape needed for [ inside character class)
  const isJson = /^[{[]/.test(trimmed);
    const target = isJson ? 'json' : 'yaml';
    if (model.getLanguageId() !== target) {
      monaco.editor.setModelLanguage(model, target);
    }
    currentLanguage = isJson ? 'JSON' : 'YAML';
  }

  function validateContent() {
  if (!editor || !monaco) return;

    const content = editor.getValue();
    validationErrors = [];
    parsedObjects = { gateways: [], routes: [] };

    if (!content.trim()) {
      updateMarkers();
      dispatch('parse', parsedObjects);
      return;
    }

    try {
      // Split YAML documents by ---
      const documents = content.split(/^---\s*$/m).filter(doc => doc.trim());
      const allObjects: any[] = [];

      for (const doc of documents) {
        try {
          const parsed = yaml.load(doc);
          if (parsed && typeof parsed === 'object') {
            allObjects.push(parsed);
          }
        } catch (parseError: any) {
          // Extract line number from error
          const match = parseError.message.match(/at line (\d+)/);
          const line = match ? parseInt(match[1]) : 1;
          validationErrors.push({
            line,
            column: 1,
            message: `YAML Parse Error: ${parseError.message}`
          });
        }
      }

      // Validate and categorize objects
      for (const obj of allObjects) {
        try {
          validateKubernetesObject(obj);
          
          if (obj.kind === 'Gateway') {
            parsedObjects.gateways.push(obj as Gateway);
          } else if (['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'].includes(obj.kind)) {
            parsedObjects.routes.push(obj as AnyRoute);
          } else {
            validationErrors.push({
              line: 1,
              column: 1,
              message: `Unsupported kind: ${obj.kind}. Expected Gateway, HTTPRoute, TLSRoute, TCPRoute, or GRPCRoute.`
            });
          }
        } catch (validationError: any) {
          validationErrors.push({
            line: 1,
            column: 1,
            message: `Validation Error: ${validationError.message}`
          });
        }
      }

      updateMarkers();
      
      if (validationErrors.length === 0) {
        dispatch('parse', parsedObjects);
      } else {
        dispatch('error', validationErrors);
      }

    } catch (error: any) {
      validationErrors.push({
        line: 1,
        column: 1,
        message: `Error processing YAML: ${error.message}`
      });
      updateMarkers();
      dispatch('error', validationErrors);
    }
  }

  function validateKubernetesObject(obj: any) {
    if (!obj.apiVersion) {
      throw new Error('Missing required field: apiVersion');
    }
    if (!obj.kind) {
      throw new Error('Missing required field: kind');
    }
    if (!obj.metadata?.name) {
      throw new Error('Missing required field: metadata.name');
    }
    
    // Validate specific object types
    if (obj.kind === 'Gateway') {
      if (!obj.spec) {
        throw new Error('Gateway missing required field: spec');
      }
    } else if (['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'].includes(obj.kind)) {
      if (!obj.spec) {
        throw new Error(`${obj.kind} missing required field: spec`);
      }
    }
  }

  function updateMarkers() {
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

  const markers = validationErrors.map(error => ({
      severity: monaco.MarkerSeverity.Error,
      startLineNumber: error.line,
      startColumn: error.column,
      endLineNumber: error.line,
      endColumn: Number.MAX_SAFE_INTEGER,
      message: error.message,
    }));

  monaco.editor.setModelMarkers(model, 'yaml-validation', markers);
  }

  export function getValue(): string {
    return editor?.getValue() || '';
  }

  export function setValue(value: string) {
    if (editor) {
      editor.setValue(value);
    }
  }

  function loadSample(name: 'basic' | 'multi') {
    const text = name === 'basic' ? basicSample : multiSample;
    setValue((text || '').trimStart());
  }
</script>

<style>
  /* Monaco editor container uses Tailwind classes, only custom Monaco theming here */
  .monaco-editor {
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
  }
  
  /* Dark theme adjustments for Monaco */
  :global(.dark) .monaco-editor.vs-dark .margin,
  :global(.dark) .monaco-editor.vs-dark .monaco-editor-background {
    background-color: hsl(var(--b3)) !important;
  }
  
  :global(.dark) .monaco-editor.vs-dark .current-line {
    background-color: hsl(var(--b2)) !important;
  }
  
  :global(.dark) .monaco-editor.vs-dark .line-numbers {
    color: hsl(var(--bc) / 0.6) !important;
  }
  
  /* Light theme adjustments for Monaco */
  :global(.light) .monaco-editor.vs .margin,
  :global(.light) .monaco-editor.vs .monaco-editor-background {
    background-color: hsl(var(--b1)) !important;
  }
  
  :global(.light) .monaco-editor.vs .current-line {
    background-color: hsl(var(--b2)) !important;
  }
  
  :global(.light) .monaco-editor.vs .line-numbers {
    color: hsl(var(--bc) / 0.6) !important;
  }
</style>

<div class="h-full flex flex-col bg-base-100 border border-base-300 rounded-lg overflow-hidden min-h-0"
  style="min-height:0;">
  <div class="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300">
    <div class="flex items-center gap-3">
      <span class="badge badge-sm badge-outline" title="Detected language mode">{currentLanguage}</span>
      <div class="text-sm font-medium text-base-content">
        {#if validationErrors.length > 0}
          <div class="flex items-center gap-2 text-error">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
            {validationErrors.length} error{validationErrors.length !== 1 ? 's' : ''}
          </div>
        {:else if parsedObjects.gateways.length + parsedObjects.routes.length > 0}
          <div class="flex items-center gap-2 text-success">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
            </svg>
            {parsedObjects.gateways.length} gateway{parsedObjects.gateways.length !== 1 ? 's' : ''}, 
            {parsedObjects.routes.length} route{parsedObjects.routes.length !== 1 ? 's' : ''}
          </div>
        {:else}
          <div class="flex items-center gap-2 text-base-content/60">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clip-rule="evenodd"></path>
            </svg>
            No YAML content
          </div>
        {/if}
      </div>
    </div>
    
    <div class="flex items-center gap-2">
      <select class="select select-sm select-bordered" bind:value={selectedSample} title="Choose sample dataset">
        <option value="basic">Basic sample</option>
        <option value="multi">Multi-gateway (20 routes)</option>
      </select>
      <button 
        class="btn btn-sm btn-primary" 
        on:click={() => loadSample(selectedSample)}
        title="Load selected sample YAML"
      >
        <svg class="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"></path>
        </svg>
        Insert Sample
      </button>
    </div>
  </div>
  
  <div bind:this={container} class="flex-1 min-h-0" style="width:100%;height:100%;min-height:0;">
  </div>
</div>