<script lang="ts">
  import type { GatewayApiBundle, GatewayApiFeature, GatewayApiSource } from './gatewayApi.js';

  export let bundle: GatewayApiBundle;

  let featureFilter = '';

  function featureMatches(feature: GatewayApiFeature, query: string) {
    return feature.name.toLowerCase().includes(query.trim().toLowerCase());
  }

  function sourceLabel(source: GatewayApiSource) {
    return source.url.split('/').pop() || source.url;
  }

  $: crds = [...bundle.crds].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.group.localeCompare(right.group),
  );
  $: standardFeatures = bundle.features
    .filter((feature) => feature.channel === 'standard' && featureMatches(feature, featureFilter))
    .sort((left, right) => left.name.localeCompare(right.name));
  $: experimentalFeatures = bundle.features
    .filter((feature) => feature.channel === 'experimental' && featureMatches(feature, featureFilter))
    .sort((left, right) => left.name.localeCompare(right.name));
  $: hasMatchingFeatures = standardFeatures.length + experimentalFeatures.length > 0;
</script>

<details class="gateway-api-support">
  <summary>Release support</summary>
  <div class="gateway-api-support__content">
    <p class="gateway-api-support__release">
      <span>Gateway API {bundle.id}</span>
      <span>Source tag <code>{bundle.tag}</code></span>
    </p>

    <section aria-labelledby="gateway-api-crds-heading">
      <h3 id="gateway-api-crds-heading">Audited CRDs</h3>
      <div class="gateway-api-support__table-wrap" role="region" aria-label="Audited CRDs table" tabindex="0">
        <table aria-labelledby="gateway-api-crds-heading">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">API group</th>
              <th scope="col">Scope</th>
              <th scope="col">Served apiVersions</th>
              <th scope="col">Maturity</th>
            </tr>
          </thead>
          <tbody>
            {#each crds as crd}
              <tr>
                <td><code>{crd.kind}</code></td>
                <td><code>{crd.group}</code></td>
                <td>{crd.scope}</td>
                <td>
                  <span>{crd.servedVersions.join(', ') || 'None'}</span>
                  {#if crd.unservedVersions.length}
                    <span class="gateway-api-support__unserved">Unserved: {crd.unservedVersions.join(', ')}</span>
                  {/if}
                </td>
                <td>{crd.channel === 'standard' ? 'Standard' : 'Experimental'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="gateway-api-features-heading">
      <div class="gateway-api-support__features-heading">
        <h3 id="gateway-api-features-heading">Published feature catalog</h3>
        <div>
          <label for="gateway-api-feature-filter">Filter features</label>
          <input
            class="input input-bordered"
            id="gateway-api-feature-filter"
            type="search"
            placeholder="Feature identifier"
            bind:value={featureFilter}
          />
        </div>
      </div>

      {#if hasMatchingFeatures}
        <div class="gateway-api-support__feature-groups">
          <section aria-labelledby="gateway-api-standard-features">
            <h4 id="gateway-api-standard-features">Standard</h4>
            {#if standardFeatures.length}
              <ul>
                {#each standardFeatures as feature}
                  <li><code>{feature.name}</code></li>
                {/each}
              </ul>
            {:else}
              <p class="gateway-api-support__empty-group">No standard features match this filter.</p>
            {/if}
          </section>
          <section aria-labelledby="gateway-api-experimental-features">
            <h4 id="gateway-api-experimental-features">Experimental</h4>
            {#if experimentalFeatures.length}
              <ul>
                {#each experimentalFeatures as feature}
                  <li><code>{feature.name}</code></li>
                {/each}
              </ul>
            {:else}
              <p class="gateway-api-support__empty-group">No experimental features match this filter.</p>
            {/if}
          </section>
        </div>
      {:else}
        <p class="gateway-api-support__empty" role="status">No matching features</p>
      {/if}
    </section>

    <section aria-labelledby="gateway-api-sources-heading">
      <h3 id="gateway-api-sources-heading">Sources</h3>
      <ul class="gateway-api-support__sources">
        <li>
          <a href={bundle.sources.standard.url} target="_blank" rel="noreferrer">Standard installation</a>
          <code>{bundle.sources.standard.sha256}</code>
        </li>
        <li>
          <a href={bundle.sources.experimental.url} target="_blank" rel="noreferrer">Experimental installation</a>
          <code>{bundle.sources.experimental.sha256}</code>
        </li>
        {#each bundle.sources.featureFiles as source}
          <li>
            <a href={source.url} target="_blank" rel="noreferrer">Feature source: {sourceLabel(source)}</a>
            <code>{source.sha256}</code>
          </li>
        {/each}
      </ul>
    </section>

    <div class="gateway-api-support__caveats">
      <p>CRD structure and release compatibility only. CEL admission rules and controller-specific support are not evaluated.</p>
      <p>The published feature catalog is not an exhaustive field list. All listed CRDs are audited, but schema-only kinds do not appear in the relationship graph.</p>
    </div>
  </div>
</details>

<style>
  .gateway-api-support {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    border-top: 1px solid var(--color-base-300);
    background: var(--color-base-50);
    color: var(--color-base-content);
  }

  summary {
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    padding: 0.75rem 1rem;
  }

  summary:focus-visible,
  input:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  summary:focus-visible {
    outline-offset: -3px;
  }

  .gateway-api-support__content {
    min-width: 0;
    border-top: 1px solid var(--color-base-200);
    padding: 1rem;
  }

  .gateway-api-support__release {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin: 0 0 1rem;
    color: var(--color-secondary);
    font-size: 0.8125rem;
  }

  section + section {
    margin-top: 1.25rem;
  }

  h3,
  h4 {
    color: var(--color-base-content);
    font-weight: 600;
  }

  h3 {
    font-size: 0.875rem;
    margin: 0 0 0.625rem;
  }

  h4 {
    font-size: 0.8125rem;
    margin: 0 0 0.5rem;
  }

  .gateway-api-support__table-wrap {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  th,
  td {
    border-bottom: 1px solid var(--color-base-200);
    padding: 0.5rem;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--color-secondary);
    font-weight: 600;
  }

  .gateway-api-support__unserved {
    display: block;
    color: var(--color-secondary);
    margin-top: 0.25rem;
  }

  .gateway-api-support__features-heading {
    align-items: end;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .gateway-api-support__features-heading h3 {
    margin-bottom: 0;
  }

  label {
    color: var(--color-secondary);
    display: block;
    font-size: 0.8125rem;
    margin-bottom: 0.25rem;
  }


  .gateway-api-support__feature-groups {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 0.75rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li + li {
    margin-top: 0.25rem;
  }

  .gateway-api-support__empty,
  .gateway-api-support__empty-group {
    color: var(--color-secondary);
    font-size: 0.8125rem;
    margin: 0.75rem 0 0;
  }

  .gateway-api-support__sources {
    font-size: 0.8125rem;
  }

  .gateway-api-support__sources li {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
  }

  .gateway-api-support__sources a {
    color: var(--color-primary);
  }

  .gateway-api-support__sources code {
    color: var(--color-secondary);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  .gateway-api-support__caveats {
    border-top: 1px solid var(--color-base-200);
    color: var(--color-secondary);
    font-size: 0.8125rem;
    margin-top: 1.25rem;
    padding-top: 0.75rem;
  }

  .gateway-api-support__caveats p {
    margin: 0;
  }

  .gateway-api-support__caveats p + p {
    margin-top: 0.5rem;
  }

  @media (max-width: 640px) {

    .gateway-api-support__feature-groups {
      grid-template-columns: 1fr;
    }
  }
</style>
