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
      <pre class="whitespace-pre-wrap"><code>{JSON.stringify(selected, null, 2)}</code></pre>
    {:else}
      <div class="text-base-content/60">No selection</div>
    {/if}
  </div>
</div>

<style>
  .translate-x-full { transform: translateX(100%); }
</style>
