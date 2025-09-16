<script lang="ts">
  import Graph from './lib/Graph.svelte';
  import YamlEditor from './lib/YamlEditor.svelte';
  import ThemeToggle from './lib/ThemeToggle.svelte';
  import { theme } from './lib/theme.js';
  import type { CoverageGraph, Gateway, AnyRoute, Service, Deployment, StatefulSet, DaemonSet, GatewayClass, ReferenceGrant, GraphNode, GraphEdge, RouteCoverageDetail } from './lib/shared.js';
  import { buildCoverageGraph, buildFullGraph } from './lib/shared.js';
  import { onMount } from 'svelte';
  import DetailsSidebar from './lib/components/DetailsSidebar.svelte';
  import RouteCoverageTable from './lib/RouteCoverageTable.svelte';

  // Single-mode UI (editor + visualization). API mode removed.
  let graph: CoverageGraph | null = null;
  let elements: any[] = [];
  let searchTerm = '';
  let pendingSearch = '';
  let filterKind: string = 'ALL';
  let filterCoverage: string = 'ALL';
  let selectedId: string | null = null;
  let selectedObject: any = null;
  let layoutName: string = 'breadthfirst';
  let layoutConfig: any = { name: layoutName, animate: true, animationDuration: 400 };
  let sidebarOpen = false;
  let yamlEditor: YamlEditor;
  let yamlErrors: Array<{ line: number; column: number; message: string }> = [];
  let tableSelectedRouteId: string | null = null; // for syncing selection from table to graph

  // Initialize theme
  onMount(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-theme', $theme);
    }
    
    // No remote API mode initialization needed anymore
  });

  function applyFilters(g: CoverageGraph) {
    const allowedRouteIds = new Set(
      g.routeCoverage
        .filter((rc: RouteCoverageDetail) => {
          if (filterKind !== 'ALL' && rc.kind !== filterKind) return false;
          if (filterCoverage === 'COVERED' && !rc.covered) return false;
            if (filterCoverage === 'UNCOVERED' && rc.covered) return false;
          if (searchTerm) {
            const s = searchTerm.toLowerCase();
            if (!rc.name.toLowerCase().includes(s) && !rc.namespace.toLowerCase().includes(s)) return false;
          }
          return true;
        })
        .map((rc: RouteCoverageDetail) => rc.id)
    );

      const nodes = g.nodes.filter((n: GraphNode) => {
        if (filterKind === 'ALL') {
          if (!searchTerm) return true;
          return n.label.toLowerCase().includes(searchTerm.toLowerCase());
        }
        if (['HTTPRoute','TLSRoute','TCPRoute','GRPCRoute'].includes(filterKind)) {
          if (n.type === 'route') {
            // Only show routes of the selected kind
            const rc = g.routeCoverage.find(r => r.id === n.id);
            return rc?.kind === filterKind;
          }
          return false;
        }
        // For new node types
        if (n.type === filterKind) {
          if (!searchTerm) return true;
          return n.label.toLowerCase().includes(searchTerm.toLowerCase());
        }
        return false;
      });
    const nodeIds = new Set(nodes.map((n: GraphNode) => n.id));
    const edges = g.edges.filter((e: GraphEdge) => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges };
  }

  function toElements(g: CoverageGraph) {
    const { nodes, edges } = applyFilters(g);
    // Dynamic sizing heuristic so labels are not clipped. We approximate text width
    // by character count * an average char width (dependent on font size) plus padding.
    function sizeFor(node: typeof nodes[number]) {
      const label = node.label || '';
      const fontSize = node.type === 'gateway' ? 12 : 10; // simple rule
      const avgChar = fontSize * 0.6;
      const baseWidth = label.length * avgChar;
      const horizontalPadding = 16;
      const minWidths: Record<string, number> = { gateway: 60, listener: 55, route: 50, gatewayclass: 60, service: 55, workload: 55, referencegrant: 70 };
      const maxWidth = 240;
      const width = Math.min(Math.max(baseWidth + horizontalPadding, minWidths[node.type] || 50), maxWidth);
      const baseHeights: Record<string, number> = { gateway: 40, listener: 34, route: 28, gatewayclass: 34, service: 32, workload: 32, referencegrant: 34 };
      const height = baseHeights[node.type] || 30;
      return { width, height };
    }
    const n = nodes.map((n: GraphNode) => {
      const { width, height } = sizeFor(n);
      return { data: { id: n.id, label: n.label, type: n.type, width, height } };
    });
    const e = edges.map((e: GraphEdge) => ({ data: { id: e.id, source: e.source, target: e.target, type: e.type } }));
    return [...n, ...e];
  }

  // Removed: fetchGraph/connectSSE (API mode deprecated)

  function onYamlParse(event: CustomEvent<{ gateways: Gateway[]; routes: AnyRoute[]; services: Service[]; deployments: Deployment[]; statefulSets: StatefulSet[]; daemonSets: DaemonSet[]; gatewayClasses: GatewayClass[]; referenceGrants: ReferenceGrant[];}>) {
    const { gateways, routes, services, deployments, statefulSets, daemonSets, gatewayClasses, referenceGrants } = event.detail;
    yamlErrors = [];
    try {
      graph = buildFullGraph({ gateways, routes, services, deployments, statefulSets, daemonSets, gatewayClasses, referenceGrants });
      elements = toElements(graph);
    } catch (error: any) {
      console.error('Error building graph:', error);
      yamlErrors = [{ line: 1, column: 1, message: `Graph generation error: ${error.message}` }];
    }
  }

  function onYamlError() {
    // Clear graph if there are YAML errors
    graph = null;
    elements = [];
  }

  // Removed mode switching functions

  // Duplicate onMount cleaned above (kept single initialization earlier)

  let debounceHandle: any;
  function refreshFilters() {
    if (graph) elements = toElements(graph);
  }
  function onSearchInput(e: Event) {
    pendingSearch = (e.target as HTMLInputElement).value;
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      searchTerm = pendingSearch;
      refreshFilters();
    }, 250);
  }


  function onSelect(evt: CustomEvent) {
    const target = evt.detail?.target || evt.detail?.cyTarget;
    if (!target) return;
    selectedId = target.id();
    if (!graph) return;
    if (selectedId) selectedObject = findObject(selectedId, graph);
  }

  function findObject(id: string, g: CoverageGraph): any {
    // Try route coverage objects first
  const rc = g.routeCoverage.find((r: RouteCoverageDetail) => r.id === id);
    if (rc) return rc;
    // Then a node by id
  const node = g.nodes.find((n: GraphNode) => n.id === id);
    if (node) return node;
    // Finally an edge
  const edge = g.edges.find((e: GraphEdge) => e.id === id);
    if (edge) return edge;
    return null;
  }

  function updateLayout() {
    layoutConfig = { name: layoutName, animate: true, animationDuration: 400 };
  }

  function closeSidebar() { sidebarOpen = false; }
  $: if (selectedObject) sidebarOpen = true;
  const SIDEBAR_WIDTH = 320; // px

</script>

<div class="min-h-screen flex flex-col">
  <header class="navbar bg-base-200 shadow">
    <div class="navbar-start px-4">
      <h1 class="text-xl font-bold">Gateway API Visualizer</h1>
    </div>
    <div class="navbar-end pr-4">
      <ThemeToggle />
    </div>
  </header>
  <!-- Main Content -->
  <!-- Updated width: use 80% of viewport on medium+ screens, full width on small screens -->
  <main class="mx-auto p-4 flex-1 flex flex-col min-h-0 w-full md:w-[80vw]">
      <!-- YAML Editor + Graph Mode (single mode) -->
      {#if graph}
        <!-- Summary Stats -->
        <div class="stats shadow mb-6 bg-base-200">
          <div class="stat">
            <div class="stat-figure text-primary">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="stat-title">Gateways</div>
            <div class="stat-value text-primary">{graph.summary.gateways}</div>
          </div>
          
          <div class="stat">
            <div class="stat-figure text-secondary">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="stat-title">Routes</div>
            <div class="stat-value text-secondary">{graph.summary.routes}</div>
          </div>
          
          <div class="stat">
            <div class="stat-figure text-success">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="stat-title">Covered Routes</div>
            <div class="stat-value text-success">{graph.summary.coveredRoutes}</div>
          </div>
          
          <div class="stat">
            <div class="stat-figure text-error">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="stat-title">Coverage</div>
            <div class="stat-value text-accent">{graph.summary.coveragePercent.toFixed(1)}%</div>
          </div>
        </div>
      {/if}

      <!-- Filters (same as API mode) -->
      {#if graph}
      <div class="card bg-base-200 shadow-lg mb-6">
        <div class="card-body">
          <div class="flex flex-wrap gap-4 items-center">
            <div class="form-control flex-1 min-w-64">
              <input 
                type="text" 
                placeholder="Search (name/namespace)" 
                class="input input-bordered w-full" 
                bind:value={pendingSearch} 
                on:input={onSearchInput} 
              />
            </div>
            <div class="form-control">
              <select class="select select-bordered" bind:value={filterKind} on:change={refreshFilters}>
                <option value="ALL">All Kinds</option>
                <option value="HTTPRoute">HTTPRoute</option>
                <option value="TLSRoute">TLSRoute</option>
                <option value="TCPRoute">TCPRoute</option>
                <option value="GRPCRoute">GRPCRoute</option>
              </select>
            </div>
            <div class="form-control">
              <select class="select select-bordered" bind:value={filterCoverage} on:change={refreshFilters}>
                <option value="ALL">All Coverage</option>
                <option value="COVERED">Covered</option>
                <option value="UNCOVERED">Uncovered</option>
              </select>
            </div>
            <div class="form-control">
              <select class="select select-bordered" bind:value={layoutName} on:change={updateLayout}>
                <option value="breadthfirst">Breadthfirst</option>
                <option value="grid">Grid</option>
                <option value="circle">Circle</option>
                <option value="concentric">Concentric</option>
                <option value="cose">CoSE</option>
              </select>
            </div>
            <button class="btn btn-outline" on:click={() => { searchTerm=''; pendingSearch=''; filterKind='ALL'; filterCoverage='ALL'; refreshFilters(); }}>
              Reset
            </button>
          </div>
        </div>
      </div>
      {/if}
      
    <!-- Editor + Graph + Sidebar Layout (fill remaining height) -->
  <div class="flex flex-row flex-nowrap gap-6 flex-1 min-h-0 relative overflow-hidden">
        <!-- YAML Editor Panel -->
  <div class="card bg-base-200 shadow-lg flex flex-col flex-1 min-h-0 min-w-[320px] overflow-hidden">
          <div class="card-body p-0 flex flex-col flex-1 min-h-0">
            <div class="flex items-center justify-between p-4 border-b border-base-300">
              <h2 class="card-title text-lg">📝 YAML Editor</h2>
              <div class="flex items-center gap-2">
                {#if yamlErrors.length > 0}
                  <div class="badge badge-error gap-2">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                    </svg>
                    {yamlErrors.length} error{yamlErrors.length !== 1 ? 's' : ''}
                  </div>
                {:else if graph && (graph.summary.gateways > 0 || graph.summary.routes > 0)}
                  <div class="badge badge-success gap-2">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                    </svg>
                    {graph.summary.gateways} gateway{graph.summary.gateways !== 1 ? 's' : ''}, 
                    {graph.summary.routes} route{graph.summary.routes !== 1 ? 's' : ''}
                  </div>
                {:else}
                  <div class="badge badge-ghost">Ready</div>
                {/if}
              </div>
            </div>
            
            <div class="flex-1 min-h-0 min-w-0">
              <YamlEditor 
                bind:this={yamlEditor}
                on:parse={onYamlParse}
                on:error={onYamlError}
              />
            </div>
            
            {#if yamlErrors.length > 0}
              <div class="p-4 border-t border-base-300">
                <div class="alert alert-error">
                  <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                  </svg>
                  <div>
                    <h3 class="font-bold">Validation Errors:</h3>
                    <div class="text-sm mt-1">
                      {#each yamlErrors as error}
                        <div>Line {error.line}: {error.message}</div>
                      {/each}
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
        
    <!-- Graph Panel -->
  <div class="card bg-base-200 shadow-lg flex flex-col flex-1 min-h-0 min-w-[320px] overflow-hidden">
          <div class="card-body p-0 flex flex-col flex-1 min-h-0">
            <div class="flex items-center justify-between p-4 border-b border-base-300">
              <h2 class="card-title text-lg">📊 Graph Visualization</h2>
              {#if graph && elements.length > 0}
                <div class="form-control">
                  <select class="select select-sm select-bordered" bind:value={layoutName} on:change={updateLayout}>
                    <option value="breadthfirst">Breadthfirst</option>
                    <option value="grid">Grid</option>
                    <option value="circle">Circle</option>
                    <option value="concentric">Concentric</option>
                    <option value="cose">CoSE</option>
                  </select>
                </div>
              {/if}
            </div>
            
            <div class="flex-1 relative min-h-0 min-w-0 overflow-hidden">
              {#if !sidebarOpen && graph && elements.length > 0}
                <button class="lg:hidden btn btn-xs btn-outline absolute top-2 right-2 z-20" on:click={() => sidebarOpen = true}>Details</button>
              {/if}
              {#if graph && elements.length > 0}
                <Graph elements={elements} layout={layoutConfig} on:select={onSelect} externalSelect={tableSelectedRouteId} />
              {:else}
                <div class="flex items-center justify-center h-full">
                  <div class="text-center">
                    <div class="text-6xl mb-4 opacity-20">📊</div>
                    <p class="text-base-content/60">
                      {yamlErrors.length > 0 ? 'Fix YAML errors to see graph' : 'Enter YAML content to generate graph'}
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
        <!-- Sidebar (positioned in normal flow on large screens) -->
  <div class="hidden lg:flex h-full shrink-0 transition-all duration-300" style="width: {sidebarOpen ? SIDEBAR_WIDTH : 0}px;">
          {#if sidebarOpen}
            <DetailsSidebar bind:open={sidebarOpen} selected={selectedObject} on:close={closeSidebar} />
          {/if}
        </div>
        <!-- Mobile overlay version -->
  <div class="lg:hidden absolute top-0 right-0 h-full" style="width: {SIDEBAR_WIDTH}px; pointer-events: {sidebarOpen ? 'auto':'none'};">
          <DetailsSidebar bind:open={sidebarOpen} selected={selectedObject} on:close={closeSidebar} />
        </div>
        <!-- Toggle button for mobile when closed -->
      </div>

      {#if graph}
        <RouteCoverageTable rows={graph.routeCoverage} on:routeSelect={(e) => {
          tableSelectedRouteId = e.detail.id;
          // update selection context
          const id = e.detail.id;
          if (graph) {
            selectedId = id;
            selectedObject = findObject(id, graph);
          }
        }} />
      {/if}
      
    
  </main>
</div>

<!-- Modal removed; details shown in sidebar -->
