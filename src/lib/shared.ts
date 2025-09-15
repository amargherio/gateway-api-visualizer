// Consolidated former @gav/shared exports
export interface Gateway {
  apiVersion: string; // gateway.networking.k8s.io/v1beta1
  kind: 'Gateway';
  metadata: { name: string; namespace?: string };
  spec: {
    gatewayClassName?: string;
    listeners?: Array<{
      name?: string;
      hostname?: string;
      port: number;
      protocol: string;
      allowedRoutes?: { namespaces?: { from?: string } };
    }>;
  };
}

export interface HTTPRoute {
  apiVersion: string; // gateway.networking.k8s.io/v1beta1
  kind: 'HTTPRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{
      name: string;
      namespace?: string;
      sectionName?: string;
      kind?: string;
    }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{
        path?: { type?: string; value?: string };
        method?: string;
        headers?: Array<{ name: string; value: string }>;
      }>;
    }>;
  };
}

export interface TLSRoute {
  apiVersion: string;
  kind: 'TLSRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string; kind?: string }>;
    hostnames?: string[];
    rules?: unknown[];
  };
}

export interface TCPRoute {
  apiVersion: string;
  kind: 'TCPRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string; kind?: string }>;
    rules?: unknown[];
  };
}

export interface GRPCRoute {
  apiVersion: string;
  kind: 'GRPCRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string; kind?: string }>;
    hostnames?: string[];
    rules?: unknown[];
  };
}

export interface GraphNode {
  id: string;
  type: 'gateway' | 'listener' | 'route';
  label: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'owns' | 'routes';
}

export interface RouteCoverageDetail {
  id: string; // route:<ns>/<name>
  name: string;
  namespace: string;
  covered: boolean;
  parentRefs: string[]; // gateway / listener ids actually linked
  missingParentRefs?: Array<{ name: string; namespace: string }>; // if specified parentRef gateway not present
  kind: string; // HTTPRoute | TLSRoute | TCPRoute | GRPCRoute
}

export interface CoverageGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    gateways: number;
    routes: number;
    coveredRoutes: number;
    uncoveredRoutes: number;
    coveragePercent: number;
  };
  routeCoverage: RouteCoverageDetail[];
}

export type AnyRoute = HTTPRoute | TLSRoute | TCPRoute | GRPCRoute;

export function buildCoverageGraph(gateways: Gateway[], routes: AnyRoute[]): CoverageGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const routeCoverage: RouteCoverageDetail[] = [];

  for (const gw of gateways) {
    const gwId = `gateway:${gw.metadata.namespace || 'default'}/${gw.metadata.name}`;
    nodes.push({ id: gwId, type: 'gateway', label: gw.metadata.name });
    for (const listener of gw.spec.listeners || []) {
      const listenerId = `${gwId}:listener:${listener.name || listener.port}`;
      nodes.push({ id: listenerId, type: 'listener', label: listener.name || `${listener.port}` });
      edges.push({ id: `${gwId}->${listenerId}`, source: gwId, target: listenerId, type: 'owns' });
    }
  }

  let coveredRoutes = 0;

  for (const rt of routes) {
    const namespace = rt.metadata.namespace || 'default';
    const rtId = `route:${namespace}/${rt.metadata.name}`;
    nodes.push({ id: rtId, type: 'route', label: rt.metadata.name });

    let isCovered = false;
    const parentRefIds: string[] = [];
    const missingParentRefs: Array<{ name: string; namespace: string }> = [];
    for (const parent of rt.spec.parentRefs || []) {
      const parentNs = parent.namespace || namespace;
      const gwRefId = `gateway:${parentNs}/${parent.name}`;
      const gwExists = gateways.some(gw => (gw.metadata.namespace || 'default') === parentNs && gw.metadata.name === parent.name);
      if (!gwExists) {
        missingParentRefs.push({ name: parent.name, namespace: parentNs });
      }
      let targetId = gwRefId;
      if (parent.sectionName) {
        const listenerId = `${gwRefId}:listener:${parent.sectionName}`;
        if (!nodes.find(n => n.id === listenerId)) {
          nodes.push({ id: listenerId, type: 'listener', label: parent.sectionName });
          edges.push({ id: `${gwRefId}->${listenerId}`, source: gwRefId, target: listenerId, type: 'owns' });
        }
        targetId = listenerId;
      }
      if (!nodes.find(n => n.id === gwRefId)) {
        nodes.push({ id: gwRefId, type: 'gateway', label: parent.name });
      }
      edges.push({ id: `${rtId}->${targetId}`, source: rtId, target: targetId, type: 'routes' });
      parentRefIds.push(targetId);
      isCovered = true;
    }
    if (isCovered) coveredRoutes++;
    routeCoverage.push({
      id: rtId,
      name: rt.metadata.name,
      namespace,
      covered: isCovered,
      parentRefs: parentRefIds,
      missingParentRefs: missingParentRefs.length ? missingParentRefs : undefined,
      kind: rt.kind
    });
  }

  const summary = {
    gateways: gateways.length,
    routes: routes.length,
    coveredRoutes,
    uncoveredRoutes: routes.length - coveredRoutes,
    coveragePercent: routes.length ? (coveredRoutes / routes.length) * 100 : 0
  };

  return { nodes, edges, summary, routeCoverage };
}
