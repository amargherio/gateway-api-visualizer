<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let open: boolean = true;
  export let selected: any = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }
</script>

<div class="h-full flex flex-col w-80 border-l border-base-300 bg-base-200 transition-transform duration-300" class:translate-x-full={!open}>
  <div class="p-4 border-b border-base-300 flex items-center justify-between">
    <h3 class="font-semibold text-sm flex items-center gap-2">
      <span>Details</span>
      {#if selected?.name}<span class="badge badge-ghost text-xs">{selected.kind || selected.type}</span>{/if}
    </h3>
    <button class="btn btn-xs btn-outline" on:click={close}>Close</button>
  </div>
  <div class="flex-1 overflow-auto p-3 text-xs">
    {#if selected}
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
      <pre class="whitespace-pre-wrap"><code>{JSON.stringify(selected, null, 2)}</code></pre>
    {:else}
      <div class="text-base-content/60">No selection</div>
    {/if}
  </div>
</div>

<style>
  .translate-x-full { transform: translateX(100%); }
</style>
