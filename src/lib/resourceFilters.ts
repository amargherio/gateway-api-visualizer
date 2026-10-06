import type { CoverageGraph, RouteCoverageDetail } from './shared.js';

export interface ResourceFilters {
  search?: string;
  hostname?: string;
  hostnameScope?: 'ROUTE' | 'LISTENER' | 'ALL';
  routeMatch?: string;
  kind?: 'ALL' | 'HTTPRoute' | 'TLSRoute' | 'TCPRoute' | 'GRPCRoute';
  parentRefs?: 'ALL' | 'COVERED' | 'UNCOVERED';
}

function includesText(values: string[], query = ''): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || values.some((value) => value.toLowerCase().includes(normalized));
}

export function matchesRouteFilters(route: RouteCoverageDetail, filters: ResourceFilters): boolean {
  if (filters.kind && filters.kind !== 'ALL' && route.kind !== filters.kind) return false;
  if (filters.parentRefs === 'COVERED' && !route.covered) return false;
  if (filters.parentRefs === 'UNCOVERED' && route.covered) return false;
  const hostnames = route.hostnames || [];
  const listenerHostnames = route.listenerHostnames || [];
  const scopedHostnames =
    filters.hostnameScope === 'LISTENER'
      ? listenerHostnames
      : filters.hostnameScope === 'ALL'
        ? [...hostnames, ...listenerHostnames]
        : hostnames;
  const matches = route.matches || [];
  return (
    includesText([route.name, route.namespace, ...scopedHostnames, ...matches], filters.search) &&
    includesText(scopedHostnames, filters.hostname) &&
    includesText(matches, filters.routeMatch)
  );
}

export function filterResourceGraph(
  graph: CoverageGraph,
  filters: ResourceFilters = {},
): CoverageGraph {
  const routeCoverage = graph.routeCoverage.filter((route) => matchesRouteFilters(route, filters));
  const routeIds = new Set(routeCoverage.map((route) => route.id));
  const contextIds = new Set(routeIds);
  const hostnameActive = Boolean(filters.hostname?.trim());
  const hostnamesById = new Map(
    graph.nodes.map((node) => {
      const values = node.data?.hostnames;
      return [
        node.id,
        Array.isArray(values)
          ? values.filter((value): value is string => typeof value === 'string')
          : [],
      ] as const;
    }),
  );
  const nodeHostnames = (id: string): string[] => {
    return hostnamesById.get(id) || [];
  };
  if (hostnameActive && (!filters.kind || filters.kind === 'ALL')) {
    if (
      filters.hostnameScope !== 'ROUTE' &&
      filters.hostnameScope !== undefined &&
      !filters.routeMatch?.trim() &&
      (!filters.parentRefs || filters.parentRefs === 'ALL')
    ) {
      for (const node of graph.nodes) {
        if (
          node.type === 'listener' &&
          includesText(nodeHostnames(node.id), filters.hostname) &&
          includesText([node.label, ...nodeHostnames(node.id)], filters.search)
        )
          contextIds.add(node.id);
      }
    }
    const neighbors = new Map<string, string[]>();
    const add = (source: string, target: string) => {
      const targets = neighbors.get(source) || [];
      targets.push(target);
      neighbors.set(source, targets);
    };
    for (const edge of graph.edges) {
      if (edge.type === 'owns') {
        add(edge.target, edge.source);
        if (
          !filters.hostnameScope ||
          filters.hostnameScope === 'ROUTE' ||
          includesText(nodeHostnames(edge.target), filters.hostname)
        )
          add(edge.source, edge.target);
      } else {
        add(edge.source, edge.target);
      }
    }
    const pending = [...contextIds];
    for (let index = 0; index < pending.length; index++) {
      for (const target of neighbors.get(pending[index]) || []) {
        if (!contextIds.has(target)) {
          contextIds.add(target);
          pending.push(target);
        }
      }
    }
  }
  const nodes = graph.nodes.filter((node) =>
    node.type === 'route'
      ? routeIds.has(node.id)
      : (!filters.kind || filters.kind === 'ALL') && (!hostnameActive || contextIds.has(node.id)),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { ...graph, nodes, edges, routeCoverage };
}
