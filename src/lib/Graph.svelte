<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import cytoscape from 'cytoscape';
  import type { Core, CytoscapeOptions } from 'cytoscape';

  export let elements: any[] = [];
  export let layout: CytoscapeOptions['layout'] = { name: 'breadthfirst', animate: true, animationDuration: 400 };
  export let style: CytoscapeOptions['style'] = [
    // Node styles now use data(width) / data(height) which are computed in App.svelte's toElements()
    // based on a heuristic (avgCharWidth * label length + padding) with min/max per node type.
    // If multi-line or wrapped labels are desired later, insert "\n" into labels where needed
    // and adjust the height heuristic accordingly.
    { 
      selector: 'node[type="gateway"]', 
      style: { 
        'background-color': '#0366d6', 
        'label': 'data(label)', 
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'round-rectangle',
        'border-width': '2px',
        'border-color': '#0366d6'
      } 
    },
    { 
      selector: 'node[type="listener"]', 
      style: { 
        'background-color': '#58a6ff', 
        'label': 'data(label)', 
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'ellipse',
        'border-width': '1px',
        'border-color': '#58a6ff'
      } 
    },
    { 
      selector: 'node[type="route"]', 
      style: { 
        'background-color': '#8b949e', 
        'label': 'data(label)', 
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'rectangle',
        'border-width': '1px',
        'border-color': '#8b949e'
      } 
    },
    { 
      selector: 'node[type="gatewayclass"]', 
      style: { 
        'background-color': '#8250df', 
        'label': 'data(label)',
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'round-rectangle',
        'border-width': '1px',
        'border-color': '#8250df'
      }
    },
    { 
      selector: 'node[type="service"]', 
      style: { 
        'background-color': '#1f6feb', 
        'label': 'data(label)',
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'hexagon',
        'border-width': '1px',
        'border-color': '#1f6feb'
      }
    },
    { 
      selector: 'node[type="workload"]', 
      style: { 
        'background-color': '#bf3989', 
        'label': 'data(label)',
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'round-rectangle',
        'border-width': '1px',
        'border-color': '#bf3989'
      }
    },
    { 
      selector: 'node[type="referencegrant"]', 
      style: { 
        'background-color': '#c69026', 
        'label': 'data(label)',
        'color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'width': 'data(width)',
        'height': 'data(height)',
        'shape': 'diamond',
        'border-width': '1px',
        'border-color': '#c69026'
      }
    },
    { 
      selector: 'edge[type="owns"]', 
      style: { 
        'line-color': '#6e7681', 
        'target-arrow-shape': 'triangle', 
        'target-arrow-color': '#6e7681',
        'width': '2px',
        'curve-style': 'bezier'
      } 
    },
    { 
      selector: 'edge[type="routes"]', 
      style: { 
        'line-color': '#56d364', 
        'target-arrow-shape': 'triangle', 
        'target-arrow-color': '#56d364',
        'width': '3px',
        'curve-style': 'bezier'
      } 
    },
    { selector: 'edge[type="class-of"]', style: { 'line-color': '#8250df', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#8250df', 'width': '2px', 'curve-style': 'bezier', 'line-style': 'dashed' } },
    { selector: 'edge[type="backend"]', style: { 'line-color': '#1f6feb', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#1f6feb', 'width': '2px', 'curve-style': 'bezier' } },
    { selector: 'edge[type="serves"]', style: { 'line-color': '#bf3989', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#bf3989', 'width': '2px', 'curve-style': 'bezier' } },
    { selector: 'edge[type="grant"]', style: { 'line-color': '#c69026', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#c69026', 'width': '2px', 'curve-style': 'bezier', 'line-style': 'dotted' } },
    // Hover effects
    { 
      selector: 'node:hover', 
      style: { 
        'border-width': '3px',
        'border-opacity': '0.8'
      } 
    },
    // Selected state
    { 
      selector: 'node.selected', 
      style: { 
        'border-width': '4px',
        'border-color': '#ff6b35',
        'border-opacity': '1'
      } 
    }
  ];

  let container: HTMLDivElement;
  let cy: Core | null = null;
  const dispatch = createEventDispatcher();

  function init() {
    if (cy) cy.destroy();
    cy = cytoscape({
      container,
      elements,
      layout,
      style,
      wheelSensitivity: 0.1,
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

    // Fit graph to container on mount
    cy.ready(() => {
      cy?.fit(undefined, 50); // 50px padding
    });
  }

  onMount(() => {
    init();
  });

  onDestroy(() => {
    if (cy) cy.destroy();
  });

  $: if (cy) {
    // Update elements (preserve positions when possible)
    cy.json({ elements });
    const l = cy.layout(layout || { name: 'breadthfirst', animate: true });
    l.run();
  }
</script>

<style>
  .graph-container { 
    height: 100%; 
    width: 100%;
    background: hsl(var(--b1));
    border-radius: 0.5rem;
  }
  
  /* Selected node styling */
  :global(.cytoscape-container .selected) { 
    outline: 3px solid hsl(var(--p)) !important; 
    outline-offset: 2px;
  }
  
  /* Responsive adjustments */
  @media (max-width: 768px) {
    .graph-container {
      border-radius: 0.25rem;
    }
  }
</style>

<div bind:this={container} class="graph-container" />
