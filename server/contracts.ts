import { gatewayApiReleases } from '../src/lib/gatewayApi.js';

export type ApiErrorCode =
  | 'invalid_json'
  | 'invalid_request'
  | 'unsupported_version'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'not_found'
  | 'internal_error';

export interface AnalyzeRequest {
  gatewayApiVersion: (typeof gatewayApiReleases)[number]['id'];
  resources: Record<string, unknown>[];
}

const gatewayApiVersions = gatewayApiReleases.map((release) => release.id);

const jsonPointerPathSchema = { type: 'string', pattern: '^/' };
const objectDataSchema = { type: 'object', additionalProperties: true };

const resourceDiagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['resourceIndex', 'path', 'message'],
  properties: {
    resourceIndex: { type: 'integer', minimum: 0 },
    path: jsonPointerPathSchema,
    message: { type: 'string' },
  },
};

const compatibilityDiagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['resourceIndex', 'path', 'severity', 'message'],
  properties: {
    resourceIndex: { type: 'integer', minimum: 0 },
    path: jsonPointerPathSchema,
    severity: { const: 'error' },
    message: { type: 'string' },
  },
};

const graphNodeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'label'],
  properties: {
    id: { type: 'string' },
    type: {
      enum: ['gateway', 'listener', 'route', 'gatewayclass', 'service', 'workload', 'referencegrant'],
    },
    label: { type: 'string' },
    data: objectDataSchema,
  },
};

const graphEdgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'source', 'target', 'type'],
  properties: {
    id: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    type: { enum: ['owns', 'routes', 'class-of', 'backend', 'serves', 'grant'] },
    data: objectDataSchema,
  },
};

const routeCoverageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'namespace', 'covered', 'parentRefs', 'kind'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    namespace: { type: 'string' },
    covered: { type: 'boolean' },
    parentRefs: { type: 'array', items: { type: 'string' } },
    missingParentRefs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'namespace'],
        properties: { name: { type: 'string' }, namespace: { type: 'string' } },
      },
    },
    kind: { type: 'string' },
    backendRefs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'service', 'namespace', 'resolved', 'crossNamespace', 'granted'],
        properties: {
          id: { type: 'string' },
          service: { type: 'string' },
          namespace: { type: 'string' },
          resolved: { type: 'boolean' },
          crossNamespace: { type: 'boolean' },
          granted: { type: 'boolean' },
        },
      },
    },
    missingBackends: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'namespace'],
        properties: { name: { type: 'string' }, namespace: { type: 'string' } },
      },
    },
  },
};

const graphSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nodes', 'edges', 'summary', 'routeCoverage'],
  properties: {
    nodes: { type: 'array', items: graphNodeSchema },
    edges: { type: 'array', items: graphEdgeSchema },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['gateways', 'routes', 'coveredRoutes', 'uncoveredRoutes', 'coveragePercent'],
      properties: {
        gateways: { type: 'integer', minimum: 0 },
        routes: { type: 'integer', minimum: 0 },
        coveredRoutes: { type: 'integer', minimum: 0 },
        uncoveredRoutes: { type: 'integer', minimum: 0 },
        coveragePercent: { type: 'number' },
        services: { type: 'integer', minimum: 0 },
        workloads: { type: 'integer', minimum: 0 },
        gatewayClasses: { type: 'integer', minimum: 0 },
        referenceGrants: { type: 'integer', minimum: 0 },
        backendRefs: { type: 'integer', minimum: 0 },
        resolvedBackends: { type: 'integer', minimum: 0 },
        missingBackends: { type: 'integer', minimum: 0 },
      },
    },
    routeCoverage: { type: 'array', items: routeCoverageSchema },
  },
};

export const analyzeRequestSchema = {
  $id: 'https://gateway-api-visualizer.dev/schemas/analyze-request.json',
  type: 'object',
  additionalProperties: false,
  required: ['gatewayApiVersion', 'resources'],
  properties: {
    gatewayApiVersion: { type: 'string', enum: gatewayApiVersions },
    resources: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const;

export const analyzeResponseSchema = {
  $id: 'https://gateway-api-visualizer.dev/schemas/analyze-response.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'gatewayApiVersion',
    'releaseTag',
    'resourceDiagnostics',
    'compatibilityDiagnostics',
    'secretDetection',
    'support',
    'graph',
  ],
  properties: {
    gatewayApiVersion: { type: 'string', enum: gatewayApiVersions },
    releaseTag: { type: 'string' },
    resourceDiagnostics: { type: 'array', items: resourceDiagnosticSchema },
    compatibilityDiagnostics: { type: 'array', items: compatibilityDiagnosticSchema },
    secretDetection: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['reasons'],
          properties: { reasons: { type: 'array', items: { type: 'string' } } },
        },
      ],
    },
    support: {
      type: 'object',
      additionalProperties: false,
      required: ['crds', 'features'],
      properties: {
        crds: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'channel', 'servedVersions'],
            properties: {
              kind: { type: 'string' },
              channel: { enum: ['standard', 'experimental'] },
              servedVersions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        features: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'channel'],
            properties: {
              name: { type: 'string' },
              channel: { enum: ['standard', 'experimental'] },
            },
          },
        },
      },
    },
    graph: { anyOf: [{ type: 'null' }, graphSchema] },
  },
} as const;

export const apiErrorSchema = {
  $id: 'https://gateway-api-visualizer.dev/schemas/api-error.json',
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: {
          enum: [
            'invalid_json',
            'invalid_request',
            'unsupported_version',
            'payload_too_large',
            'unsupported_media_type',
            'not_found',
            'internal_error',
          ],
        },
        message: { type: 'string' },
      },
    },
  },
} as const;

const exampleRequest = {
  gatewayApiVersion: '1.6',
  resources: [
    {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: { name: 'example' },
      spec: {},
    },
  ],
};

const exampleResponse = {
  gatewayApiVersion: '1.6',
  releaseTag: 'v1.6.2',
  resourceDiagnostics: [],
  compatibilityDiagnostics: [],
  secretDetection: null,
  support: { crds: [], features: [] },
  graph: {
    nodes: [],
    edges: [],
    summary: { gateways: 0, routes: 0, coveredRoutes: 0, uncoveredRoutes: 0, coveragePercent: 0 },
    routeCoverage: [],
  },
};

const exampleError = { error: { code: 'invalid_request', message: 'Request body does not match the API contract.' } };

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Gateway API Visualizer analysis API',
    version: '1.0.0',
    description: 'Analyze submitted Kubernetes Gateway API resources without storing their contents.',
  },
  paths: {
    '/api/analyze': {
      post: {
        summary: 'Analyze Gateway API resources against a selected release',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: analyzeRequestSchema, examples: { gateway: { value: exampleRequest } } },
          },
        },
        responses: {
          '200': {
            description: 'Analysis completed',
            content: {
              'application/json': { schema: analyzeResponseSchema, examples: { analysis: { value: exampleResponse } } },
            },
          },
          '400': {
            description: 'Malformed JSON, invalid request, or unsupported Gateway API release',
            content: {
              'application/json': { schema: apiErrorSchema, examples: { invalidRequest: { value: exampleError } } },
            },
          },
          '413': {
            description: 'Request body exceeds 1 MiB',
            content: { 'application/json': { schema: apiErrorSchema } },
          },
          '415': {
            description: 'Request content type is not JSON',
            content: { 'application/json': { schema: apiErrorSchema } },
          },
          '500': {
            description: 'Unexpected server error',
            content: { 'application/json': { schema: apiErrorSchema } },
          },
          default: {
            description: 'Documented API error envelope',
            content: { 'application/json': { schema: apiErrorSchema } },
          },
        },
      },
    },
    '/api/schema': {
      get: {
        summary: 'Get this OpenAPI document',
        responses: {
          '200': { description: 'OpenAPI 3.1 document' },
          default: {
            description: 'Documented API error envelope, including unknown API paths',
            content: { 'application/json': { schema: apiErrorSchema } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      AnalyzeRequest: analyzeRequestSchema,
      AnalyzeResponse: analyzeResponseSchema,
      ApiError: apiErrorSchema,
    },
  },
} as const;
