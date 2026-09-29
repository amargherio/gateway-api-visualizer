import { Ajv, type AnySchema } from 'ajv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadBundleMock } = vi.hoisted(() => ({ loadBundleMock: vi.fn() }));

vi.mock('./gatewayApiBundle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gatewayApiBundle.js')>();
  loadBundleMock.mockImplementation(actual.loadApiBundleFromDisk);
  return { ...actual, loadApiBundleFromDisk: loadBundleMock };
});

import { buildApiApp } from './app.js';
import { analyzeRequestSchema, analyzeResponseSchema, apiErrorSchema } from './contracts.js';
import { loadApiBundleFromDisk } from './gatewayApiBundle.js';
import { classifyResources } from '../src/lib/manifestAnalysis.js';
import { buildFullGraph } from '../src/lib/shared.js';

const apps: ReturnType<typeof buildApiApp>[] = [];

function resource(kind: string, apiVersion = 'gateway.networking.k8s.io/v1'): Record<string, unknown> {
  return { apiVersion, kind, metadata: { name: `${kind.toLowerCase()}-example` }, spec: {} };
}

async function inject(payload: unknown, headers = { 'content-type': 'application/json' }) {
  const app = buildApiApp();
  apps.push(app);
  const serializedPayload = typeof payload === 'string' ? payload : JSON.stringify(payload) ?? 'null';
  return await app.inject({ method: 'POST', url: '/api/analyze', headers, payload: serializedPayload });
}

function parseJson(response: { body: string }): unknown {
  return JSON.parse(response.body);
}

function nestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`OpenAPI document is missing ${path.join('.')}.`);
    }
    const record = current as Record<string, unknown>;
    current = record[segment];
  }
  return current;
}

function documentSchema(document: unknown, path: string[]): AnySchema {
  const schema = nestedValue(document, path);
  if (!schema || typeof schema !== 'object') throw new Error(`OpenAPI schema at ${path.join('.')} is invalid.`);
  return schema as AnySchema;
}

function compatibilityMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('compatibilityDiagnostics' in payload)) return [];
  const diagnostics = payload.compatibilityDiagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((diagnostic) =>
    diagnostic && typeof diagnostic === 'object' && 'message' in diagnostic && typeof diagnostic.message === 'string'
      ? [diagnostic.message]
      : [],
  );
}

function isServedDiagnostic(message: string): boolean {
  return message.includes('is not served by release');
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('./gatewayApiBundle.js')>('./gatewayApiBundle.js');
  loadBundleMock.mockReset();
  loadBundleMock.mockImplementation(actual.loadApiBundleFromDisk);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Gateway API analysis service', () => {
  it.each([
    ['1.3', 'v1.3.0'],
    ['1.4', 'v1.4.1'],
    ['1.5', 'v1.5.1'],
    ['1.6', 'v1.6.2'],
  ])('returns release support and an empty graph for %s', async (gatewayApiVersion, releaseTag) => {
    const response = await inject({ gatewayApiVersion, resources: [] });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      gatewayApiVersion,
      releaseTag,
      resourceDiagnostics: [],
      compatibilityDiagnostics: [],
      secretDetection: null,
      graph: { nodes: [], edges: [], routeCoverage: [] },
    });
  });

  it('matches shared classification and full graph construction', async () => {
    const resources = [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'GatewayClass',
        metadata: { name: 'example' },
        spec: { controllerName: 'example.net/gateway-controller' },
      },
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name: 'gateway', namespace: 'default' },
        spec: {
          gatewayClassName: 'example',
          listeners: [{ name: 'http', port: 80, protocol: 'HTTP' }],
        },
      },
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'HTTPRoute',
        metadata: { name: 'route', namespace: 'default' },
        spec: {
          parentRefs: [{ name: 'gateway', sectionName: 'http' }],
          rules: [{ backendRefs: [{ name: 'service', port: 80 }] }],
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'service', namespace: 'default' },
        spec: { ports: [{ port: 80 }] },
      },
    ];
    const classification = classifyResources(resources);
    const expectedGraph = buildFullGraph({
      gateways: classification.categorized.gateways,
      routes: classification.categorized.routes,
      services: classification.categorized.services,
      deployments: classification.categorized.deployments,
      statefulSets: classification.categorized.statefulSets,
      daemonSets: classification.categorized.daemonSets,
      gatewayClasses: classification.categorized.gatewayClasses,
      referenceGrants: classification.categorized.referenceGrants,
    });

    const response = await inject({ gatewayApiVersion: '1.6', resources });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      resourceDiagnostics: classification.diagnostics,
      graph: JSON.parse(JSON.stringify(expectedGraph)),
    });
    expect(body).toHaveProperty('graph.nodes', expect.arrayContaining([
      expect.objectContaining({ id: 'route:default/route', data: { kind: 'HTTPRoute' } }),
    ]));
    expect(body).toHaveProperty('graph.edges', expect.arrayContaining([
      expect.objectContaining({ type: 'backend', data: { crossNamespace: false, granted: true } }),
    ]));
  });

  it('categorizes every graph resource kind without omitting a structurally valid graph', async () => {
    const resources = [
      resource('GatewayClass'),
      resource('Gateway'),
      resource('HTTPRoute'),
      resource('TLSRoute'),
      resource('TCPRoute'),
      resource('GRPCRoute'),
      resource('ReferenceGrant'),
      { apiVersion: 'v1', kind: 'Service', metadata: { name: 'service' }, spec: {} },
      { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'deployment' }, spec: {} },
      { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'statefulset' }, spec: {} },
      { apiVersion: 'apps/v1', kind: 'DaemonSet', metadata: { name: 'daemonset' }, spec: {} },
    ];

    const response = await inject({ gatewayApiVersion: '1.6', resources });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ resourceDiagnostics: [] });
    expect(body).toHaveProperty('graph.nodes');
  });

  it('returns structural diagnostics and no graph, while keeping compatibility results advisory', async () => {
    const response = await inject({
      gatewayApiVersion: '1.6',
      resources: [{ apiVersion: 'gateway.networking.k8s.io/v1', kind: 'Gateway', metadata: {} }],
    });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ graph: null });
    expect(body).toHaveProperty('resourceDiagnostics.0.resourceIndex', 0);
    expect(body).toHaveProperty('resourceDiagnostics.0.path');
  });

  it('ignores unknown non-Gateway kinds and reports unknown Gateway kinds as incompatible', async () => {
    const response = await inject({
      gatewayApiVersion: '1.6',
      resources: [
        { apiVersion: 'example.io/v1', kind: 'Unknown', metadata: { name: 'ignored' } },
        resource('UnknownGatewayKind'),
      ],
    });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(compatibilityMessages(body).filter(isServedDiagnostic)).toHaveLength(1);
  });

  it('enforces CRD served-version boundaries independently of generated schema conditionals', async () => {
    const tcpAlpha = resource('TCPRoute', 'gateway.networking.k8s.io/v1alpha2');
    const tcpV1 = resource('TCPRoute', 'gateway.networking.k8s.io/v1');
    const tlsV1 = resource('TLSRoute', 'gateway.networking.k8s.io/v1');

    const results = await Promise.all([
      inject({ gatewayApiVersion: '1.3', resources: [tcpAlpha] }),
      inject({ gatewayApiVersion: '1.5', resources: [tcpAlpha] }),
      inject({ gatewayApiVersion: '1.6', resources: [tcpAlpha] }),
      inject({ gatewayApiVersion: '1.5', resources: [tcpV1] }),
      inject({ gatewayApiVersion: '1.6', resources: [tcpV1] }),
      inject({ gatewayApiVersion: '1.4', resources: [tlsV1] }),
      inject({ gatewayApiVersion: '1.5', resources: [tlsV1] }),
    ]);
    const bodies = results.map(parseJson).map(compatibilityMessages).map((messages) => messages.some(isServedDiagnostic));

    expect(bodies).toEqual([false, false, false, true, false, true, false]);
    expect(results[3].json().compatibilityDiagnostics).toHaveLength(1);
    expect(results[5].json().compatibilityDiagnostics).toHaveLength(1);
  });

  it('validates selected Gateway API schemas and returns JSON Pointer diagnostics', async () => {
    const response = await inject({
      gatewayApiVersion: '1.6',
      resources: [
        {
          apiVersion: 'gateway.networking.k8s.io/v1',
          kind: 'Gateway',
          metadata: { name: 'invalid' },
          spec: { gatewayClassName: 'example', listeners: [{ name: 'http', port: 'not-a-port', protocol: 'HTTP' }] },
        },
      ],
    });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toHaveProperty('compatibilityDiagnostics.0.path');
    expect(JSON.stringify(body)).not.toContain('not-a-port');
  });

  it('returns advisory secret detection without echoing submitted secret values', async () => {
    const secret = 'unrepeatable-secret-value';
    const response = await inject({
      gatewayApiVersion: '1.6',
      resources: [{ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'config' }, data: { password: secret } }],
    });
    const body = parseJson(response);

    expect(response.statusCode).toBe(200);
    expect(body).toHaveProperty('secretDetection.reasons');
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('maps malformed and invalid requests to their documented error envelopes', async () => {
    const malformed = await inject('{', { 'content-type': 'application/json' });
    const unsupported = await inject({ gatewayApiVersion: '9.9', resources: [] });
    const missing = await inject({ resources: [] });
    const nonObject = await inject({ gatewayApiVersion: '1.6', resources: ['not-an-object'] });
    const extra = await inject({ gatewayApiVersion: '1.6', resources: [], unexpected: 'not-in-contract' });
    const coercedVersion = await inject({ gatewayApiVersion: 1.6, resources: [] });

    expect(malformed).toMatchObject({ statusCode: 400 });
    expect(parseJson(malformed)).toMatchObject({ error: { code: 'invalid_json' } });
    expect(parseJson(unsupported)).toMatchObject({ error: { code: 'unsupported_version' } });
    expect(parseJson(missing)).toMatchObject({ error: { code: 'invalid_request' } });
    expect(parseJson(nonObject)).toMatchObject({ error: { code: 'invalid_request' } });
    expect(extra.statusCode).toBe(400);
    expect(parseJson(extra)).toMatchObject({ error: { code: 'invalid_request' } });
    expect(coercedVersion.statusCode).toBe(400);
    expect(parseJson(coercedVersion)).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('rejects unsupported media and oversized payloads', async () => {
    const mediaType = await inject('{"gatewayApiVersion":"1.6","resources":[]}', { 'content-type': 'text/plain' });
    const oversized = await inject(`{"gatewayApiVersion":"1.6","resources":[],"padding":"${'x'.repeat(1024 * 1024)}"}`);

    expect(mediaType.statusCode).toBe(415);
    expect(parseJson(mediaType)).toMatchObject({ error: { code: 'unsupported_media_type' } });
    expect(oversized.statusCode).toBe(413);
    expect(parseJson(oversized)).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('returns only a generic internal error when resource loading fails', async () => {
    loadBundleMock.mockRejectedValueOnce(new Error('sensitive filesystem path /private/manifest.json'));

    const response = await inject({ gatewayApiVersion: '1.6', resources: [] });
    const body = parseJson(response);

    expect(response.statusCode).toBe(500);
    expect(body).toMatchObject({ error: { code: 'internal_error' } });
    expect(JSON.stringify(body)).not.toContain('/private/manifest.json');
  });

  it('returns a JSON error for unknown paths', async () => {
    const app = buildApiApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/missing' });

    expect(response.statusCode).toBe(404);
    expect(parseJson(response)).toMatchObject({ error: { code: 'not_found' } });
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('advertises reusable OpenAPI schemas that accept example and actual response bodies', async () => {
    const app = buildApiApp();
    apps.push(app);
    const schemaResponse = await app.inject({ method: 'GET', url: '/api/schema' });
    const document = parseJson(schemaResponse);

    expect(schemaResponse.statusCode).toBe(200);
    expect(document).toHaveProperty('openapi', '3.1.0');

    const requestSchema = documentSchema(document, ['components', 'schemas', 'AnalyzeRequest']);
    const responseSchema = documentSchema(document, ['components', 'schemas', 'AnalyzeResponse']);
    const errorSchema = documentSchema(document, ['components', 'schemas', 'ApiError']);
    const operationRequestSchema = nestedValue(document, [
      'paths', '/api/analyze', 'post', 'requestBody', 'content', 'application/json', 'schema',
    ]);
    const operationResponseSchema = nestedValue(document, [
      'paths', '/api/analyze', 'post', 'responses', '200', 'content', 'application/json', 'schema',
    ]);
    const documented404Schema = nestedValue(document, [
      'paths', '/api/schema', 'get', 'responses', 'default', 'content', 'application/json', 'schema',
    ]);
    const documentedExample = nestedValue(document, [
      'paths', '/api/analyze', 'post', 'requestBody', 'content', 'application/json', 'examples', 'gateway', 'value',
    ]);

    expect(operationRequestSchema).toEqual(requestSchema);
    expect(operationResponseSchema).toEqual(responseSchema);
    expect(documented404Schema).toEqual(errorSchema);
    expect(requestSchema).toEqual(analyzeRequestSchema);
    expect(responseSchema).toEqual(analyzeResponseSchema);
    expect(errorSchema).toEqual(apiErrorSchema);

    const requestValidator = new Ajv({ strict: false }).compile(requestSchema);
    const responseValidator = new Ajv({ strict: false }).compile(responseSchema);
    const errorValidator = new Ajv({ strict: false }).compile(errorSchema);
    const success = await inject({ gatewayApiVersion: '1.6', resources: [] });
    const malformed = await inject('{', { 'content-type': 'application/json' });
    const unsupported = await inject({ gatewayApiVersion: 'unsupported', resources: [] });
    const missing = await inject({ gatewayApiVersion: '1.6' });
    const mediaType = await inject('{"gatewayApiVersion":"1.6","resources":[]}', { 'content-type': 'text/plain' });
    const oversized = await inject(`{"gatewayApiVersion":"1.6","resources":[],"padding":"${'x'.repeat(1024 * 1024)}"}`);
    const missingRoute = await app.inject({ method: 'GET', url: '/api/missing' });

    expect(requestValidator(documentedExample)).toBe(true);
    expect(responseValidator(parseJson(success))).toBe(true);
    for (const errorResponse of [malformed, unsupported, missing, mediaType, oversized, missingRoute]) {
      expect(errorValidator(parseJson(errorResponse))).toBe(true);
    }
  });

  it('loads each checked-in bundle from disk', async () => {
    await expect(loadApiBundleFromDisk('1.3')).resolves.toMatchObject({ id: '1.3', tag: 'v1.3.0' });
    await expect(loadApiBundleFromDisk('1.4')).resolves.toMatchObject({ id: '1.4', tag: 'v1.4.1' });
    await expect(loadApiBundleFromDisk('1.5')).resolves.toMatchObject({ id: '1.5', tag: 'v1.5.1' });
    await expect(loadApiBundleFromDisk('1.6')).resolves.toMatchObject({ id: '1.6', tag: 'v1.6.2' });
  });
});
