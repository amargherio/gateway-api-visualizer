# Gateway API Visualizer

Visualize relationships between Kubernetes Gateway API `Gateway` and route resources directly from local YAML you edit in the browser.

## Features

- In‑browser YAML editor (multi‑document supported)
- Parses `Gateway` and Route resources (`HTTPRoute`, `TLSRoute`, `TCPRoute`, `GRPCRoute`)
- Builds a coverage graph: which routes are attached to which gateways/listeners
- Real-time visualization + coverage table as you type
- Light/Dark theme toggle
- Basic test coverage for graph builder logic

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

Install dependencies (requires Node 20+ and pnpm):

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

In the UI you can now use the Insert Sample dropdown to load either dataset directly without leaving the app.

## (Removed) Server Mode

Earlier versions included a backend (REST endpoints + SSE streaming + file watcher). All of that has been removed; the app is now 100% client-side.

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
```

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

## Docker

No longer required (server removed).

## Roadmap / Ideas

- Optional: reintroduce pluggable data sources (cluster watch, file watcher) behind a data provider abstraction
- Export graph as PNG / JSON
- Improved route detail sidebar
- Accessibility enhancements
 
## License

MIT
