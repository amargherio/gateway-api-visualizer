# Gateway API Visualizer

Visualize relationships between Kubernetes Gateway API `Gateway` and route resources directly from local YAML you edit in the browser.

## Features

- In‑browser YAML editor (multi‑document supported)
- Parses `Gateway` and Route resources (`HTTPRoute`, `TLSRoute`, `TCPRoute`, `GRPCRoute`)
- Builds a coverage graph: which routes are attached to which gateways/listeners
- Real-time visualization + coverage table as you type
- Light/Dark theme toggle
- Basic test coverage for graph builder logic
- Enhanced Route Coverage table:
  - Sort by Namespace or Name (click header toggles asc/desc)
  - Filter by coverage (All / Covered / Uncovered)
  - Search by name or namespace (debounced)
  - Automatic pagination > 20 rows; selectable sizes (20, 50, 100, All)
  - Encapsulated in `RouteCoverageTable.svelte` for reuse & testability
  - Click a row to focus & highlight the corresponding route node in the graph

## Project Layout (flattened)

The project has been fully flattened. All source now resides under `src/` at the repository root. Former workspace packages were consolidated; shared types + coverage graph builder live in `src/lib/shared.ts`.

```text
src/
  App.svelte
  main.ts
  lib/
    shared.ts        # types + graph builder logic
    shared.test.ts   # tests
    YamlEditor.svelte
    Graph.svelte
    ThemeToggle.svelte
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

Build output: `dist/` (Vite). A `404.html` copy is generated post-build for SPA routing fallback.

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
