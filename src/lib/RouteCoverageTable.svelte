<script lang="ts">
  import type { RouteCoverageDetail } from './shared.js';
  import { createEventDispatcher } from 'svelte';

  export let rows: RouteCoverageDetail[] = [];
  export let initialSortCol: 'namespace' | 'name' = 'namespace';
  export let initialSortDir: 'asc' | 'desc' = 'asc';
  export let initialFilterCoverage: 'ALL' | 'COVERED' | 'UNCOVERED' = 'ALL';
  export let defaultPageSize: number | 'All' = 20;
  export let pageSizeOptions: Array<number | 'All'> = [20,50,100,'All'];
  export let title: string = '📋 Route Coverage';
  export let showTitle: boolean = true;

  let sortCol: 'namespace' | 'name' = initialSortCol;
  let sortDir: 'asc' | 'desc' = initialSortDir;
  let filterCoverage: 'ALL' | 'COVERED' | 'UNCOVERED' = initialFilterCoverage;
  let search = '';
  let pendingSearch = '';
  let page = 1;
  let pageSize: number | 'All' = defaultPageSize;
  let debounceHandle: any;
  const dispatch = createEventDispatcher();
  function onRowClick(rc: RouteCoverageDetail) {
    // Emit routeSelect with id + full row
    dispatch('routeSelect', { id: rc.id, route: rc });
  }

  function onSearchInput(e: Event) {
    pendingSearch = (e.target as HTMLInputElement).value;
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => { search = pendingSearch; page = 1; }, 250);
  }
  function toggleSort(col: 'namespace' | 'name') {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = 'asc'; }
    page = 1;
  }
  function coverageBadge(covered: boolean) { return covered ? 'badge-success' : 'badge-error'; }
  $: filtered = rows.filter(r => {
      if (filterCoverage === 'COVERED' && !r.covered) return false;
      if (filterCoverage === 'UNCOVERED' && r.covered) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!r.name.toLowerCase().includes(s) && !r.namespace.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  $: sorted = [...filtered].sort((a,b) => {
      const av = a[sortCol].toLowerCase();
      const bv = b[sortCol].toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      if (sortCol !== 'namespace') {
        const nsa = a.namespace.toLowerCase();
        const nsb = b.namespace.toLowerCase();
        if (nsa !== nsb) return nsa < nsb ? -1 : 1;
      }
      const na = a.name.toLowerCase();
      const nb = b.name.toLowerCase();
      if (na !== nb) return na < nb ? -1 : 1;
      return 0;
    });
  $: total = sorted.length;
  $: totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / (pageSize as number)));
  $: if (page > totalPages) page = totalPages;
  $: visible = pageSize === 'All' ? sorted : sorted.slice((page-1)*(pageSize as number), (page-1)*(pageSize as number) + (pageSize as number));
  function setPageSize(val: string) { pageSize = val === 'All' ? 'All' : parseInt(val,10) as any; page = 1; }
  function goto(p: number) { page = Math.min(Math.max(1,p), totalPages); }
  function onPageSizeChange(e: Event) {
    setPageSize((e.target as HTMLSelectElement).value);
  }
</script>

<div class="card bg-base-200 shadow-lg my-6">
  <div class="card-body">
    {#if showTitle}
      <h2 class="card-title mb-4">{title}</h2>
    {/if}
    <div class="flex flex-wrap gap-4 items-end mb-4">
      <div class="form-control">
        <label class="label pb-1"><span class="label-text text-xs">Search</span></label>
        <input type="text" class="input input-bordered input-sm w-56" placeholder="Name/Namespace" bind:value={pendingSearch} on:input={onSearchInput} />
      </div>
      <div class="form-control">
        <label class="label pb-1"><span class="label-text text-xs">Coverage</span></label>
        <select class="select select-bordered select-sm" bind:value={filterCoverage} on:change={() => { page=1; }}>
          <option value="ALL">All</option>
          <option value="COVERED">Covered</option>
          <option value="UNCOVERED">Uncovered</option>
        </select>
      </div>
      <div class="form-control">
        <label class="label pb-1"><span class="label-text text-xs">Page Size</span></label>
  <select class="select select-bordered select-sm" bind:value={pageSize} on:change={onPageSizeChange}>
          {#each pageSizeOptions as opt}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
      </div>
      <div class="ml-auto text-sm opacity-70">{total} match{total === 1 ? '' : 'es'}</div>
    </div>
    <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th class="cursor-pointer select-none" on:click={() => toggleSort('namespace')}>
              Namespace {#if sortCol === 'namespace'}<span class="ml-1 text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
            </th>
            <th class="cursor-pointer select-none" on:click={() => toggleSort('name')}>
              Name {#if sortCol === 'name'}<span class="ml-1 text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
            </th>
            <th>Status</th>
            <th>Parents</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {#if visible.length === 0}
            <tr><td colspan="5" class="text-center italic opacity-70">No matching routes</td></tr>
          {/if}
          {#each visible as rc}
            <tr class="hover" on:click={() => onRowClick(rc)}>
              <td class="font-mono text-sm">{rc.namespace}</td>
              <td class="font-mono text-sm">{rc.name}</td>
              <td><div class="badge {coverageBadge(rc.covered)}">{rc.covered ? 'Covered' : 'Uncovered'}</div></td>
              <td class="text-sm">{rc.parentRefs.join(', ')}</td>
              <td class="text-sm text-error">{rc.missingParentRefs ? rc.missingParentRefs.map(m => m.name).join(', ') : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if pageSize !== 'All' && totalPages > 1}
      <div class="flex items-center justify-between mt-4 gap-4 flex-wrap">
        <div class="text-sm">Page {page} / {totalPages}</div>
        <div class="join">
          <button class="btn btn-sm join-item" on:click={() => goto(1)} disabled={page===1}>«</button>
            <button class="btn btn-sm join-item" on:click={() => goto(page-1)} disabled={page===1}>Prev</button>
            <button class="btn btn-sm join-item" on:click={() => goto(page+1)} disabled={page===totalPages}>Next</button>
          <button class="btn btn-sm join-item" on:click={() => goto(totalPages)} disabled={page===totalPages}>»</button>
        </div>
      </div>
    {/if}
  </div>
</div>
