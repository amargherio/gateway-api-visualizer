import { describe, expect, it } from 'vitest';
import { classifyResources, isGatewayApiObject } from './manifestAnalysis.js';

const GATEWAY_API_VERSION = 'gateway.networking.k8s.io/v1';

function resource(
  kind: string,
  name: string,
  apiVersion = 'v1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiVersion,
    kind,
    metadata: { name },
    ...extra,
  };
}

function gatewayApiResource(kind: string, name: string): Record<string, unknown> {
  return resource(kind, name, GATEWAY_API_VERSION, { spec: {} });
}

describe('isGatewayApiObject', () => {
  it('recognizes both supported Gateway API groups only', () => {
    expect(isGatewayApiObject(resource('Gateway', 'current', GATEWAY_API_VERSION))).toBe(true);
    expect(isGatewayApiObject(resource('Gateway', 'legacy', 'gateway.networking.x-k8s.io/v1alpha2'))).toBe(true);
    expect(isGatewayApiObject(resource('Gateway', 'workload', 'apps/v1'))).toBe(false);
    expect(isGatewayApiObject({ apiVersion: 1, kind: 'Gateway' })).toBe(false);
  });
});

describe('classifyResources', () => {
  it('categorizes every supported Gateway API and workload kind in input order', () => {
    const gateway = gatewayApiResource('Gateway', 'gateway');
    const httpRoute = gatewayApiResource('HTTPRoute', 'http');
    const tlsRoute = gatewayApiResource('TLSRoute', 'tls');
    const tcpRoute = gatewayApiResource('TCPRoute', 'tcp');
    const grpcRoute = gatewayApiResource('GRPCRoute', 'grpc');
    const gatewayClass = gatewayApiResource('GatewayClass', 'class');
    const referenceGrant = gatewayApiResource('ReferenceGrant', 'grant');
    const laterService = resource('Service', 'later-service', 'other.example/v1');
    const firstService = resource('Service', 'first-service', 'other.example/v1');
    const deployment = resource('Deployment', 'deployment', 'other.example/v1');
    const statefulSet = resource('StatefulSet', 'stateful-set', 'other.example/v1');
    const daemonSet = resource('DaemonSet', 'daemon-set', 'other.example/v1');

    const result = classifyResources([
      gateway,
      httpRoute,
      tlsRoute,
      tcpRoute,
      grpcRoute,
      gatewayClass,
      referenceGrant,
      laterService,
      firstService,
      deployment,
      statefulSet,
      daemonSet,
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.categorized.gateways).toEqual([gateway]);
    expect(result.categorized.routes).toEqual([httpRoute, tlsRoute, tcpRoute, grpcRoute]);
    expect(result.categorized.gatewayClasses).toEqual([gatewayClass]);
    expect(result.categorized.referenceGrants).toEqual([referenceGrant]);
    expect(result.categorized.services).toEqual([laterService, firstService]);
    expect(result.categorized.deployments).toEqual([deployment]);
    expect(result.categorized.statefulSets).toEqual([statefulSet]);
    expect(result.categorized.daemonSets).toEqual([daemonSet]);
  });

  it('ignores structurally valid kinds outside the supported categories', () => {
    const result = classifyResources([
      resource('ConfigMap', 'config'),
      gatewayApiResource('UnrecognizedGatewayKind', 'unknown-gateway-kind'),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.categorized).toEqual({
      gateways: [],
      routes: [],
      services: [],
      deployments: [],
      statefulSets: [],
      daemonSets: [],
      gatewayClasses: [],
      referenceGrants: [],
    });
  });

  it('returns an empty categorization for empty input', () => {
    expect(classifyResources([])).toEqual({
      categorized: {
        gateways: [],
        routes: [],
        services: [],
        deployments: [],
        statefulSets: [],
        daemonSets: [],
        gatewayClasses: [],
        referenceGrants: [],
      },
      diagnostics: [],
    });
  });

  it('reports the first existing required-field finding for every invalid resource', () => {
    const result = classifyResources([
      {},
      { apiVersion: 'v1' },
      { apiVersion: 'v1', kind: 'Service', metadata: {} },
      { apiVersion: GATEWAY_API_VERSION, kind: 'Gateway', metadata: { name: 'gateway' } },
    ]);

    expect(result.categorized).toEqual({
      gateways: [],
      routes: [],
      services: [],
      deployments: [],
      statefulSets: [],
      daemonSets: [],
      gatewayClasses: [],
      referenceGrants: [],
    });
    expect(result.diagnostics).toEqual([
      {
        resourceIndex: 0,
        path: '/resources/0/apiVersion',
        message: 'Missing required field: apiVersion',
      },
      {
        resourceIndex: 1,
        path: '/resources/1/kind',
        message: 'Missing required field: kind',
      },
      {
        resourceIndex: 2,
        path: '/resources/2/metadata/name',
        message: 'Missing required field: metadata.name',
      },
      {
        resourceIndex: 3,
        path: '/resources/3/spec',
        message: 'Gateway missing required field: spec',
      },
    ]);
  });

  it.each(['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'])(
    'requires spec for Gateway API %s resources',
    kind => {
      expect(classifyResources([
        resource(kind, 'route', GATEWAY_API_VERSION),
      ]).diagnostics).toEqual([
        {
          resourceIndex: 0,
          path: '/resources/0/spec',
          message: `${kind} missing required field: spec`,
        },
      ]);
    },
  );

  it('does not require spec for the same kinds outside a Gateway API group', () => {
    const gateway = resource('Gateway', 'gateway', 'example.test/v1');
    const route = resource('HTTPRoute', 'route', 'example.test/v1');

    const result = classifyResources([gateway, route]);

    expect(result.diagnostics).toEqual([]);
    expect(result.categorized).toEqual({
      gateways: [],
      routes: [],
      services: [],
      deployments: [],
      statefulSets: [],
      daemonSets: [],
      gatewayClasses: [],
      referenceGrants: [],
    });
  });

  it('preserves truthy required-field behavior from the editor validation', () => {
    const service = {
      apiVersion: 1,
      kind: 'Service',
      metadata: { name: 'numeric-version' },
    };

    const result = classifyResources([service]);

    expect(result.diagnostics).toEqual([]);
    expect(result.categorized.services).toEqual([service]);
  });

  it('treats non-object resources as missing apiVersion diagnostics', () => {
    expect(classifyResources([null, ['not', 'an', 'object']]).diagnostics).toEqual([
      {
        resourceIndex: 0,
        path: '/resources/0/apiVersion',
        message: 'Missing required field: apiVersion',
      },
      {
        resourceIndex: 1,
        path: '/resources/1/apiVersion',
        message: 'Missing required field: apiVersion',
      },
    ]);
  });
});
