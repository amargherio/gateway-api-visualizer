# Gateway API Visualizer

Visualize relationships between Kubernetes Gateway API `Gateway` and route resources directly from local YAML you edit in the browser.

## Features

- In‑browser YAML editor (multi‑document supported)
- Parses `Gateway` and Route resources (`HTTPRoute`, `TLSRoute`, `TCPRoute`, `GRPCRoute`)
- Builds a coverage graph: which routes are attached to which gateways/listeners
- Real-time visualization + coverage table as you type
- Light/Dark theme toggle
- Basic test coverage for graph builder logic

## Monorepo Layout (pnpm workspaces)

```text
packages/
  shared   # Shared types + graph builder
  web      # Svelte UI (Vite) + in-browser YAML editor
```

## Getting Started

Install dependencies (requires Node 20+ and pnpm):

```bash
corepack enable # if pnpm not installed
pnpm install
```

Run dev (web UI only):

```bash
pnpm dev
```
 
Web UI runs on :5173. Paste / edit YAML in the left panel and the graph updates instantly.

## Sample YAML

See `data/sample.yaml` for an example with one Gateway and several routes. You can copy its contents into the editor to explore the UI.

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

## Docker

No longer required (server removed).

## Roadmap / Ideas

- Optional: reintroduce pluggable data sources (cluster watch, file watcher) behind a data provider abstraction
- Export graph as PNG / JSON
- Improved route detail sidebar
- Accessibility enhancements

 
## License

MIT
