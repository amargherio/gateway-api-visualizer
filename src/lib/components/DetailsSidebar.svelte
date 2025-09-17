<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import yaml from 'js-yaml';
  export let open: boolean = true;
  export let selected: any = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }
</script>

<div class="h-full flex flex-col w-80 border-l border-base-300 bg-base-200 transition-transform duration-300" class:translate-x-full={!open}>
  {#key selected}
  <div class="p-4 border-b border-base-300 flex items-center justify-between">
    {#if selected}
      {@const resource = selected.original || selected}
      <h3 class="font-semibold text-sm flex items-center gap-2">
        <span>Details</span>
        {#if resource?.kind}<span class="badge badge-ghost text-xs">{resource.kind}</span>{/if}
      </h3>
    {:else}
      <h3 class="font-semibold text-sm">Details</h3>
    {/if}
    <button class="btn btn-xs btn-outline" on:click={close}>Close</button>
  </div>
  {/key}
  <div class="flex-1 overflow-auto p-3 text-xs">
    {#if selected}
      {@const resource = selected.original || selected}
      <!-- Basic summary list -->
      <div class="mb-3">
        <ul class="list-disc list-inside space-y-0.5">
          {#if selected.id}<li><span class="font-semibold">Graph ID:</span> {selected.id}</li>{/if}
          {#if resource.metadata?.name}<li><span class="font-semibold">Name:</span> {resource.metadata.name}</li>{/if}
          {#if resource.metadata?.namespace}<li><span class="font-semibold">Namespace:</span> {resource.metadata.namespace}</li>{/if}
          {#if resource.kind}<li><span class="font-semibold">Kind:</span> {resource.kind}</li>{/if}
          {#if selected.parentRefs && selected.parentRefs.length}
            <li>
              <span class="font-semibold">Parent Refs:</span>
              <ul class="list-disc list-inside ml-4 mt-1 space-y-0.5">
                {#each selected.parentRefs as p}
                  <li class="break-all">{p}</li>
                {/each}
              </ul>
            </li>
          {/if}
          {#if selected.missingParentRefs}
            <li>
              <span class="font-semibold">Missing Parent Refs:</span>
              <ul class="list-disc list-inside ml-4 mt-1 space-y-0.5">
                {#each selected.missingParentRefs as m}
                  <li class="break-all">{m.namespace}/{m.name}</li>
                {/each}
              </ul>
            </li>
          {/if}
        </ul>
      </div>
      {#if selected.backendRefs}
        <div class="mb-2">
          <div class="font-semibold">BackendRefs:</div>
          <table class="table table-xs w-full">
            <thead>
              <tr><th>Service</th><th>Namespace</th><th>Resolved</th><th>Cross-NS</th><th>Grant</th></tr>
            </thead>
            <tbody>
              {#each selected.backendRefs as br}
                <tr>
                  <td>{br.service}</td>
                  <td>{br.namespace}</td>
                  <td>{br.resolved ? '✅' : '❌'}</td>
                  <td>{br.crossNamespace ? 'Yes' : 'No'}</td>
                  <td>{br.crossNamespace ? (br.granted ? '✅' : '❌') : '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <details class="mb-3">
        <summary class="cursor-pointer select-none font-semibold">YAML (Resource)</summary>
        <pre class="whitespace-pre-wrap mt-2"><code>{yaml.dump(resource, { noRefs: true, lineWidth: 80 })}</code></pre>
      </details>
      <details>
        <summary class="cursor-pointer select-none font-semibold">Raw JSON (Resource)</summary>
        <pre class="whitespace-pre-wrap mt-2"><code>{JSON.stringify(resource, null, 2)}</code></pre>
      </details>
    {:else}
      <div class="text-base-content/60">No selection</div>
    {/if}
  </div>
</div>

<style>
  .translate-x-full { transform: translateX(100%); }
</style>
