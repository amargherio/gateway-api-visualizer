# Gateway API Visualizer

Visualize relationships between Kubernetes Gateway API `Gateway` and route resources directly from local YAML you edit in the browser.

## Features

- Local multi-document YAML/JSON editor with release-specific CRD diagnostics
- Gateway API audit targets 1.3 (`v1.3.0`), 1.4 (`v1.4.1`), 1.5 (`v1.5.1`), and 1.6 (`v1.6.2`)
- Standard and experimental CRD inventories, served API versions, and published feature catalogs
- In-place version switching that preserves editor text, cursor, scroll position, and undo history
- Relationship graph for `Gateway`, `HTTPRoute`, `TLSRoute`, `TCPRoute`, and `GRPCRoute`
- Route parent-reference summary, filtering, sorting, pagination, and keyboard inspection
- Same-origin, checked-in audit bundles: manifests never leave the browser
- Responsive light and dark engineering workbench

CRD diagnostics check release compatibility and structural fields. They do not execute Kubernetes CEL admission rules or prove support in a specific Gateway controller. The relationship graph is a local preview; a parent reference is not proof that a controller accepted an attachment.

## Project Layout (flattened)

The project has been fully flattened. All source now resides under `src/` at the repository root. Former workspace packages were consolidated; shared types + coverage graph builder live in `src/lib/shared.ts`.

```text
src/
  App.svelte
  main.ts
  lib/
    gatewayApi.ts     # release contracts + same-origin bundle loader
    GatewayApiSupport.svelte
    shared.ts         # types + relationship graph builder
    YamlEditor.svelte
    Graph.svelte
    RouteCoverageTable.svelte
    ThemeToggle.svelte
    NotFound.svelte   # lightweight missing-page recovery
    components/
```

## Getting Started

Install dependencies (requires Node 20.19+, 22.12+, or 24+ and pnpm 9):

```bash
corepack enable # if pnpm not installed
pnpm install
```

Run dev (web UI):

```bash
pnpm dev
```

Web UI runs on :5173. Paste / edit YAML in the left panel and the graph updates instantly.

Regenerate the checked-in release bundles from exact upstream release assets and same-tag feature sources:

```bash
node scripts/generate-gateway-api.mjs
```

Generation verifies published asset digests where available and writes deterministic files under `public/gateway-api/`. Normal builds and application runtime do not contact GitHub.

## Sample YAML

Examples you can copy into the editor:

- `data/sample.yaml` – Minimal example with one Gateway and a few routes (includes an orphan route)
- `data/sample-multi-gateways.yaml` – Larger scenario with 3 Gateways (multiple listeners each) and 20 routes spanning `HTTPRoute`, `TLSRoute`, and `GRPCRoute`, including multi-parent and orphaned routes to exercise coverage logic

In the UI you can use the Insert Sample dropdown to load either dataset directly without leaving the app.

## Coverage Graph Schema

```text
CoverageGraph {
  nodes: { id, type: gateway|listener|route, label }[]
  edges: { id, source, target, type: owns|routes }[]
  summary: { gateways, routes, coveredRoutes, uncoveredRoutes, coveragePercent }
  routeCoverage: {
     id, name, namespace, covered, parentRefs[], missingParentRefs?[]
  }[]
}
```

## Testing

```bash
pnpm test
pnpm run test:browser
```

### Keyboard and accessibility

- Use the first Tab stop, **Skip to main content**, to reach the workbench.
- Tab leaves the manifest editor by default. F1 opens editor commands, including
  **Toggle Tab Key Moves Focus** when indentation with Tab is preferred.
- Inspect resources through the labelled selector or route-name buttons. Escape
  or Close dismisses resource details and returns focus to the initiating control.
- Overflowing tables are labelled keyboard-focusable regions; use arrow keys to
  scroll them without moving the whole page.

The UI targets WCAG AA, including text and control-boundary contrast in both
themes, visible focus, reduced motion, and narrow-screen reflow. Browser
regressions cover keyboard navigation, expanded diagnostics, graph visibility at
320px, and input-boundary contrast. Automated checks do not establish complete
WCAG conformance; assistive-technology review remains necessary.

### YAML worker compatibility

The editor and `monaco-yaml` share the pinned `monaco-editor@0.56.0` instance.
`monaco-worker-manager@2.0.1` still calls Monaco's legacy host API, so
`patches/monaco-worker-manager@2.0.1.patch` adapts only its host worker creation
to Monaco's Worker-based API. The worker continues to use Monaco's existing
`initialize`/`createData` transport. The application imports the public,
tree-shakeable editor entry instead of Monaco's full language bundle.

Upgrade Monaco, monaco-yaml, and the manager patch together. The Playwright
suite runs against both Vite development and the production preview. It checks
worker-owned YAML syntax/schema markers, recovery after correction, a
Promise-returning worker factory, hover/completion/formatting, and the shipped
multi-gateway sample. Parser errors alone do not prove that the worker works.

### Dependency security

Vite 8 uses Rolldown and Oxc instead of Rollup and esbuild. The pnpm override
removes Vite's unused optional esbuild compatibility peer. The build retains
the previous browser targets and the separate Monaco chunk.

Monaco vendors DOMPurify, so dependency metadata alone does not update the
sanitizer shipped to browsers. The patch in
`patches/monaco-editor@0.56.0.patch` redirects Monaco's sanitizer integration
to the DOMPurify package, which is constrained to `^3.4.15` by a scoped pnpm
override. Keep the patch until a compatible Monaco release uses a
non-vulnerable sanitizer; review the vendored code as well as the dependency
version before removing it.

After dependency changes, run `pnpm install --frozen-lockfile` before
`pnpm run typecheck`, `pnpm test`, and `pnpm run build`. Run `pnpm audit` to
check the locked dependency graph.

## Deployment (GitHub Pages)

The site is automatically deployed to GitHub Pages on pushes to `main` using the workflow in `.github/workflows/deploy.yml`.

Build output: `dist/` (Vite). The build has separate `index.html` and `404.html`
entries with base-aware asset URLs. GitHub Pages serves the dedicated recovery
document for unknown paths without loading the workbench, editor, or CRD bundles.
Its home link respects the configured base path, including project Pages
deployments. The development and preview servers use the same missing-page
document and HTTP 404 status. No index-to-404 copy step is needed.

Manual trigger:

```bash
pnpm deploy
```

If you fork the repo:

1. Enable Pages: Settings -> Pages -> Source: GitHub Actions
2. Ensure the repository name matches the `REPO` constant in `vite.config.ts` (used to set the base path). If you change it, update that constant accordingly.
3. Push to `main` or run the workflow manually.

## License

[MIT](LICENSE.md)
