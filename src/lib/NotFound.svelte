<script lang="ts">
  import { onMount } from 'svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { theme } from './theme.js';

  const home = import.meta.env.BASE_URL;
  const requestedPath = window.location.pathname;
  const canGoBack = window.history.length > 1;

  onMount(() => {
    document.documentElement.setAttribute('data-theme', $theme);
  });
</script>


<div class="not-found">
  <header>
    <a class="brand" href={home}>Gateway API Visualizer</a>
    <ThemeToggle />
  </header>

  <main>
    <div class="recovery">
      <p class="eyebrow">404 / Page not found</p>
      <h1>No route matched.</h1>
      <p class="intro">This address doesn't lead to a page. The workbench is one hop away.</p>

      <dl class="request">
        <dt>Requested path</dt>
        <dd><code>{requestedPath}</code></dd>
      </dl>

      <div class="actions">
        <a class="btn btn-primary" href={home}>Open the workbench <span aria-hidden="true">→</span></a>
        {#if canGoBack}
          <button class="btn btn-outline" type="button" on:click={() => window.history.back()}>Go back</button>
        {/if}
      </div>
      <p class="hint">Following a bookmark? Open the workbench, then save its address instead.</p>
    </div>

    <figure>
      <svg viewBox="0 0 400 260" aria-hidden="true" focusable="false">
        <path class="route" d="M52 72H240" />
        <path class="unmatched" d="M240 72H344" />
        <path class="return-route" d="M172 72V178Q172 202 196 202H260" />
        <circle class="origin" cx="52" cy="72" r="8" />
        <circle class="junction" cx="172" cy="72" r="5" />
        <circle class="missing" cx="344" cy="72" r="15" />
        <path class="missing-mark" d="M339 67L349 77M349 67L339 77" />
        <rect class="destination" x="260" y="183" width="112" height="38" rx="6" />
        <path class="arrow" d="M248 196L255 202L248 208" />
        <text x="36" y="42" class="diagram-label">REQUEST</text>
        <text x="344" y="115" text-anchor="middle" class="diagram-label">NO MATCH</text>
        <text x="316" y="207" text-anchor="middle" class="destination-label">WORKBENCH</text>
        <text x="172" y="246" class="diagram-label">A known way back.</text>
      </svg>
      <figcaption>Even a good route map has the occasional wrong turn.</figcaption>
    </figure>

    <p class="footnote">This is a missing web page, not a Gateway API validation result.</p>
  </main>
</div>

<style>
  .not-found {
    min-height: 100svh;
    background: var(--color-base-100);
    color: var(--color-base-content);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 58px;
    padding: 0 24px;
    border-bottom: 1px solid var(--color-base-300);
    background: var(--color-base-50);
  }

  .brand {
    font-size: 1.125rem;
    font-weight: 600;
    color: inherit;
    text-decoration: none;
  }

  .brand:hover { text-decoration: underline; }

  main {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: center;
    gap: 48px;
    max-width: 1060px;
    margin: 0 auto;
    padding: 96px 32px 32px;
  }

  .eyebrow {
    margin: 0 0 16px;
    color: var(--color-secondary);
    font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  h1 {
    margin: 0 0 16px;
    font-size: 2rem;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.025em;
  }

  .intro {
    max-width: 44ch;
    margin: 0;
    font-size: 1rem;
    line-height: 1.6;
  }

  .request { margin: 32px 0 24px; }
  dt { margin-bottom: 6px; color: var(--color-secondary); font-size: 0.75rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
  code { font: 0.875rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; }
  .hint { max-width: 48ch; margin: 16px 0 0; color: var(--color-secondary); font-size: 0.8125rem; }

  figure { min-width: 0; margin: 0; }
  svg { display: block; width: 100%; height: auto; }
  .route, .return-route, .unmatched, .arrow { fill: none; stroke-width: 2; }
  .route, .return-route, .arrow { stroke: var(--color-primary); }
  .unmatched { stroke: var(--color-secondary); stroke-dasharray: 4 6; }
  .origin, .junction { fill: var(--color-primary); }
  .missing { fill: var(--color-base-50); stroke: var(--color-warning); stroke-width: 2; }
  .missing-mark { stroke: var(--color-warning); stroke-width: 2; }
  .destination { fill: var(--color-base-50); stroke: var(--color-primary); stroke-width: 2; }
  .diagram-label { fill: var(--color-secondary); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
  .destination-label { fill: var(--color-base-content); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
  figcaption { margin-top: 16px; color: var(--color-secondary); font-size: 0.8125rem; text-align: center; }

  .footnote {
    grid-column: 1 / -1;
    margin: 0;
    padding-top: 24px;
    border-top: 1px solid var(--color-base-300);
    color: var(--color-secondary);
    font-size: 0.75rem;
  }

  @media (max-width: 700px) {
    header { padding: 8px 16px; }
    main { grid-template-columns: minmax(0, 1fr); padding: 48px 24px 24px; gap: 32px; }
    figure { max-width: 400px; width: 100%; justify-self: center; }
  }
</style>
