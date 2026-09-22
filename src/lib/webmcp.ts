import type { GatewayApiVersion } from './gatewayApi.js';

export type GraphKindFilter = 'ALL' | 'HTTPRoute' | 'TLSRoute' | 'TCPRoute' | 'GRPCRoute';
export type GraphCoverageFilter = 'ALL' | 'COVERED' | 'UNCOVERED';
export type GraphLayout = 'breadthfirst' | 'grid' | 'circle' | 'concentric' | 'cose';

export interface ManifestAuditProposal {
  manifest: string;
  version: GatewayApiVersion;
}

export interface ResourceQuery {
  search?: string;
  kind?: GraphKindFilter;
  parentRefs?: GraphCoverageFilter;
}

export interface GraphViewInput extends ResourceQuery {
  layout?: GraphLayout;
}

export interface GatewayApiToolHost {
  getAuditReport(): unknown;
  queryResources(input: ResourceQuery): unknown;
  proposeManifestAudit(input: ManifestAuditProposal, signal?: AbortSignal): Promise<unknown>;
  setGraphView(input: GraphViewInput): unknown;
  inspectResource(id: string): unknown;
}

export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
    consequentialHint: boolean;
  };
  execute(input?: unknown, options?: { signal?: AbortSignal }): unknown | Promise<unknown>;
}

export interface WebMcpRegistration {
  supported: boolean;
  ready: Promise<void>;
  dispose(): void;
}

const VERSION_VALUES = ['1.3', '1.4', '1.5', '1.6'] as const;
const KIND_VALUES = ['ALL', 'HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'] as const;
const COVERAGE_VALUES = ['ALL', 'COVERED', 'UNCOVERED'] as const;
const LAYOUT_VALUES = ['breadthfirst', 'grid', 'circle', 'concentric', 'cose'] as const;

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool input must be an object.');
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${name} must be one of: ${values.join(', ')}.`);
  }
  return value as T;
}

function resourceQuery(value: unknown): ResourceQuery {
  const input = objectInput(value ?? {});
  return {
    search: optionalString(input.search, 'search'),
    kind: input.kind === undefined ? undefined : enumValue(input.kind, KIND_VALUES, 'kind'),
    parentRefs:
      input.parentRefs === undefined
        ? undefined
        : enumValue(input.parentRefs, COVERAGE_VALUES, 'parentRefs'),
  };
}

export function createGatewayApiTools(host: GatewayApiToolHost): WebMcpTool[] {
  return [
    {
      name: 'get_gateway_audit',
      title: 'Get Gateway API audit',
      description:
        'Returns the active Gateway API release, CRD compatibility findings, supported features, resource counts, route coverage, and current graph view.',
      inputSchema: { type: 'object', properties: {} },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
        consequentialHint: false,
      },
      execute: () => host.getAuditReport(),
    },
    {
      name: 'query_gateway_resources',
      title: 'Query Gateway resources',
      description:
        'Returns resources and route coverage from the current local manifest, optionally filtered by text, route kind, or parent-reference state.',
      inputSchema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Optional case-insensitive resource name or namespace text.',
          },
          kind: {
            type: 'string',
            enum: KIND_VALUES,
            description: 'Optional route-kind filter. ALL also returns non-route resources.',
          },
          parentRefs: {
            type: 'string',
            enum: COVERAGE_VALUES,
            description: 'Optional filter for routes with or without a parent reference.',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
        consequentialHint: false,
      },
      execute: (input) => host.queryResources(resourceQuery(input)),
    },
    {
      name: 'propose_manifest_audit',
      title: 'Propose manifest audit',
      description:
        'Stages a local Kubernetes manifest and Gateway API release for visible user review. The current editor is unchanged until the user selects Apply.',
      inputSchema: {
        type: 'object',
        properties: {
          manifest: {
            type: 'string',
            description: 'Complete Kubernetes YAML or JSON manifest to review in the local editor.',
          },
          version: {
            type: 'string',
            enum: VERSION_VALUES,
            description: 'Gateway API release used for CRD compatibility analysis.',
          },
        },
        required: ['manifest', 'version'],
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
        consequentialHint: true,
      },
      execute: (value, options) => {
        const input = objectInput(value);
        const manifest = optionalString(input.manifest, 'manifest');
        if (manifest === undefined || manifest.trim().length === 0) {
          throw new Error('manifest must contain Kubernetes YAML or JSON.');
        }
        return host.proposeManifestAudit(
          {
            manifest,
            version: enumValue(input.version, VERSION_VALUES, 'version'),
          },
          options?.signal,
        );
      },
    },
    {
      name: 'set_graph_view',
      title: 'Set graph view',
      description:
        'Updates the visible relationship graph search, route-kind filter, parent-reference filter, and layout without changing the manifest.',
      inputSchema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Optional case-insensitive resource name or namespace text.',
          },
          kind: { type: 'string', enum: KIND_VALUES, description: 'Route-kind filter.' },
          parentRefs: {
            type: 'string',
            enum: COVERAGE_VALUES,
            description: 'Route parent-reference filter.',
          },
          layout: {
            type: 'string',
            enum: LAYOUT_VALUES,
            description: 'Relationship graph layout algorithm.',
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
        consequentialHint: false,
      },
      execute: (value) => {
        const input = objectInput(value ?? {});
        return host.setGraphView({
          ...resourceQuery(input),
          layout:
            input.layout === undefined
              ? undefined
              : enumValue(input.layout, LAYOUT_VALUES, 'layout'),
        });
      },
    },
    {
      name: 'inspect_gateway_resource',
      title: 'Inspect Gateway resource',
      description:
        'Selects one resource in the visible workbench and returns its current graph, coverage, and original manifest details.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Exact resource ID returned by query_gateway_resources.',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
        consequentialHint: false,
      },
      execute: (value) => {
        const input = objectInput(value);
        const id = optionalString(input.id, 'id');
        if (!id) throw new Error('id is required.');
        return host.inspectResource(id);
      },
    },
  ];
}

export function registerGatewayApiTools(host: GatewayApiToolHost): WebMcpRegistration {
  const controller = new AbortController();
  const modelContext = document.modelContext;
  if (!modelContext?.registerTool) {
    return { supported: false, ready: Promise.resolve(), dispose: () => controller.abort() };
  }

  const ready = Promise.all(
    createGatewayApiTools(host).map((tool) =>
      modelContext.registerTool(tool, { signal: controller.signal }),
    ),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      controller.abort(error);
      throw error;
    });

  return {
    supported: true,
    ready,
    dispose: () => controller.abort(),
  };
}
