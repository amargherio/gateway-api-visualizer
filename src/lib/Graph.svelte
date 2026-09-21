<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import cytoscape from 'cytoscape';
  import type { Core, CytoscapeOptions, ElementDefinition, StylesheetJson } from 'cytoscape';

  export let elements: ElementDefinition[] = [];
  export let externalSelect: string | null = null;
  export let layout: CytoscapeOptions['layout'] = { name: 'breadthfirst', animate: true, animationDuration: 400 };
  export let style: CytoscapeOptions['style'] | undefined = undefined;

  let container: HTMLDivElement;
  let cy: Core | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let reducedMotionQuery: MediaQueryList | null = null;
  let resizeFrame: number | null = null;
  const dispatch = createEventDispatcher();

  function token(name: string) {
    return getComputedStyle(container).getPropertyValue(name).trim();
  }

  function defaultStyle(): StylesheetJson {
    const nodeFill = token('--graph-node-fill');
    const nodeText = token('--graph-node-text');
    const accent = token('--graph-accent');
    const edge = token('--graph-edge');
    const selected = token('--graph-selected');

    return [
      {
        selector: 'node',
        style: {
          'background-color': nodeFill,
          'border-color': edge,
          'border-width': '1px',
          'color': nodeText,
          'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          'font-size': '10px',
          'font-weight': 'normal',
          'height': '32px',
          'label': 'data(label)',
          'text-halign': 'center',
          'text-valign': 'center',
          'width': '70px'
        }
      },
      { selector: 'node[width][height]', style: { width: 'data(width)', height: 'data(height)' } },
      { selector: 'node[type="gateway"]', style: { 'border-color': accent, 'border-width': '3px', 'font-size': '12px', 'font-weight': 'bold', shape: 'round-rectangle' } },
      { selector: 'node[type="listener"]', style: { shape: 'ellipse' } },
      { selector: 'node[type="route"]', style: { shape: 'rectangle' } },
      { selector: 'node[type="gatewayclass"]', style: { shape: 'round-rectangle' } },
      { selector: 'node[type="service"]', style: { shape: 'hexagon' } },
      { selector: 'node[type="workload"]', style: { shape: 'round-rectangle' } },
      { selector: 'node[type="referencegrant"]', style: { shape: 'diamond' } },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'line-color': edge,
          'target-arrow-color': edge,
          'target-arrow-shape': 'triangle',
          width: '2px'
        }
      },
      { selector: 'edge[type="routes"]', style: { 'line-color': accent, 'target-arrow-color': accent, width: '3px' } },
      { selector: 'edge[type="class-of"]', style: { 'line-style': 'dashed' } },
      { selector: 'edge[type="grant"]', style: { 'line-style': 'dotted' } },
      { selector: 'node.selected', style: { 'border-color': selected, 'border-width': '4px' } }
    ];
  }

  function prefersReducedMotion() {
    return reducedMotionQuery?.matches ?? false;
  }

  function effectiveLayout(): CytoscapeOptions['layout'] {
    if (!prefersReducedMotion() || !layout || typeof layout === 'string') return layout;
    return { ...layout, animate: false, animationDuration: 0 };
  }

  function refreshStyles() {
    if (!cy || style !== undefined) return;
    cy.style(defaultStyle());
    cy.style().update();
  }

  function fitToContainer() {
    if (!cy) return;
    cy.resize();
    cy.fit(undefined, 36);
  }

  function scheduleFit() {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      fitToContainer();
    });
  }

  function init() {
    cy = cytoscape({
      container,
      elements,
      layout: effectiveLayout(),
      style: style ?? defaultStyle(),
      minZoom: 0.3,
      maxZoom: 3,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      autoungrabify: false
    });

    cy.on('tap', 'node', evt => {
      cy?.elements().removeClass('selected');
      evt.target.addClass('selected');
      dispatch('select', { id: evt.target.id(), target: evt.target });
    });

    cy.ready(fitToContainer);
  }

  onMount(() => {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    init();
    resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    themeObserver = new MutationObserver(refreshStyles);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    reducedMotionQuery.addEventListener('change', scheduleFit);
  });

  onDestroy(() => {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    reducedMotionQuery?.removeEventListener('change', scheduleFit);
    cy?.destroy();
    cy = null;
  });

  $: if (cy) {
    cy.json({ elements });
    cy.layout(effectiveLayout() || { name: 'breadthfirst', animate: !prefersReducedMotion() }).run();
  }

  $: if (cy && style === undefined) {
    refreshStyles();
  }

  $: if (cy && externalSelect) {
    const node = cy.getElementById(externalSelect);
    if (node && node.nonempty()) {
      cy.elements().removeClass('selected');
      node.addClass('selected');
      if (prefersReducedMotion()) cy.center(node);
      else cy.animate({ center: { eles: node }, duration: 160 });
    }
  }
</script>

<div
  bind:this={container}
  class="graph-container"
  role="img"
  aria-label="Relationship graph. Use the labelled resource selector or Route coverage table for keyboard inspection."
></div>

<style>
  .graph-container {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: 6px;
    background: var(--color-base-100);
  }

  @media (max-width: 768px) {
    .graph-container {
      border-radius: 4px;
    }
  }
</style>
