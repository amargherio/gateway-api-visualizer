<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { dump } from 'js-yaml';

  type ResourceSummary = {
    kind?: string;
    metadata?: { name?: string; namespace?: string };
  };
  type SelectedDetails = ResourceSummary & {
    original?: ResourceSummary;
    id?: string;
    parentRefs?: string[];
    missingParentRefs?: Array<{ namespace: string; name: string }>;
    backendRefs?: Array<{
      service: string;
      namespace: string;
      resolved: boolean;
      crossNamespace: boolean;
      granted: boolean;
    }>;
  };

  export let open: boolean = true;
  export let selected: SelectedDetails | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

<aside
  class="details-sidebar"
  class:details-closed={!open}
  aria-labelledby="resource-details-heading"
  aria-hidden={!open}
  on:keydown={onKeydown}
>
  <header class="details-header">
    <div>
      <h2 id="resource-details-heading" tabindex="-1">Resource details</h2>
      {#if selected}
        {@const resource = selected.original || selected}
        {#if resource?.kind}<p class="resource-kind">{resource.kind}</p>{/if}
      {/if}
    </div>
    <button type="button" class="btn btn-sm btn-outline" on:click={close}>Close</button>
  </header>

  <div class="details-content">
    {#if selected}
      {@const resource = selected.original || selected}
      <dl class="resource-summary">
        {#if selected.id}<div><dt>Graph ID</dt><dd>{selected.id}</dd></div>{/if}
        {#if resource.metadata?.name}<div><dt>Name</dt><dd>{resource.metadata.name}</dd></div>{/if}
        {#if resource.metadata?.namespace}<div><dt>Namespace</dt><dd>{resource.metadata.namespace}</dd></div>{/if}
        {#if resource.kind}<div><dt>Kind</dt><dd>{resource.kind}</dd></div>{/if}
      </dl>

      {#if selected.parentRefs?.length}
        <section class="reference-section" aria-labelledby="parent-refs-heading">
          <h3 id="parent-refs-heading">Parent references</h3>
          <ul>
            {#each selected.parentRefs as parent}
              <li>{parent}</li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if selected.missingParentRefs?.length}
        <section class="reference-section" aria-labelledby="missing-parent-refs-heading">
          <h3 id="missing-parent-refs-heading">Missing parent references</h3>
          <ul>
            {#each selected.missingParentRefs as parent}
              <li>{parent.namespace}/{parent.name}</li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if selected.backendRefs?.length}
        <section class="backend-section" aria-labelledby="backend-refs-heading">
          <h3 id="backend-refs-heading">Backend references</h3>
          <div class="backend-table-wrap">
            <table class="table">
              <thead>
                <tr><th>Service</th><th>Namespace</th><th>Resolved</th><th>Cross-namespace</th><th>Grant</th></tr>
              </thead>
              <tbody>
                {#each selected.backendRefs as backend}
                  <tr>
                    <td>{backend.service}</td>
                    <td>{backend.namespace}</td>
                    <td>{backend.resolved ? 'Resolved' : 'Not resolved'}</td>
                    <td>{backend.crossNamespace ? 'Yes' : 'No'}</td>
                    <td>{backend.crossNamespace ? (backend.granted ? 'Granted' : 'Not granted') : 'Not required'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <details>
        <summary>YAML resource</summary>
        <pre><code>{dump(resource, { noRefs: true, lineWidth: 80 })}</code></pre>
      </details>
      <details>
        <summary>Raw JSON resource</summary>
        <pre><code>{JSON.stringify(resource, null, 2)}</code></pre>
      </details>
    {:else}
      <p class="empty-details">Select a resource from the relationship controls or route table to inspect it.</p>
    {/if}
  </div>
</aside>

<style>
  .details-sidebar {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    height: 100%;
    border: 1px solid var(--color-base-300);
    border-radius: 6px;
    background: var(--color-base-50);
    color: var(--color-base-content);
  }

  .details-closed {
    display: none;
  }

  .details-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--color-base-300);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 16px;
    font-weight: 600;
  }

  h3 {
    font-size: 13px;
    font-weight: 600;
  }

  .resource-kind {
    margin-top: 0.1875rem;
    color: var(--color-secondary);
    font-size: 13px;
  }

  .details-content {
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    font-size: 13px;
  }

  .resource-summary {
    display: grid;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }

  .resource-summary > div {
    display: grid;
    grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
    gap: 0.75rem;
  }

  dt {
    color: var(--color-secondary);
    font-weight: 600;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .reference-section,
  .backend-section {
    margin: 1rem 0;
  }

  .reference-section ul {
    display: grid;
    gap: 0.25rem;
    margin: 0.5rem 0 0;
    padding-left: 1rem;
  }

  .reference-section li {
    overflow-wrap: anywhere;
  }

  .backend-table-wrap {
    overflow-x: auto;
    margin-top: 0.5rem;
  }

  details {
    margin-top: 0.75rem;
    border-top: 1px solid var(--color-base-300);
    padding-top: 0.75rem;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
  }

  pre {
    overflow: auto;
    margin: 0.5rem 0 0;
    padding: 0.75rem;
    border: 1px solid var(--color-base-300);
    border-radius: 4px;
    background: var(--color-base-100);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty-details {
    color: var(--color-secondary);
    line-height: 1.5;
  }

  @media (max-width: 1099px) {
    .details-sidebar {
      min-height: 18rem;
    }
  }
</style>
