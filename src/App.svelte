<script lang="ts">
  import { onMount } from 'svelte';
  import type { CytoscapeOptions, ElementDefinition } from 'cytoscape';
  import Graph from './lib/Graph.svelte';
  import YamlEditor from './lib/YamlEditor.svelte';
  import ThemeToggle from './lib/ThemeToggle.svelte';
  import DetailsSidebar from './lib/components/DetailsSidebar.svelte';
  import GatewayApiSupport from './lib/GatewayApiSupport.svelte';
  import RouteCoverageTable from './lib/RouteCoverageTable.svelte';
  import { theme } from './lib/theme.js';
  import {
    defaultGatewayApiVersion,
    gatewayApiReleases,
    loadGatewayApiBundle,
    type GatewayApiAuditState,
    type GatewayApiBundle,
    type GatewayApiVersion,
  } from './lib/gatewayApi.js';
  import type {
    AnyRoute,
    CoverageGraph,
    DaemonSet,
    Deployment,
    Gateway,
    GatewayClass,
    GraphEdge,
    GraphNode,
    ReferenceGrant,
    RouteCoverageDetail,
    Service,
    StatefulSet,
  } from './lib/shared.js';
  import { buildFullGraph } from './lib/shared.js';

  type ParserIssue = { line: number; column: number; message: string };
  type KubernetesResource = Gateway | AnyRoute | Service | Deployment | StatefulSet | DaemonSet | GatewayClass | ReferenceGrant;
  type SelectedObject = (GraphNode | GraphEdge | RouteCoverageDetail) & { original?: KubernetesResource };

  let graph: CoverageGraph | null = null;
  let elements: ElementDefinition[] = [];
  let searchTerm = '';
  let pendingSearch = '';
  let filterKind = 'ALL';
  let filterCoverage = 'ALL';
  let selectedId: string | null = null;
  let selectedObject: SelectedObject | null = null;
  let layoutName = 'breadthfirst';
  let layoutConfig: CytoscapeOptions['layout'] = { name: layoutName, animate: true, animationDuration: 400 };
  let sidebarOpen = false;
  let yamlErrors: ParserIssue[] = [];
  let yamlEditor: YamlEditor;
  let selectionOpener: HTMLElement | null = null;

  let gatewayApiVersion: GatewayApiVersion = defaultGatewayApiVersion;
  let gatewayApiBundle: GatewayApiBundle | null = null;
  let gatewayApiLoadError: string | null = null;
  let releaseRequest = 0;
  let auditState: GatewayApiAuditState = {
    version: defaultGatewayApiVersion,
    status: 'loading',
    diagnostics: [],
  };

  let rawGateways: Gateway[] = [];
  let rawRoutes: AnyRoute[] = [];
  let rawServices: Service[] = [];
  let rawDeployments: Deployment[] = [];
  let rawStatefulSets: StatefulSet[] = [];
  let rawDaemonSets: DaemonSet[] = [];
  let rawGatewayClasses: GatewayClass[] = [];
  let rawReferenceGrants: ReferenceGrant[] = [];

  onMount(() => {
    document.documentElement.setAttribute('data-theme', $theme);
    void selectGatewayApiVersion(gatewayApiVersion);
  });

  async function selectGatewayApiVersion(version: GatewayApiVersion) {
    gatewayApiVersion = version;
    const request = ++releaseRequest;
    gatewayApiBundle = null;
    gatewayApiLoadError = null;
    auditState = { version, status: 'loading', diagnostics: [] };

    try {
      const bundle = await loadGatewayApiBundle(version);
      if (request !== releaseRequest || gatewayApiVersion !== version) return;
      gatewayApiBundle = bundle;
    } catch (error) {
      if (request !== releaseRequest || gatewayApiVersion !== version) return;
      const message = error instanceof Error ? error.message : String(error);
      gatewayApiLoadError = message;
      auditState = { version, status: 'error', diagnostics: [], message };
    }
  }

  function onVersionChange(event: Event) {
    void selectGatewayApiVersion((event.currentTarget as HTMLSelectElement).value as GatewayApiVersion);
  }

  function onAudit(event: CustomEvent<GatewayApiAuditState>) {
    if (event.detail.version !== gatewayApiVersion) return;
    auditState = event.detail;
  }

  function createStatusCopy(state: GatewayApiAuditState, version: GatewayApiVersion, bundle: GatewayApiBundle | null) {
    if (state.status === 'loading') return `Loading CRDs for Gateway API ${version}…`;
    if (state.status === 'error') return `Could not load CRDs for Gateway API ${version}.`;
    if (state.diagnostics.length > 0) {
      return `${state.diagnostics.length} schema issue${state.diagnostics.length === 1 ? '' : 's'}`;
    }
    return `CRD schema loaded · ${bundle?.tag ?? version}`;
  }
  $: statusText = createStatusCopy(auditState, gatewayApiVersion, gatewayApiBundle);

  function applyFilters(value: CoverageGraph) {
    const allowedRouteIds = new Set(
      value.routeCoverage
        .filter((route: RouteCoverageDetail) => {
          if (filterKind !== 'ALL' && route.kind !== filterKind) return false;
          if (filterCoverage === 'COVERED' && !route.covered) return false;
          if (filterCoverage === 'UNCOVERED' && route.covered) return false;
          if (searchTerm) {
            const search = searchTerm.toLowerCase();
            if (!route.name.toLowerCase().includes(search) && !route.namespace.toLowerCase().includes(search)) return false;
          }
          return true;
        })
        .map((route) => route.id),
    );

    const nodes = value.nodes.filter((node: GraphNode) => {
      if (filterKind === 'ALL') {
        if (node.type === 'route' && !allowedRouteIds.has(node.id)) return false;
        if (!searchTerm) return true;
        return node.label.toLowerCase().includes(searchTerm.toLowerCase()) || node.type !== 'route';
      }
      if (['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'].includes(filterKind)) {
        return node.type === 'route' && allowedRouteIds.has(node.id);
      }
      return node.type === filterKind && (!searchTerm || node.label.toLowerCase().includes(searchTerm.toLowerCase()));
    });
    const nodeIds = new Set(nodes.map((node: GraphNode) => node.id));
    const edges = value.edges.filter((edge: GraphEdge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    return { nodes, edges };
  }

  function toElements(value: CoverageGraph) {
    const { nodes, edges } = applyFilters(value);
    const mappedNodes = nodes.map((node: GraphNode) => {
      const fontSize = node.type === 'gateway' ? 12 : 10;
      const minWidths: Record<string, number> = { gateway: 60, listener: 55, route: 50, gatewayclass: 60, service: 55, workload: 55, referencegrant: 70 };
      const baseHeights: Record<string, number> = { gateway: 40, listener: 34, route: 28, gatewayclass: 34, service: 32, workload: 32, referencegrant: 34 };
      const label = String(node.label ?? '');
      const width = Math.min(Math.max(label.length * fontSize * 0.6 + 16, minWidths[node.type] || 50), 240);
      return { data: { id: node.id, label, type: node.type, width, height: baseHeights[node.type] || 30 } };
    });
    const mappedEdges = edges.map((edge: GraphEdge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, type: edge.type } }));
    return [...mappedNodes, ...mappedEdges];
  }

  function onYamlParse(event: CustomEvent<{
    gateways: Gateway[];
    routes: AnyRoute[];
    services: Service[];
    deployments: Deployment[];
    statefulSets: StatefulSet[];
    daemonSets: DaemonSet[];
    gatewayClasses: GatewayClass[];
    referenceGrants: ReferenceGrant[];
  }>) {
    const { gateways, routes, services, deployments, statefulSets, daemonSets, gatewayClasses, referenceGrants } = event.detail;
    rawGateways = gateways;
    rawRoutes = routes;
    rawServices = services;
    rawDeployments = deployments;
    rawStatefulSets = statefulSets;
    rawDaemonSets = daemonSets;
    rawGatewayClasses = gatewayClasses;
    rawReferenceGrants = referenceGrants;
    yamlErrors = [];

    try {
      graph = buildFullGraph({ gateways, routes, services, deployments, statefulSets, daemonSets, gatewayClasses, referenceGrants });
      elements = toElements(graph);
      if (selectedId && !graph.nodes.some((node) => node.id === selectedId) && !graph.routeCoverage.some((route) => route.id === selectedId)) {
        selectedId = null;
        selectedObject = null;
        sidebarOpen = false;
      } else if (selectedId) {
        selectedObject = findObject(selectedId, graph);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yamlErrors = [{ line: 1, column: 1, message: `Graph generation error: ${message}` }];
      graph = null;
      elements = [];
    }
  }

  function onYamlError(event: CustomEvent<ParserIssue[]>) {
    yamlErrors = event.detail;
    graph = null;
    elements = [];
  }

  function findObject(id: string, value: CoverageGraph): SelectedObject | null {
    const originalFor = (targetId: string): KubernetesResource | null => {
      if (targetId.startsWith('route:')) {
        const [namespace, name] = targetId.slice('route:'.length).split('/');
        return rawRoutes.find((route) => (route.metadata.namespace || 'default') === namespace && route.metadata.name === name) || null;
      }
      if (targetId.startsWith('gateway:')) {
        const [namespace, name] = targetId.split(':listener:')[0].slice('gateway:'.length).split('/');
        return rawGateways.find((gateway) => (gateway.metadata.namespace || 'default') === namespace && gateway.metadata.name === name) || null;
      }
      if (targetId.startsWith('service:')) {
        const [namespace, name] = targetId.slice('service:'.length).split('/');
        return rawServices.find((service) => (service.metadata.namespace || 'default') === namespace && service.metadata.name === name) || null;
      }
      if (targetId.startsWith('gatewayclass:')) {
        const name = targetId.slice('gatewayclass:'.length);
        return rawGatewayClasses.find((gatewayClass) => gatewayClass.metadata.name === name) || null;
      }
      if (targetId.startsWith('workload:')) {
        const rest = targetId.slice('workload:'.length);
        const separator = rest.indexOf(':');
        const [namespace, kind] = rest.slice(0, separator).split('/');
        const name = rest.slice(separator + 1);
        if (kind === 'deployment') return rawDeployments.find((item) => (item.metadata.namespace || 'default') === namespace && item.metadata.name === name) || null;
        if (kind === 'statefulset') return rawStatefulSets.find((item) => (item.metadata.namespace || 'default') === namespace && item.metadata.name === name) || null;
        if (kind === 'daemonset') return rawDaemonSets.find((item) => (item.metadata.namespace || 'default') === namespace && item.metadata.name === name) || null;
      }
      return null;
    };

    const coverage = value.routeCoverage.find((route) => route.id === id);
    const graphObject = coverage || value.nodes.find((node) => node.id === id) || value.edges.find((edge) => edge.id === id) || null;
    const original = originalFor(id);
    return graphObject && original ? ({ ...graphObject, original } as SelectedObject) : graphObject;
  }

  function selectResource(id: string | null, opener?: HTMLElement | null) {
    selectedId = id || null;
    selectionOpener = opener || null;
    if (!selectedId || !graph) {
      selectedObject = null;
      sidebarOpen = false;
      return;
    }
    selectedObject = findObject(selectedId, graph);
    sidebarOpen = !!selectedObject;
    if (opener) requestAnimationFrame(() => document.getElementById('resource-details-heading')?.focus());
  }

  function onGraphSelect(event: CustomEvent) {
    const id = event.detail?.id || event.detail?.target?.id?.();
    if (id) selectResource(id);
  }

  function closeSidebar() {
    sidebarOpen = false;
    requestAnimationFrame(() => selectionOpener?.focus());
  }

  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput(event: Event) {
    pendingSearch = (event.target as HTMLInputElement).value;
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      searchTerm = pendingSearch;
      refreshFilters();
    }, 250);
  }

  function refreshFilters() {
    if (graph) elements = toElements(graph);
  }

  function resetFilters() {
    searchTerm = '';
    pendingSearch = '';
    filterKind = 'ALL';
    filterCoverage = 'ALL';
    refreshFilters();
  }

  function updateLayout() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    layoutConfig = { name: layoutName, animate: !reduceMotion, animationDuration: reduceMotion ? 0 : 180 };
  }

  $: visibleNodes = graph ? applyFilters(graph).nodes : [];
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>

<div class="app-shell min-h-screen">
  <header class="app-header">
    <div class="brand-lockup">
      <h1>Gateway API Visualizer</h1>
      <span class="build-badge" title={`Application version ${__APP_VERSION__}, commit ${__GIT_HASH__}`}>{__APP_VERSION__} · {__GIT_HASH__}</span>
    </div>
    <ThemeToggle />
  </header>

  <main id="main-content" class="workbench" tabindex="-1">
    <section class="audit-panel" aria-labelledby="audit-target-title">
      <div class="audit-toolbar">
        <div class="audit-heading">
          <span class="eyebrow">Audit target</span>
          <h2 id="audit-target-title">Gateway API compatibility</h2>
        </div>
        <div class="form-control version-control">
          <label for="gateway-api-version">Gateway API version</label>
          <select id="gateway-api-version" class="select select-bordered" value={gatewayApiVersion} on:change={onVersionChange}>
            {#each gatewayApiReleases as release}
              <option value={release.id}>{release.id} ({release.tag})</option>
            {/each}
          </select>
        </div>
        <span class="channel-badge">Standard + experimental</span>
        <div
          class:status-error={auditState.status === 'error'}
          class:status-warning={auditState.status === 'ready' && auditState.diagnostics.length > 0}
          class="audit-status"
          data-testid="gateway-api-status"
          data-version={gatewayApiVersion}
          data-state={auditState.status}
          aria-live="polite"
          aria-atomic="true"
        >
          <span class:loading-dot={auditState.status === 'loading'}></span>
          <span>{statusText}</span>
          {#if auditState.status === 'error'}
            <button class="btn btn-sm btn-outline" type="button" on:click={() => selectGatewayApiVersion(gatewayApiVersion)}>Retry</button>
          {/if}
        </div>
      </div>
      {#if gatewayApiBundle && auditState.status === 'ready' && auditState.version === gatewayApiVersion}
        <GatewayApiSupport bundle={gatewayApiBundle} />
      {:else if auditState.status === 'loading'}
        <div class="support-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
      {/if}
    </section>

    {#if graph}
      <section class="resource-summary" aria-label="Resource summary">
        <dl>
          <div><dt>Gateways</dt><dd>{graph.summary.gateways}</dd></div>
          <div><dt>Routes</dt><dd>{graph.summary.routes}</dd></div>
          <div><dt>With parent refs</dt><dd>{graph.summary.coveredRoutes}</dd></div>
          <div><dt>Parent-ref coverage</dt><dd>{graph.summary.coveragePercent.toFixed(1)}%</dd></div>
        </dl>
        <p>A parent reference shows intent, not proof that a controller accepted the attachment.</p>
      </section>
    {/if}

    <div class:with-details={sidebarOpen} class="workspace-grid">
      <section class="work-region manifest-region" aria-labelledby="manifest-title">
        <header class="region-header"><h2 id="manifest-title">Manifest</h2></header>
        <div class="region-content">
          <YamlEditor
            bind:this={yamlEditor}
            {gatewayApiVersion}
            {gatewayApiBundle}
            {gatewayApiLoadError}
            on:parse={onYamlParse}
            on:error={onYamlError}
            on:audit={onAudit}
          />
        </div>
      </section>

      <section class="work-region topology-region" aria-labelledby="relationships-title">
        <header class="region-header topology-header">
          <div><h2 id="relationships-title">Relationships</h2><span class="region-note">Local relationship preview</span></div>
          <div class="topology-controls" role="group" aria-label="Relationship graph controls">
            <label>Search <input class="input input-bordered" type="search" placeholder="Name or namespace" bind:value={pendingSearch} on:input={onSearchInput} /></label>
            <label>Kind
              <select class="select select-bordered" bind:value={filterKind} on:change={refreshFilters}>
                <option value="ALL">All kinds</option><option value="HTTPRoute">HTTPRoute</option><option value="TLSRoute">TLSRoute</option><option value="TCPRoute">TCPRoute</option><option value="GRPCRoute">GRPCRoute</option>
              </select>
            </label>
            <label>Parent refs
              <select class="select select-bordered" bind:value={filterCoverage} on:change={refreshFilters}>
                <option value="ALL">All routes</option><option value="COVERED">Has parent ref</option><option value="UNCOVERED">No parent ref</option>
              </select>
            </label>
            <label>Layout
              <select class="select select-bordered" bind:value={layoutName} on:change={updateLayout}>
                <option value="breadthfirst">Breadthfirst</option><option value="grid">Grid</option><option value="circle">Circle</option><option value="concentric">Concentric</option><option value="cose">CoSE</option>
              </select>
            </label>
            <div class="control-group inspect-control">
              <label for="inspect-resource">Inspect resource</label>
              <select id="inspect-resource" class="select select-bordered" value={selectedId || ''} on:change={(event) => selectResource((event.currentTarget as HTMLSelectElement).value, event.currentTarget as HTMLElement)}>
                <option value="">Choose a resource</option>
                {#each visibleNodes as node}<option value={node.id}>{node.type}: {node.label}</option>{/each}
              </select>
            </div>
            <button type="button" class="btn btn-outline" on:click={resetFilters}>Reset graph filters</button>
          </div>
        </header>
        <div class="region-content topology-canvas">
          {#if graph && elements.length > 0}
            <Graph {elements} layout={layoutConfig} on:select={onGraphSelect} externalSelect={selectedId} />
          {:else}
            <div class="empty-state">
              <h3>{yamlErrors.length ? 'Manifest parsing paused' : 'No relationships yet'}</h3>
              <p>{yamlErrors.length ? 'Correct the YAML syntax to rebuild the relationship preview.' : 'Paste a manifest or insert a sample to map Gateway API resources.'}</p>
            </div>
          {/if}
        </div>
      </section>

      {#if sidebarOpen}
        <div class="details-region">
          <DetailsSidebar open={sidebarOpen} selected={selectedObject} on:close={closeSidebar} />
        </div>
      {/if}
    </div>

    {#if graph}
      <RouteCoverageTable rows={graph.routeCoverage} on:routeSelect={(event) => selectResource(event.detail.id, event.detail.opener)} />
    {/if}
  </main>
</div>

<style>
  .skip-link { position: absolute; z-index: 10; top: 8px; left: 8px; padding: 8px 12px; border: 1px solid var(--color-primary); border-radius: 6px; background: var(--color-base-50); color: var(--color-base-content); transform: translateY(-150%); transition: transform 160ms ease-out; }
  .skip-link:focus-visible { transform: translateY(0); outline: 2px solid var(--color-primary); outline-offset: 2px; }
  .app-shell { color: var(--color-base-content); background: var(--color-base-100); }
  .app-header { min-height: 58px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-base-300); background: var(--color-base-50); }
  .brand-lockup { min-width: 0; display: flex; align-items: baseline; gap: 12px; }
  .brand-lockup h1 { margin: 0; font-size: 1.125rem; font-weight: 600; letter-spacing: -0.01em; }
  .build-badge { color: var(--color-secondary); font: 0.75rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .workbench { width: min(100%, 1800px); margin: 0 auto; padding: 20px 24px 32px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .audit-panel, .resource-summary, .work-region, .details-region { border: 1px solid var(--color-base-300); border-radius: 6px; background: var(--color-base-50); }
  .audit-toolbar { min-height: 72px; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
  .audit-heading { min-width: 210px; margin-right: auto; }
  .eyebrow, .region-note { color: var(--color-secondary); font-size: 0.75rem; }
  .audit-heading h2, .region-header h2 { margin: 2px 0 0; font-size: 1rem; font-weight: 600; }
  .version-control { display: grid; grid-template-columns: auto auto; align-items: center; gap: 8px; }
  .version-control label, .topology-controls label { font-size: 0.75rem; color: var(--color-secondary); }
  .channel-badge { padding: 5px 8px; border: 1px solid var(--color-base-300); border-radius: 999px; color: var(--color-secondary); font-size: 0.75rem; }
  .audit-status { min-height: 36px; display: flex; align-items: center; gap: 8px; color: var(--color-success); font-size: 0.8125rem; }
  .status-warning { color: var(--color-warning); }
  .status-error { color: var(--color-error); }
  .loading-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); opacity: .5; animation: pulse 1s ease-in-out infinite alternate; }
  .support-skeleton { padding: 0 16px 14px; display: flex; gap: 8px; }
  .support-skeleton span { height: 8px; border-radius: 4px; background: var(--color-base-200); }
  .support-skeleton span:nth-child(1) { width: 18%; } .support-skeleton span:nth-child(2) { width: 30%; } .support-skeleton span:nth-child(3) { width: 12%; }
  .resource-summary { padding: 12px 16px; }
  .resource-summary dl { margin: 0; display: flex; flex-wrap: wrap; gap: 12px 32px; }
  .resource-summary dl div { display: flex; align-items: baseline; gap: 8px; }
  .resource-summary dt { color: var(--color-secondary); font-size: 0.75rem; }
  .resource-summary dd { margin: 0; font-size: 1rem; font-weight: 600; }
  .resource-summary p { margin: 6px 0 0; color: var(--color-secondary); font-size: 0.75rem; }
  .workspace-grid { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.15fr); gap: 16px; align-items: stretch; }
  .workspace-grid.with-details { grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.15fr); }
  .work-region { min-width: 0; height: clamp(420px, 58vh, 760px); display: flex; flex-direction: column; overflow: hidden; }
  .region-header { flex-shrink: 0; min-height: 50px; padding: 10px 14px; border-bottom: 1px solid var(--color-base-300); display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--color-base-100); }
  .topology-header { min-height: auto; align-items: flex-start; flex-wrap: wrap; }
  .topology-controls { display: flex; flex-wrap: wrap; align-items: end; justify-content: flex-end; gap: 8px; }
  .topology-controls label, .topology-controls .control-group { display: grid; gap: 3px; }
  .topology-controls .input, .topology-controls .select, .topology-controls .btn { min-height: 36px; height: 36px; font-size: 0.75rem; }
  .topology-controls .input { width: 150px; }
  .region-content { flex: 1; min-height: 0; min-width: 0; }
  .manifest-region { height: auto; min-height: clamp(420px, 58vh, 760px); }
  .manifest-region .region-content { display: flex; flex-direction: column; }
  .topology-region { height: auto; }
  .topology-canvas { position: relative; flex: 1 0 320px; min-height: 320px; }
  .details-region { min-width: 0; overflow: hidden; }
  .empty-state { height: 100%; display: grid; place-content: center; padding: 24px; text-align: center; color: var(--color-secondary); }
  .empty-state h3 { margin: 0 0 6px; color: var(--color-base-content); font-size: 1rem; }
  .empty-state p { max-width: 42ch; margin: 0; }
  @media (min-width: 1440px) { .workspace-grid.with-details { grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.15fr) 300px; } }
  @media (min-width: 1100px) and (max-width: 1439px) { .details-region { grid-column: 2; min-height: 280px; } }
  @media (max-width: 1099px) { .workbench { padding: 16px; } .workspace-grid, .workspace-grid.with-details { grid-template-columns: minmax(0, 1fr); } .manifest-region { min-height: 420px; } .details-region { min-height: 280px; } .topology-controls { justify-content: flex-start; } }
  @media (max-width: 600px) { .app-header { padding: 0 16px; } .brand-lockup { display: grid; gap: 2px; } .audit-toolbar { align-items: flex-start; } .audit-heading { width: 100%; } .version-control { grid-template-columns: 1fr; } .audit-status { width: 100%; } .topology-controls { display: grid; grid-template-columns: 1fr 1fr; width: 100%; } .topology-controls label:first-child, .topology-controls .inspect-control, .topology-controls .btn { grid-column: 1 / -1; } .topology-controls .input, .topology-controls .select, .topology-controls .btn { width: 100%; min-height: 44px; height: 44px; } }
  @keyframes pulse { to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .loading-dot { animation: none; opacity: 1; } }
</style>
