// Consolidated former @gav/shared exports
/** Gateway API core resource */
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

/** GatewayClass resource */
export interface GatewayClass {
  apiVersion: string;
  kind: 'GatewayClass';
  metadata: { name: string };
  spec?: Record<string, unknown>;
}

export interface BackendRef {
  kind?: string; // Service by default
  name: string;
  namespace?: string; // may differ from route ns
  port?: number;
  weight?: number;
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
      backendRefs?: BackendRef[]; // standard
      // Accept legacy forwardTo forms by treating unknown keys leniently
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
    rules?: Array<{ backendRefs?: BackendRef[] }>;
  };
}

export interface TCPRoute {
  apiVersion: string;
  kind: 'TCPRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string; kind?: string }>;
    rules?: Array<{ backendRefs?: BackendRef[] }>;
  };
}

export interface GRPCRoute {
  apiVersion: string;
  kind: 'GRPCRoute';
  metadata: { name: string; namespace?: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string; kind?: string }>;
    hostnames?: string[];
    rules?: Array<{ backendRefs?: BackendRef[] }>;
  };
}

/** ReferenceGrant allows cross-namespace references */
export interface ReferenceGrant {
  apiVersion: string;
  kind: 'ReferenceGrant';
  metadata: { name: string; namespace: string };
  spec: {
    from: Array<{ group: string; kind: string; namespace: string }>;
    to: Array<{ group: string; kind: string; name?: string }>; // name optional means any
  };
}

export interface ServicePort { name?: string; port: number; targetPort?: number | string; protocol?: string }
export interface Service {
  apiVersion: string;
  kind: 'Service';
  metadata: { name: string; namespace?: string };
  spec: {
    selector?: Record<string, string>;
    ports?: ServicePort[];
    type?: string;
  };
}

export interface PodTemplateSpec { metadata?: { labels?: Record<string,string> }; spec?: Record<string, unknown> }
export interface Deployment {
  apiVersion: string;
  kind: 'Deployment';
  metadata: { name: string; namespace?: string };
  spec: { selector?: { matchLabels?: Record<string,string> }; template?: PodTemplateSpec };
}

export interface StatefulSet {
  apiVersion: string;
  kind: 'StatefulSet';
  metadata: { name: string; namespace?: string };
  spec: { selector?: { matchLabels?: Record<string,string> }; template?: PodTemplateSpec };
}

export interface DaemonSet {
  apiVersion: string;
  kind: 'DaemonSet';
  metadata: { name: string; namespace?: string };
  spec: { selector?: { matchLabels?: Record<string,string> }; template?: PodTemplateSpec };
}

export interface GraphNode {
  id: string;
  type: 'gateway' | 'listener' | 'route' | 'gatewayclass' | 'service' | 'workload' | 'referencegrant';
  label: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'owns' | 'routes' | 'class-of' | 'backend' | 'serves' | 'grant';
  data?: Record<string, unknown>;
}

export interface RouteCoverageDetail {
  id: string; // route:<ns>/<name>
  name: string;
  namespace: string;
  covered: boolean;
  parentRefs: string[]; // gateway / listener ids actually linked
  missingParentRefs?: Array<{ name: string; namespace: string }>; // if specified parentRef gateway not present
  kind: string; // HTTPRoute | TLSRoute | TCPRoute | GRPCRoute
  backendRefs?: Array<{ id: string; service: string; namespace: string; resolved: boolean; crossNamespace: boolean; granted: boolean }>;
  missingBackends?: Array<{ name: string; namespace: string }>;
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
    services?: number;
    workloads?: number;
    gatewayClasses?: number;
    referenceGrants?: number;
    backendRefs?: number;
    resolvedBackends?: number;
    missingBackends?: number;
  };
  routeCoverage: RouteCoverageDetail[];
}

export type AnyRoute = HTTPRoute | TLSRoute | TCPRoute | GRPCRoute;
/** Build a full enriched graph including services/workloads and gateway classes */
export function buildFullGraph(params: {
  gateways: Gateway[];
  routes: AnyRoute[];
  services?: Service[];
  deployments?: Deployment[];
  statefulSets?: StatefulSet[];
  daemonSets?: DaemonSet[];
  gatewayClasses?: GatewayClass[];
  referenceGrants?: ReferenceGrant[];
}): CoverageGraph {
  const { gateways, routes, services = [], deployments = [], statefulSets = [], daemonSets = [], gatewayClasses = [], referenceGrants = [] } = params;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const routeCoverage: RouteCoverageDetail[] = [];

  // Helper maps
  const svcKey = (ns: string, name: string) => `${ns}/${name}`;
  const servicesMap = new Map<string, Service>();
  for (const s of services) servicesMap.set(svcKey(s.metadata.namespace || 'default', s.metadata.name), s);

  const workloads: Array<{ kind: string; name: string; namespace: string; labels?: Record<string,string>; type: 'deployment' | 'statefulset' | 'daemonset' }> = [];
  for (const d of deployments) workloads.push({ kind: 'Deployment', name: d.metadata.name, namespace: d.metadata.namespace || 'default', labels: d.spec.template?.metadata?.labels, type: 'deployment' });
  for (const s of statefulSets) workloads.push({ kind: 'StatefulSet', name: s.metadata.name, namespace: s.metadata.namespace || 'default', labels: s.spec.template?.metadata?.labels, type: 'statefulset' });
  for (const d of daemonSets) workloads.push({ kind: 'DaemonSet', name: d.metadata.name, namespace: d.metadata.namespace || 'default', labels: d.spec.template?.metadata?.labels, type: 'daemonset' });

  // ReferenceGrant lookup: key fromNS->toNS:kind:name(optional)
  function grantAllows(fromNs: string, toNs: string, kind: string, name: string): boolean {
    if (fromNs === toNs) return true; // same namespace no grant required
    return referenceGrants.some(g => {
      if (g.metadata.namespace !== toNs) return false; // grant lives in target namespace
      const toMatch = g.spec.to.some(t => t.kind === kind && (!t.name || t.name === name));
      if (!toMatch) return false;
      return g.spec.from.some(f => f.kind === 'HTTPRoute' || f.kind === kind ? f.namespace === fromNs : f.namespace === fromNs); // simplistic match
    });
  }

  // GatewayClass nodes
  for (const gc of gatewayClasses) {
    const gcId = `gatewayclass:${gc.metadata.name}`;
    nodes.push({ id: gcId, type: 'gatewayclass', label: gc.metadata.name });
  }

  // Gateways & listeners
  for (const gw of gateways) {
    const ns = gw.metadata.namespace || 'default';
    const gwId = `gateway:${ns}/${gw.metadata.name}`;
    nodes.push({ id: gwId, type: 'gateway', label: gw.metadata.name });
    if (gw.spec.gatewayClassName) {
      const gcId = `gatewayclass:${gw.spec.gatewayClassName}`;
      if (!nodes.find(n => n.id === gcId)) {
        nodes.push({ id: gcId, type: 'gatewayclass', label: gw.spec.gatewayClassName });
      }
      edges.push({ id: `${gwId}->${gcId}`, source: gwId, target: gcId, type: 'class-of' });
    }
    for (const listener of gw.spec.listeners || []) {
      const listenerId = `${gwId}:listener:${listener.name || listener.port}`;
      nodes.push({ id: listenerId, type: 'listener', label: listener.name || `${listener.port}` });
      edges.push({ id: `${gwId}->${listenerId}`, source: gwId, target: listenerId, type: 'owns' });
    }
  }

  // Services & match workloads
  for (const s of services) {
    const ns = s.metadata.namespace || 'default';
    const sid = `service:${ns}/${s.metadata.name}`;
    nodes.push({ id: sid, type: 'service', label: s.metadata.name });
    // Link to workloads that match selector
    if (s.spec.selector && Object.keys(s.spec.selector).length > 0) {
      const selector = s.spec.selector;
      // naive match: workload labels must include all selector pairs
      const matched = workloads.filter(w => w.namespace === ns && w.labels && Object.entries(selector).every(([k,v]) => w.labels![k] === v));
      for (const w of matched) {
        const wid = `workload:${w.namespace}/${w.kind.toLowerCase()}:${w.name}`;
        if (!nodes.find(n => n.id === wid)) {
          nodes.push({ id: wid, type: 'workload', label: w.name, data: { kind: w.kind } });
        }
        edges.push({ id: `${sid}->${wid}`, source: sid, target: wid, type: 'serves' });
      }
    }
  }

  let coveredRoutes = 0;
  let totalBackendRefs = 0;
  let resolvedBackends = 0;
  let missingBackends = 0;

  for (const rt of routes) {
    const namespace = rt.metadata.namespace || 'default';
    const rtId = `route:${namespace}/${rt.metadata.name}`;
    nodes.push({ id: rtId, type: 'route', label: rt.metadata.name, data: { kind: rt.kind } });

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

    // Backend refs (HTTPRoute rules[].backendRefs etc.)
    const backendRefs: RouteCoverageDetail['backendRefs'] = [];
    const missingBackendsList: Array<{ name: string; namespace: string }> = [];
    const rules: any[] = (rt as any).spec.rules || [];
    for (const rule of rules) {
      const brs: BackendRef[] = rule.backendRefs || [];
      for (const br of brs) {
        totalBackendRefs++;
        const targetNs = br.namespace || namespace;
        const key = svcKey(targetNs, br.name);
        const svc = servicesMap.get(key);
        const granted = grantAllows(namespace, targetNs, br.kind || 'Service', br.name);
        const id = `service:${targetNs}/${br.name}`;
        if (svc) {
          if (!nodes.find(n => n.id === id)) {
            nodes.push({ id, type: 'service', label: br.name });
          }
          edges.push({ id: `${rtId}->${id}:${backendRefs.length}`, source: rtId, target: id, type: 'backend', data: { crossNamespace: namespace !== targetNs, granted } });
          // Add explicit grant edge if cross-namespace and granted
          if (namespace !== targetNs && granted) {
            const grantId = `grant:${rtId}->${id}`;
            edges.push({ id: grantId, source: rtId, target: id, type: 'grant', data: { crossNamespace: true, granted: true } });
          }
          resolvedBackends++;
        } else {
          missingBackendsList.push({ name: br.name, namespace: targetNs });
          missingBackends++;
        }
        backendRefs.push({ id, service: br.name, namespace: targetNs, resolved: !!svc, crossNamespace: namespace !== targetNs, granted });
      }
    }

    routeCoverage.push({
      id: rtId,
      name: rt.metadata.name,
      namespace,
      covered: isCovered,
      parentRefs: parentRefIds,
      missingParentRefs: missingParentRefs.length ? missingParentRefs : undefined,
      kind: rt.kind,
      backendRefs: backendRefs.length ? backendRefs : undefined,
      missingBackends: missingBackendsList.length ? missingBackendsList : undefined,
    });
  }

  const summary = {
    gateways: gateways.length,
    routes: routes.length,
    coveredRoutes,
    uncoveredRoutes: routes.length - coveredRoutes,
    coveragePercent: routes.length ? (coveredRoutes / routes.length) * 100 : 0,
    services: services.length,
    workloads: workloads.length,
    gatewayClasses: gatewayClasses.length,
    referenceGrants: referenceGrants.length,
    backendRefs: totalBackendRefs,
    resolvedBackends,
    missingBackends,
  };

  return { nodes, edges, summary, routeCoverage };
}

/** Backward compatible wrapper keeping original signature & behavior subset */
export function buildCoverageGraph(gateways: Gateway[], routes: AnyRoute[]): CoverageGraph {
  return buildFullGraph({ gateways, routes });
}
