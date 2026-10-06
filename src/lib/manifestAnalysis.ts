import type {
  AnyRoute,
  DaemonSet,
  Deployment,
  Gateway,
  GatewayClass,
  ReferenceGrant,
  Service,
  StatefulSet,
} from './shared.js';

export interface ResourceDiagnostic {
  resourceIndex: number;
  path: string;
  message: string;
}

export interface CategorizedResources {
  gateways: Gateway[];
  routes: AnyRoute[];
  services: Service[];
  deployments: Deployment[];
  statefulSets: StatefulSet[];
  daemonSets: DaemonSet[];
  gatewayClasses: GatewayClass[];
  referenceGrants: ReferenceGrant[];
}

export interface ResourceClassification {
  categorized: CategorizedResources;
  diagnostics: ResourceDiagnostic[];
}

const GATEWAY_API_GROUPS = new Set([
  'gateway.networking.k8s.io',
  'gateway.networking.x-k8s.io',
]);

const ROUTE_KINDS = new Set(['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute']);
const GATEWAY_API_SPEC_KINDS = new Set(['Gateway', ...ROUTE_KINDS]);

function createCategorizedResources(): CategorizedResources {
  return {
    gateways: [],
    routes: [],
    services: [],
    deployments: [],
    statefulSets: [],
    daemonSets: [],
    gatewayClasses: [],
    referenceGrants: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function routingDiagnostic(
  spec: Record<string, unknown>,
  kind: string,
  resourceIndex: number,
): ResourceDiagnostic | null {
  const issue = (path: string, message: string): ResourceDiagnostic => ({
    resourceIndex, path: `/resources/${resourceIndex}/spec/${path}`, message,
  });
  const strings = (value: Record<string, unknown>, fields: string[], path: string) => {
    for (const field of fields) {
      if (value[field] !== undefined && typeof value[field] !== 'string') {
        return issue(`${path}${field}`, `${field} must be a string.`);
      }
    }
    return null;
  };
  const array = (value: unknown, path: string): ResourceDiagnostic | null =>
    value !== undefined && !Array.isArray(value) ? issue(path, `${path} must be an array.`) : null;

  if (spec.hostnames !== undefined) {
    if (!Array.isArray(spec.hostnames)) return issue('hostnames', 'hostnames must be an array of strings.');
    for (const [index, hostname] of spec.hostnames.entries()) {
      if (typeof hostname !== 'string') return issue(`hostnames/${index}`, 'Hostname must be a string.');
    }
  }
  if (kind === 'Gateway') {
    const invalid = array(spec.listeners, 'listeners');
    if (invalid) return invalid;
    for (const [index, listener] of (Array.isArray(spec.listeners) ? spec.listeners : []).entries()) {
      if (!isRecord(listener)) return issue(`listeners/${index}`, 'Listener must be an object.');
      const invalidHostname = strings(listener, ['hostname'], `listeners/${index}/`);
      if (invalidHostname) return invalidHostname;
    }
    return null;
  }
  const invalidParents = array(spec.parentRefs, 'parentRefs');
  if (invalidParents) return invalidParents;
  for (const [index, parent] of (Array.isArray(spec.parentRefs) ? spec.parentRefs : []).entries()) {
    if (!isRecord(parent)) return issue(`parentRefs/${index}`, 'Parent reference must be an object.');
    const invalid = strings(parent, ['name', 'namespace', 'sectionName', 'kind', 'group'], `parentRefs/${index}/`);
    if (invalid) return invalid;
    if (parent.port !== undefined && typeof parent.port !== 'number') return issue(`parentRefs/${index}/port`, 'Parent port must be a number.');
  }
  const invalidRules = array(spec.rules, 'rules');
  if (invalidRules) return invalidRules;
  for (const [ruleIndex, rule] of (Array.isArray(spec.rules) ? spec.rules : []).entries()) {
    const rulePath = `rules/${ruleIndex}`;
    if (!isRecord(rule)) return issue(rulePath, 'Rule must be an object.');
    if (!['HTTPRoute', 'GRPCRoute'].includes(kind)) continue;
    const invalidMatches = array(rule.matches, `${rulePath}/matches`);
    if (invalidMatches) return invalidMatches;
    for (const [matchIndex, match] of (Array.isArray(rule.matches) ? rule.matches : []).entries()) {
      const matchPath = `${rulePath}/matches/${matchIndex}`;
      if (!isRecord(match)) return issue(matchPath, 'Match must be an object.');
      if (kind === 'HTTPRoute') {
        const invalidMethod = strings(match, ['method'], `${matchPath}/`);
        if (invalidMethod) return invalidMethod;
      }
      const objectField = kind === 'HTTPRoute' ? 'path' : 'method';
      if (match[objectField] !== undefined) {
        const field = match[objectField];
        if (!isRecord(field)) return issue(`${matchPath}/${objectField}`, `${objectField} must be an object.`);
        const invalid = strings(field, objectField === 'path' ? ['type', 'value'] : ['type', 'service', 'method'], `${matchPath}/${objectField}/`);
        if (invalid) return invalid;
      }
      for (const field of kind === 'HTTPRoute' ? ['headers', 'queryParams'] : ['headers']) {
        const path = `${matchPath}/${field}`;
        const invalid = array(match[field], path);
        if (invalid) return invalid;
        for (const [index, entry] of (Array.isArray(match[field]) ? match[field] : []).entries()) {
          if (!isRecord(entry)) return issue(`${path}/${index}`, `${field} match must be an object.`);
          if (typeof entry.name !== 'string' || typeof entry.value !== 'string') {
            return issue(`${path}/${index}`, `${field} match name and value must be strings.`);
          }
          const invalidType = strings(entry, ['type'], `${path}/${index}/`);
          if (invalidType) return invalidType;
        }
      }
    }
  }
  return null;
}

export function isGatewayApiObject(object: Record<string, unknown>): boolean {
  const apiVersion = typeof object.apiVersion === 'string' ? object.apiVersion : '';
  return GATEWAY_API_GROUPS.has(apiVersion.split('/')[0]);
}

function validateResource(
  resource: unknown,
  resourceIndex: number,
): ResourceDiagnostic | null {
  const rootPath = `/resources/${resourceIndex}`;
  if (!isRecord(resource) || !resource.apiVersion) {
    return {
      resourceIndex,
      path: `${rootPath}/apiVersion`,
      message: 'Missing required field: apiVersion',
    };
  }
  if (!resource.kind) {
    return {
      resourceIndex,
      path: `${rootPath}/kind`,
      message: 'Missing required field: kind',
    };
  }

  const metadata = resource.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name) {
    return {
      resourceIndex,
      path: `${rootPath}/metadata/name`,
      message: 'Missing required field: metadata.name',
    };
  }

  if (
    isGatewayApiObject(resource)
    && GATEWAY_API_SPEC_KINDS.has(String(resource.kind))
    && !resource.spec
  ) {
    return {
      resourceIndex,
      path: `${rootPath}/spec`,
      message: `${String(resource.kind)} missing required field: spec`,
    };
  }

  if (isGatewayApiObject(resource) && GATEWAY_API_SPEC_KINDS.has(String(resource.kind))) {
    if (!isRecord(resource.spec)) {
      return { resourceIndex, path: `${rootPath}/spec`, message: 'spec must be an object.' };
    }
    return routingDiagnostic(resource.spec, String(resource.kind), resourceIndex);
  }

  return null;
}

function categorizeResource(
  resource: Record<string, unknown>,
  categorized: CategorizedResources,
): void {
  if (isGatewayApiObject(resource)) {
    switch (resource.kind) {
      case 'Gateway':
        categorized.gateways.push(resource as unknown as Gateway);
        break;
      case 'HTTPRoute':
      case 'TLSRoute':
      case 'TCPRoute':
      case 'GRPCRoute':
        categorized.routes.push(resource as unknown as AnyRoute);
        break;
      case 'GatewayClass':
        categorized.gatewayClasses.push(resource as unknown as GatewayClass);
        break;
      case 'ReferenceGrant':
        categorized.referenceGrants.push(resource as unknown as ReferenceGrant);
        break;
    }
    return;
  }

  switch (resource.kind) {
    case 'Service':
      categorized.services.push(resource as unknown as Service);
      break;
    case 'Deployment':
      categorized.deployments.push(resource as unknown as Deployment);
      break;
    case 'StatefulSet':
      categorized.statefulSets.push(resource as unknown as StatefulSet);
      break;
    case 'DaemonSet':
      categorized.daemonSets.push(resource as unknown as DaemonSet);
      break;
  }
}

export function classifyResources(resources: unknown[]): ResourceClassification {
  const categorized = createCategorizedResources();
  const diagnostics: ResourceDiagnostic[] = [];

  resources.forEach((resource, resourceIndex) => {
    const diagnostic = validateResource(resource, resourceIndex);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      return;
    }

    categorizeResource(resource as Record<string, unknown>, categorized);
  });

  return { categorized, diagnostics };
}
