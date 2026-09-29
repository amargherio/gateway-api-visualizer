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
