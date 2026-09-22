<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import '../monaco-workers';
  import 'monaco-editor/features/codicon/register.js';
  import * as yaml from 'js-yaml';
  import type { MonacoYaml } from 'monaco-yaml';
  import type {
    Gateway,
    AnyRoute,
    Service,
    Deployment,
    StatefulSet,
    DaemonSet,
    GatewayClass,
    ReferenceGrant,
  } from './shared.js';
  import type {
    GatewayApiAuditState,
    GatewayApiBundle,
    GatewayApiDiagnostic,
    GatewayApiVersion,
  } from './gatewayApi.js';
  import { splitYamlDocumentsWithLocations } from './yamlDocuments.js';
  import { containsPotentialSecrets } from './secretDetection.js';
  // @ts-ignore - raw import query
  import basicSample from '../../data/sample.yaml?raw';
  // @ts-ignore - raw import query
  import multiSample from '../../data/sample-multi-gateways.yaml?raw';

  type ParsedObjects = {
    gateways: Gateway[];
    routes: AnyRoute[];
    services: Service[];
    deployments: Deployment[];
    statefulSets: StatefulSet[];
    daemonSets: DaemonSet[];
    gatewayClasses: GatewayClass[];
    referenceGrants: ReferenceGrant[];
  };

  type ParserDiagnostic = { line: number; column: number; message: string };
  type SchemaRequest = {
    generation: number;
    version: GatewayApiVersion;
    bundle: GatewayApiBundle | null;
    loadError: string | null;
  };
  type Disposable = { dispose(): void };


  const EMPTY_PARSED_OBJECTS = (): ParsedObjects => ({
    gateways: [],
    routes: [],
    services: [],
    deployments: [],
    statefulSets: [],
    daemonSets: [],
    gatewayClasses: [],
    referenceGrants: [],
  });
  const GATEWAY_API_GROUPS = new Set([
    'gateway.networking.k8s.io',
    'gateway.networking.x-k8s.io',
  ]);
  const DEBOUNCE_MS = 350;
  const FOCUS_COOLDOWN_MS = 250;

  export let initialValue = '';
  export let gatewayApiVersion: GatewayApiVersion = '1.6';
  export let gatewayApiBundle: GatewayApiBundle | null = null;
  export let gatewayApiLoadError: string | null = null;

  let container: HTMLDivElement;
  let monaco: typeof import('monaco-editor/editor') | null = null;
  let editor: import('monaco-editor/editor').editor.IStandaloneCodeEditor | null = null;
  let yamlService: MonacoYaml | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let markerSubscription: Disposable | null = null;
  let editorDisposables: Disposable[] = [];
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let layoutHandle: number | null = null;
  let delayedLayoutHandle: ReturnType<typeof setTimeout> | null = null;
  let mounted = false;
  let destroyed = false;
  let schemaUpdateInFlight = false;
  let schemaUpdateGeneration = 0;
  let activeSchemaGeneration = 0;
  let yamlServiceConfigured = false;
  let validatorInitializationInProgress = false;
  let validatorInitializationFailed = false;

  let activeSchemaVersion: GatewayApiVersion | null = null;
  let pendingSchemaRequest: SchemaRequest | null = null;

  let currentLanguage: 'YAML' | 'JSON' = 'YAML';
  let validationErrors: ParserDiagnostic[] = [];
  let crdDiagnostics: GatewayApiDiagnostic[] = [];
  let parsedObjects: ParsedObjects = EMPTY_PARSED_OBJECTS();
  let selectedSample: 'basic' | 'multi' = 'basic';
  let secretDetected: { reasons: string[] } | null = null;
  let lastFocusTime = 0;
  let errorsExpanded = false;
  let crdDiagnosticsExpanded = false;

  const dispatch = createEventDispatcher<{
    parse: ParsedObjects;
    error: ParserDiagnostic[];
    audit: GatewayApiAuditState;
  }>();

  $: queueSchemaUpdate(gatewayApiVersion, gatewayApiBundle, gatewayApiLoadError);
  $: errorsExpanded = validationErrors.length > 0;
  $: crdDiagnosticsExpanded = crdDiagnostics.length > 0;

  onMount(() => {
    mounted = true;
    void initializeEditor();
  });

  onDestroy(() => {
    destroyed = true;
    mounted = false;
    if (debounceHandle) clearTimeout(debounceHandle);
    if (delayedLayoutHandle) clearTimeout(delayedLayoutHandle);
    if (layoutHandle !== null) cancelAnimationFrame(layoutHandle);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    markerSubscription?.dispose();
    editorDisposables.forEach(disposable => disposable.dispose());
    editorDisposables = [];
    const model = editor?.getModel();
    editor?.dispose();
    model?.dispose();
    yamlService?.dispose();
    editor = null;
    yamlService = null;
  });

  async function initializeEditor() {
    if (validatorInitializationInProgress || yamlServiceConfigured) return;
    validatorInitializationInProgress = true;
    try {
      monaco = await import('monaco-editor/editor');
      if (destroyed) return;

      if (!editor) {
        if (!monaco.languages.getLanguages().some(language => language.id === 'yaml')) {
          monaco.languages.register({ id: 'yaml' });
        }
        configureYamlTokens();
        configureThemes();

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        editor = monaco.editor.create(container, {
          value: initialValue,
          language: 'yaml',
          theme: isDark ? 'yamlDark' : 'yamlLight',
          ariaLabel: 'Manifest YAML or JSON editor',
          tabFocusMode: true,
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

        layoutHandle = requestAnimationFrame(() => editor?.layout());
        delayedLayoutHandle = setTimeout(() => editor?.layout(), 250);
        setupEditorObservers();
        detectLanguageForBadge();
        validateContent();
      }

      const { configureMonacoYaml } = await import('monaco-yaml');
      if (destroyed || !monaco) return;
      yamlService = configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        hover: true,
        completion: true,
        validate: true,
        format: { enable: true },
        schemas: [],
      });
      yamlServiceConfigured = true;
      validatorInitializationFailed = false;
      processSchemaUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!yamlServiceConfigured) validatorInitializationFailed = true;
      crdDiagnostics = [];
      dispatch('audit', {
        version: gatewayApiVersion,
        status: 'error',
        diagnostics: [],
        message: `Could not initialize CRD validation: ${message}`,
      });
    } finally {
      validatorInitializationInProgress = false;
    }
  }

  function configureYamlTokens() {
    if (!monaco) return;
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
        ],
      },
    });
  }

  function configureThemes() {
    if (!monaco) return;
    monaco.editor.defineTheme('yamlLight', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'key', foreground: '0451a5' },
        { token: 'string', foreground: 'a31515' },
        { token: 'number', foreground: '087448' },
        { token: 'keyword', foreground: '0000ff' },
        { token: 'comment', foreground: '008000' },
        { token: 'delimiter', foreground: '263738' },
        { token: 'tag', foreground: '800000' },
      ],
      colors: {
        'editor.background': '#f8fbfb',
        'editor.foreground': '#263738',
        'editor.lineHighlightBackground': '#edf3f3',
        'editorLineNumber.foreground': '#607679',
        'editorLineNumber.activeForeground': '#263738',
      },
    });
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
        'editor.background': '#162526',
        'editor.foreground': '#e6eeee',
        'editor.lineHighlightBackground': '#26393b',
        'editorLineNumber.foreground': '#9ab0b3',
        'editorLineNumber.activeForeground': '#e6eeee',
      },
    });
  }

  function setupEditorObservers() {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    resizeObserver = new ResizeObserver(() => editor?.layout());
    resizeObserver.observe(container);
    themeObserver = new MutationObserver(() => {
      if (!monaco) return;
      monaco.editor.setTheme(
        document.documentElement.getAttribute('data-theme') === 'dark' ? 'yamlDark' : 'yamlLight',
      );
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    markerSubscription = monaco.editor.onDidChangeMarkers(resources => {
      if (schemaUpdateInFlight || !resources.some(resource => resource.toString() === model.uri.toString())) {
        return;
      }
      publishCurrentWorkerDiagnostics();
    });
    editorDisposables = [
      editor.onDidChangeModelContent(() => {
        if (debounceHandle) clearTimeout(debounceHandle);
        const elapsedSinceFocus = performance.now() - lastFocusTime;
        const focusDelay = elapsedSinceFocus < FOCUS_COOLDOWN_MS ? FOCUS_COOLDOWN_MS - elapsedSinceFocus : 0;
        debounceHandle = setTimeout(() => {
          debounceHandle = null;
          detectLanguageForBadge();
          validateContent();
        }, DEBOUNCE_MS + focusDelay);
      }),
      editor.onDidBlurEditorWidget(() => {
        if (debounceHandle) clearTimeout(debounceHandle);
        debounceHandle = null;
        detectLanguageForBadge();
        validateContent();
      }),
      editor.onDidFocusEditorWidget(() => {
        lastFocusTime = performance.now();
      }),
    ];
  }

  function queueSchemaUpdate(
    version: GatewayApiVersion,
    bundle: GatewayApiBundle | null,
    loadError: string | null,
  ) {
    const request: SchemaRequest = {
      generation: ++schemaUpdateGeneration,
      version,
      bundle,
      loadError,
    };
    pendingSchemaRequest = request;
    if (mounted && validatorInitializationFailed && !validatorInitializationInProgress) {
      void initializeEditor();
    }

    if (bundle === null) crdDiagnostics = [];
    processSchemaUpdates();
  }

  async function processSchemaUpdates() {
    if (!mounted || destroyed || !yamlService || !editor || schemaUpdateInFlight) return;
    schemaUpdateInFlight = true;
    try {
      while (pendingSchemaRequest && !destroyed) {
        const request = pendingSchemaRequest;
        pendingSchemaRequest = null;
        await applySchemaRequest(request);
      }
    } finally {
      schemaUpdateInFlight = false;
      if (pendingSchemaRequest && !destroyed) processSchemaUpdates();
    }
  }

  async function applySchemaRequest(request: SchemaRequest) {
    if (!yamlService || !editor || !monaco) return;
    const schema = request.bundle?.schema;
    const validBundle = Boolean(
      request.bundle && schema && typeof schema === 'object' && request.bundle.id === request.version,
    );
    const schemas = validBundle
      ? [{ uri: String(schema!.$id || `inmemory://schema/gateway-api/${request.bundle!.tag}.json`), fileMatch: ['*'], schema: schema! }]
      : [];

    if (!validBundle) {
      const model = editor.getModel();
      if (model) monaco.editor.setModelMarkers(model, 'yaml', []);
    }

    if (isCurrentRequest(request)) {
      crdDiagnostics = [];
      dispatch('audit', {
        version: request.version,
        status: request.loadError || !validBundle ? (request.loadError ? 'error' : 'loading') : 'loading',
        diagnostics: [],
        ...(request.loadError ? { message: request.loadError } : {}),
      });
    }

    try {
      // update() replaces schema associations and asks the worker to revalidate the existing model.
      await yamlService.update({ schemas });
      if (!isCurrentRequest(request) || destroyed) return;

      if (!validBundle) {
        activeSchemaGeneration = request.generation;
        activeSchemaVersion = null;
        crdDiagnostics = [];
        dispatch('audit', {
          version: request.version,
          status: request.loadError ? 'error' : 'loading',
          diagnostics: [],
          ...(request.loadError ? { message: request.loadError } : {}),
        });
        return;
      }

      activeSchemaGeneration = request.generation;
      activeSchemaVersion = request.version;
      publishCurrentWorkerDiagnostics();
    } catch (error) {
      if (!isCurrentRequest(request) || destroyed) return;
      activeSchemaGeneration = request.generation;
      activeSchemaVersion = null;
      crdDiagnostics = [];
      dispatch('audit', {
        version: request.version,
        status: 'error',
        diagnostics: [],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function isCurrentRequest(request: SchemaRequest): boolean {
    return request.generation === schemaUpdateGeneration
      && request.version === gatewayApiVersion
      && request.bundle === gatewayApiBundle
      && request.loadError === gatewayApiLoadError;
  }

  function publishCurrentWorkerDiagnostics() {
    if (!monaco || !editor || activeSchemaVersion === null || activeSchemaGeneration !== schemaUpdateGeneration) return;
    if (activeSchemaVersion !== gatewayApiVersion || !gatewayApiBundle || gatewayApiBundle.id !== activeSchemaVersion) return;
    const model = editor.getModel();
    if (!model) return;
    crdDiagnostics = model.getValue().trim()
      ? monaco.editor
          .getModelMarkers({ resource: model.uri, owner: 'yaml' })
          .filter(marker => marker.severity === monaco!.MarkerSeverity.Error || marker.severity === monaco!.MarkerSeverity.Warning)
          .map(marker => ({
            line: marker.startLineNumber,
            column: marker.startColumn,
            endLine: marker.endLineNumber,
            endColumn: marker.endColumn,
            message: marker.message,
            severity: marker.severity === monaco!.MarkerSeverity.Error ? 'error' : 'warning',
          }))
      : [];
    dispatch('audit', {
      version: activeSchemaVersion,
      status: 'ready',
      diagnostics: crdDiagnostics,
    });
  }

  function detectLanguageForBadge() {
    if (!editor) return;
    currentLanguage = /^[{[]/.test(editor.getValue().trim()) ? 'JSON' : 'YAML';
  }

  function validateContent() {
    if (!editor || !monaco) return;
    const content = editor.getValue();
    validationErrors = [];
    parsedObjects = EMPTY_PARSED_OBJECTS();

    if (!content.trim()) {
      updateParserMarkers();
      dispatch('parse', parsedObjects);
      return;
    }

    try {
      const documents = splitYamlDocumentsWithLocations(content);
      const allObjects: unknown[] = [];
      for (const document of documents) {
        try {
          const parsed = yaml.load(document.content);
          if (parsed && typeof parsed === 'object') allObjects.push(parsed);
        } catch (parseError) {
          const mark = (parseError as { mark?: { line?: number; column?: number } })?.mark;
          validationErrors.push({
            line: document.startLine + (typeof mark?.line === 'number' ? mark.line : 0),
            column: typeof mark?.column === 'number' ? mark.column + 1 : 1,
            message: `YAML Parse Error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          });
        }
      }

      const objects = allObjects as Record<string, unknown>[];
      const secretResult = containsPotentialSecrets(content, objects);
      if (secretResult) {
        if (!secretDetected) {
          secretDetected = secretResult;
          editor.setValue('');
          if (debounceHandle) clearTimeout(debounceHandle);
          debounceHandle = null;
          validationErrors = [];
          parsedObjects = EMPTY_PARSED_OBJECTS();
          updateParserMarkers();
          dispatch('parse', parsedObjects);
        } else {
          secretDetected = secretResult;
        }
        return;
      }
      if (secretDetected) secretDetected = null;

      for (const object of objects) {
        try {
          validateKubernetesObject(object);
          categorizeObject(object);
        } catch (validationError) {
          validationErrors.push({
            line: 1,
            column: 1,
            message: `Validation Error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          });
        }
      }

      updateParserMarkers();
      if (validationErrors.length === 0) dispatch('parse', parsedObjects);
      else dispatch('error', validationErrors);
    } catch (error) {
      validationErrors.push({
        line: 1,
        column: 1,
        message: `Error processing YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
      updateParserMarkers();
      dispatch('error', validationErrors);
    }
  }

  function validateKubernetesObject(object: Record<string, unknown>) {
    if (!object.apiVersion) throw new Error('Missing required field: apiVersion');
    if (!object.kind) throw new Error('Missing required field: kind');
    const metadata = object.metadata as Record<string, unknown> | undefined;
    if (!metadata?.name) throw new Error('Missing required field: metadata.name');
    if (isGatewayApiObject(object) && ['Gateway', 'HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'].includes(String(object.kind)) && !object.spec) {
      throw new Error(`${String(object.kind)} missing required field: spec`);
    }
  }

  function categorizeObject(object: Record<string, unknown>) {
    if (isGatewayApiObject(object)) {
      switch (object.kind) {
        case 'Gateway': parsedObjects.gateways.push(object as Gateway); break;
        case 'HTTPRoute':
        case 'TLSRoute':
        case 'TCPRoute':
        case 'GRPCRoute': parsedObjects.routes.push(object as AnyRoute); break;
        case 'GatewayClass': parsedObjects.gatewayClasses.push(object as GatewayClass); break;
        case 'ReferenceGrant': parsedObjects.referenceGrants.push(object as ReferenceGrant); break;
      }
      return;
    }
    switch (object.kind) {
      case 'Service': parsedObjects.services.push(object as Service); break;
      case 'Deployment': parsedObjects.deployments.push(object as Deployment); break;
      case 'StatefulSet': parsedObjects.statefulSets.push(object as StatefulSet); break;
      case 'DaemonSet': parsedObjects.daemonSets.push(object as DaemonSet); break;
    }
  }

  function isGatewayApiObject(object: Record<string, unknown>) {
    const apiVersion = typeof object.apiVersion === 'string' ? object.apiVersion : '';
    return GATEWAY_API_GROUPS.has(apiVersion.split('/')[0]);
  }

  function updateParserMarkers() {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'yaml-validation',
      validationErrors.map(error => ({
        severity: monaco!.MarkerSeverity.Error,
        startLineNumber: error.line,
        startColumn: error.column,
        endLineNumber: error.line,
        endColumn: Number.MAX_SAFE_INTEGER,
        message: error.message,
      })),
    );
  }

  $: sampleInsertionReady = Boolean(
    gatewayApiBundle
    && gatewayApiBundle.id === gatewayApiVersion
    && activeSchemaVersion === gatewayApiVersion
    && activeSchemaGeneration === schemaUpdateGeneration,
  );

  function loadSample(name: 'basic' | 'multi') {
    if (!editor || !sampleInsertionReady || !gatewayApiBundle) return;
    const source = name === 'basic' ? basicSample : multiSample;
    const transformed = splitYamlDocumentsWithLocations(source)
      .map(document => {
        const parsed = yaml.load(document.content);
        if (!parsed || typeof parsed !== 'object') return document.content;
        const object = parsed as Record<string, unknown>;
        if (isGatewayApiObject(object) && typeof object.kind === 'string') {
          const group = String(object.apiVersion).split('/')[0];
          const crd = gatewayApiBundle!.crds.find(candidate => candidate.group === group && candidate.kind === object.kind);
          if (crd) object.apiVersion = `${crd.group}/${crd.storageVersion}`;
        }
        return yaml.dump(object, { lineWidth: -1, noRefs: true }).trimEnd();
      })
      .join('\n---\n');
    secretDetected = null;
    editor.setValue(transformed);
    detectLanguageForBadge();
    validateContent();
  }

  export function getValue(): string {
    return editor?.getValue() || '';
  }

  export function setValue(value: string) {
    editor?.setValue(value);
  }

  function gotoLine(line: number) {
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }
</script>

<style>
  .editor-toolbar,
  .editor-status,
  .editor-actions {
    min-width: 0;
  }

  .editor-toolbar { flex-wrap: wrap; flex-shrink: 0; }
  .editor-surface { flex: 1 0 240px; min-height: 240px; width: 100%; }
  .editor-help { margin: 0; padding: 4px 16px; color: var(--color-secondary); font-size: 0.75rem; border-bottom: 1px solid var(--color-base-300); }
  .editor-notice { flex-shrink: 0; border-bottom: 1px solid var(--color-base-300); background: color-mix(in srgb, var(--color-warning) 8%, var(--color-base-50)); }
  .editor-error { background: color-mix(in srgb, var(--color-error) 8%, var(--color-base-50)); }
  .diagnostic-toggle:hover, .diagnostic-item:hover { background: var(--color-base-200); }
  .diagnostic-toggle:focus-visible, .diagnostic-item:focus-visible { outline-offset: -3px; }
  .diagnostic-list li + li { border-top: 1px solid var(--color-base-300); }

  @media (max-width: 600px) {
    .editor-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .editor-status {
      justify-content: space-between;
    }

    .editor-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      width: 100%;
    }

    .editor-actions select,
    .editor-actions button {
      min-height: 44px;
    }
  }
</style>


<div class="flex-1 flex flex-col bg-base-50 min-h-0">
  {#if secretDetected}
    <div role="alert" class="editor-notice px-4 py-3 flex flex-col gap-2">
      <div class="font-semibold flex items-center gap-2">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.602c.75 1.336-.213 2.999-1.742 2.999H3.48c-1.53 0-2.493-1.663-1.743-2.999L8.257 3.1zM11 14a1 1 0 10-2 0 1 1 0 002 0zm-1-2a.75.75 0 01-.75-.75v-3.5a.75.75 0 011.5 0v3.5A.75.75 0 0110 12z"/></svg>
        Potential credentials detected; input cleared.
      </div>
      <div class="text-sm leading-snug">
        Remove any secrets (passwords, tokens, private keys, Kubernetes Secrets) and paste sanitized YAML/JSON again. This banner will disappear automatically when the content no longer matches secret heuristics.
        <ul class="list-disc ml-6 mt-1 space-y-0.5">
          {#each secretDetected.reasons as reason}
            <li class="font-mono text-xs break-all">{reason}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  <div class="editor-toolbar flex items-center justify-between gap-2 px-4 py-3 bg-base-200 border-b border-base-300">
    <div class="editor-status flex items-center gap-3" role="status" aria-live="polite" aria-atomic="true">
      <span class="badge badge-sm badge-outline" title="Detected input format">{currentLanguage}</span>
      <div class="text-sm font-medium text-base-content">
        {#if validationErrors.length > 0}
          <span class="text-error">{validationErrors.length} parser error{validationErrors.length !== 1 ? 's' : ''}</span>
        {:else if parsedObjects.gateways.length + parsedObjects.routes.length > 0}
          <span class="text-success">{parsedObjects.gateways.length} gateway{parsedObjects.gateways.length !== 1 ? 's' : ''}, {parsedObjects.routes.length} route{parsedObjects.routes.length !== 1 ? 's' : ''}</span>
        {:else}
          <span class="text-secondary">No YAML content</span>
        {/if}
      </div>
    </div>

    <div class="editor-actions flex items-center gap-2">
      <select class="select select-sm select-bordered" bind:value={selectedSample} title="Choose sample dataset" aria-label="Choose sample dataset">
        <option value="basic">Basic sample</option>
        <option value="multi">Multi-gateway (20 routes)</option>
      </select>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        on:click={() => loadSample(selectedSample)}
        title="Load selected sample YAML"
        disabled={!sampleInsertionReady}
      >
        Insert Sample
      </button>
    </div>
  </div>
  <p class="editor-help">Tab moves focus. Use F1 for editor commands.</p>

  {#if validationErrors.length > 0}
    <div class="editor-notice editor-error">
      <button type="button" class="diagnostic-toggle w-full flex items-center justify-between px-4 py-2 text-error font-medium text-left" on:click={() => errorsExpanded = !errorsExpanded} aria-expanded={errorsExpanded} aria-controls="yaml-error-panel">
        <span>{validationErrors.length} YAML parser error{validationErrors.length !== 1 ? 's' : ''}</span>
        <span aria-hidden="true">{errorsExpanded ? '−' : '+'}</span>
      </button>
        <ul id="yaml-error-panel" hidden={!errorsExpanded} class="diagnostic-list max-h-48 overflow-auto text-sm">
          {#each validationErrors as error}
            <li><button type="button" class="diagnostic-item w-full px-4 py-2 text-left cursor-pointer" on:click={() => gotoLine(error.line)}><span class="font-mono text-xs mr-2">Ln {error.line}</span>{error.message}</button></li>
          {/each}
        </ul>
    </div>
  {/if}

  {#if crdDiagnostics.length > 0}
    <div class="editor-notice">
      <button type="button" class="diagnostic-toggle w-full flex items-center justify-between px-4 py-2 text-left font-medium" on:click={() => crdDiagnosticsExpanded = !crdDiagnosticsExpanded} aria-expanded={crdDiagnosticsExpanded} aria-controls="crd-diagnostics-panel">
        <span>CRD diagnostics: {crdDiagnostics.length} schema issue{crdDiagnostics.length !== 1 ? 's' : ''}</span>
        <span aria-hidden="true">{crdDiagnosticsExpanded ? '−' : '+'}</span>
      </button>
        <ul id="crd-diagnostics-panel" hidden={!crdDiagnosticsExpanded} class="diagnostic-list max-h-48 overflow-auto text-sm">
          {#each crdDiagnostics as diagnostic}
            <li><button type="button" class="diagnostic-item w-full px-4 py-2 text-left cursor-pointer" on:click={() => gotoLine(diagnostic.line)}><span class="font-mono text-xs mr-2">Ln {diagnostic.line}</span>{diagnostic.message}</button></li>
          {/each}
        </ul>
    </div>
  {/if}

  <div bind:this={container} class="editor-surface"></div>
</div>
