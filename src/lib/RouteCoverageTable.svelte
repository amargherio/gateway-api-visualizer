<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import type { RouteCoverageDetail } from './shared.js';
  import { computeRouteCoverageView, routeCoverageColumns, type RouteSortColumn } from './routeCoverageView.js';
  import type { ResourceFilters } from './resourceFilters.js';

  export let rows: RouteCoverageDetail[] = [];
  export let initialSortCol: RouteSortColumn = 'namespace';
  export let initialSortDir: 'asc' | 'desc' = 'asc';
  export let initialFilterCoverage: 'ALL' | 'COVERED' | 'UNCOVERED' = 'ALL';
  export let defaultPageSize: number | 'All' = 20;
  export let pageSizeOptions: Array<number | 'All'> = [20, 50, 100, 'All'];
  export let title = 'Route coverage';
  export let showTitle = true;

  let sortCol: RouteSortColumn = initialSortCol;
  let sortDir: 'asc' | 'desc' = initialSortDir;
  let filterCoverage: 'ALL' | 'COVERED' | 'UNCOVERED' = initialFilterCoverage;
  let search = '';
  let pendingSearch = '';
  let hostname = '';
  let hostnameScope: NonNullable<ResourceFilters['hostnameScope']> = 'ROUTE';
  let routeMatch = '';
  let page = 1;
  let pageSize: number | 'All' = defaultPageSize;
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  const dispatch = createEventDispatcher<{ routeSelect: { id: string; route: RouteCoverageDetail; opener?: HTMLElement } }>();

  function selectRoute(route: RouteCoverageDetail, opener?: HTMLElement) {
    dispatch('routeSelect', { id: route.id, route, opener });
  }

  function onSearchInput(event: Event) {
    pendingSearch = (event.target as HTMLInputElement).value;
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      search = pendingSearch;
      page = 1;
    }, 250);
  }

  function toggleSort(column: RouteSortColumn) {
    if (sortCol === column) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = column;
      sortDir = 'asc';
    }
    page = 1;
  }


  function sortLabel(column: RouteSortColumn, activeColumn: RouteSortColumn, direction: 'asc' | 'desc') {
    const label = routeCoverageColumns.find(value => value.key === column)!.label.toLowerCase();
    if (activeColumn !== column) return `Sort by ${label} ascending`;
    return `Sort by ${label} ${direction === 'asc' ? 'descending' : 'ascending'}`;
  }

  function setPageSize(value: string) {
    pageSize = value === 'All' ? 'All' : Number.parseInt(value, 10);
    page = 1;
  }

  function goto(nextPage: number) {
    page = Math.min(Math.max(1, nextPage), totalPages);
  }

  function onPageSizeChange(event: Event) {
    setPageSize((event.target as HTMLSelectElement).value);
  }

  $: view = computeRouteCoverageView({ rows, search, hostname, hostnameScope, routeMatch, filterCoverage, sortCol, sortDir, pageSize: 'All' });
  $: total = view.total;
  $: totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  $: if (page > totalPages) page = totalPages;
  $: visible = pageSize === 'All' ? view.visible : view.visible.slice((page - 1) * pageSize, page * pageSize);

  onDestroy(() => {
    if (debounceHandle) clearTimeout(debounceHandle);
  });
</script>

<section
  class="route-coverage"
  aria-labelledby={showTitle ? 'route-coverage-heading' : undefined}
  aria-label={showTitle ? undefined : title}
>
  {#if showTitle}
    <h2 id="route-coverage-heading">{title}</h2>
  {/if}

  <div class="route-coverage__controls">
    <div>
      <label for="route-search">Search routes</label>
      <input
        class="input input-bordered"
        id="route-search"
        type="search"
        placeholder="Name, namespace, hostname or match"
        bind:value={pendingSearch}
        on:input={onSearchInput}
      />
    </div>
    <div>
      <label for="route-hostname">Hostname</label>
      <input class="input input-bordered" id="route-hostname" type="search" placeholder="Configured hostname" bind:value={hostname} on:input={() => (page = 1)} />
    </div>
    <div>
      <label for="route-hostname-scope">Hostname scope</label>
      <select class="select select-bordered" id="route-hostname-scope" bind:value={hostnameScope} on:change={() => (page = 1)}>
        <option value="ROUTE">Route hostnames</option><option value="LISTENER">Referenced listener hostnames</option><option value="ALL">Route and listener hostnames</option>
      </select>
    </div>
    <div>
      <label for="route-match">Route match</label>
      <input class="input input-bordered" id="route-match" type="search" placeholder="Path, method, header or query" bind:value={routeMatch} on:input={() => (page = 1)} />
    </div>
    <div>
      <label for="route-coverage">Parent reference</label>
      <select class="select select-bordered" id="route-coverage" bind:value={filterCoverage} on:change={() => (page = 1)}>
        <option value="ALL">All</option>
        <option value="COVERED">Has parent ref</option>
        <option value="UNCOVERED">No parent ref</option>
      </select>
    </div>
    <div>
      <label for="route-page-size">Rows per page</label>
      <select class="select select-bordered" id="route-page-size" bind:value={pageSize} on:change={onPageSizeChange}>
        {#each pageSizeOptions as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </div>
    <p class="route-coverage__matches" aria-live="polite">{total} match{total === 1 ? '' : 'es'}</p>
  </div>

  <div class="route-coverage__table-wrap" role="region" aria-label="Route parent references table" tabindex="0">
    <table aria-label={title}>
      <thead>
        <tr>
          {#each routeCoverageColumns as column}
            <th scope="col" aria-sort={sortCol === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" on:click={() => toggleSort(column.key)} aria-label={sortLabel(column.key, sortCol, sortDir)}>
                {column.label}{#if sortCol === column.key} <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>{/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if visible.length === 0}
          <tr><td colspan={routeCoverageColumns.length}>No matching routes</td></tr>
        {/if}
        {#each visible as route}
          <tr>
            <td><code>{route.namespace}</code></td>
            <td>
              <button type="button" class="route-coverage__resource" on:click={(event) => selectRoute(route, event.currentTarget as HTMLElement)}>
                {route.name}
              </button>
            </td>
            <td>
              {#each route.hostnames || [] as hostname}<div><code>{hostname}</code></div>{/each}
              {#if !route.hostnames?.length}{route.kind === 'TCPRoute' ? 'Not applicable' : 'Any hostname (unspecified)'}{/if}
            </td>
            <td>
              {#each route.listenerHostnames || [] as hostname}<div><code>{hostname}</code></div>{/each}
              {#if !route.listenerHostnames?.length}None configured{/if}
            </td>
            <td>
              {#each route.matches || [] as match}<div><code>{match}</code></div>{/each}
              {#if !route.matches?.length}{['TLSRoute', 'TCPRoute'].includes(route.kind) ? 'Not applicable' : 'No rules'}{/if}
            </td>
            <td>{route.covered ? 'Has parent ref' : 'No parent ref'}</td>
            <td>{route.parentRefs.length ? route.parentRefs.join(', ') : 'None'}</td>
            <td class:route-coverage__missing={Boolean(route.missingParentRefs?.length)}>
              {route.missingParentRefs?.length ? route.missingParentRefs.map((parent) => `${parent.namespace}/${parent.name}`).join(', ') : 'None'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if pageSize !== 'All' && totalPages > 1}
    <nav class="route-coverage__pagination" aria-label="Route coverage pages">
      <p>Page {page} of {totalPages}</p>
      <div>
        <button type="button" class="btn btn-outline" on:click={() => goto(1)} disabled={page === 1} aria-label="First page">First</button>
        <button type="button" class="btn btn-outline" on:click={() => goto(page - 1)} disabled={page === 1}>Previous</button>
        <button type="button" class="btn btn-outline" on:click={() => goto(page + 1)} disabled={page === totalPages}>Next</button>
        <button type="button" class="btn btn-outline" on:click={() => goto(totalPages)} disabled={page === totalPages} aria-label="Last page">Last</button>
      </div>
    </nav>
  {/if}
</section>

<style>
  .route-coverage {
    border: 1px solid var(--color-base-300);
    border-radius: 6px;
    background: var(--color-base-50);
    padding: 1rem;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .route-coverage__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--color-secondary);
    font-size: 0.8125rem;
  }


  .route-coverage__matches {
    margin: 0 0 0 auto;
    color: var(--color-secondary);
    font-size: 0.8125rem;
  }

  .route-coverage__table-wrap {
    overflow-x: auto;
  }

  td code {
    overflow-wrap: anywhere;
  }

  .route-coverage__controls > div {
    min-width: 0;
    max-width: 100%;
  }

  input {
    max-width: 100%;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  th,
  td {
    border-bottom: 1px solid var(--color-base-200);
    padding: 0.625rem;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--color-secondary);
    font-weight: 600;
  }

  th button,
  .route-coverage__resource {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  th button:hover,
  .route-coverage__resource:hover {
    color: var(--color-primary);
  }

  .route-coverage__resource {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  tr:hover td {
    background: var(--color-base-100);
  }

  .route-coverage__missing {
    color: var(--color-error);
  }

  .route-coverage__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .route-coverage__pagination p {
    margin: 0;
    color: var(--color-secondary);
    font-size: 0.8125rem;
  }

  .route-coverage__pagination div {
    display: flex;
    gap: 0.375rem;
  }


  @media (max-width: 640px) {

    .route-coverage__matches {
      flex-basis: 100%;
      margin-left: 0;
    }

    .route-coverage__pagination {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
