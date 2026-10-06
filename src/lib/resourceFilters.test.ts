import { describe, expect, it } from 'vitest';
import { buildFullGraph, configuredRouteMatches, type AnyRoute, type Gateway } from './shared.js';
import { filterResourceGraph, matchesRouteFilters } from './resourceFilters.js';
import { computeRouteCoverageView } from './routeCoverageView.js';
import { createGatewayApiTools, type GatewayApiToolHost } from './webmcp.js';

const routes: AnyRoute[] = [
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: { name: 'web', namespace: 'team-a' },
    spec: {
      hostnames: ['*.Example.com', 'api.example.com', 'api.example.com'],
      parentRefs: [{ name: 'gateway' }],
      rules: [
        {
          matches: [
            { path: { type: 'Exact', value: '/api' }, method: 'GET' },
            { path: { value: '/v2' } },
          ],
        },
        { matches: [{ method: 'POST' }] },
        {},
      ],
    },
  },
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'GRPCRoute',
    metadata: { name: 'rpc' },
    spec: {
      hostnames: ['rpc.example.com'],
      rules: [
        {
          matches: [
            { method: { service: 'example.Greeter', method: 'SayHello' } },
            { method: { type: 'RegularExpression', service: 'example.*' } },
          ],
        },
        {},
      ],
    },
  },
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'TLSRoute',
    metadata: { name: 'tls' },
    spec: { hostnames: ['secure.example.com'] },
  },
  {
    apiVersion: 'gateway.networking.k8s.io/v1alpha2',
    kind: 'TCPRoute',
    metadata: { name: 'tcp' },
    spec: {},
  },
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: { name: 'empty' },
    spec: {},
  },
];
const gateways: Gateway[] = [
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name: 'gateway', namespace: 'team-a' },
    spec: {
      listeners: [
        { name: 'https', port: 443, protocol: 'HTTPS', hostname: 'listener.example.com' },
      ],
    },
  },
];

describe('configured routing metadata and filters', () => {
  const graph = buildFullGraph({ gateways, routes });

  it('projects configured hostnames, HTTP defaults and gRPC matches without inventing TCP/TLS paths', () => {
    expect(graph.routeCoverage[0]).toMatchObject({
      hostnames: ['*.Example.com', 'api.example.com'],
      matches: ['Exact /api · GET', 'PathPrefix /v2', 'PathPrefix / · POST', 'PathPrefix /'],
    });
    expect(graph.routeCoverage[1].matches).toEqual([
      'Exact example.Greeter/SayHello',
      'RegularExpression example.*/*',
      'Any gRPC method',
    ]);
    expect(graph.routeCoverage[2]).toMatchObject({
      hostnames: ['secure.example.com'],
      matches: [],
    });
    expect(graph.routeCoverage[3]).toMatchObject({ hostnames: [], matches: [] });
    expect(graph.routeCoverage[4]).toMatchObject({ hostnames: [], matches: [] });
    expect(graph.nodes.find((node) => node.id === graph.routeCoverage[0].id)?.data).toMatchObject({
      hostnames: graph.routeCoverage[0].hostnames,
      matches: graph.routeCoverage[0].matches,
    });
    expect(
      graph.nodes
        .filter((node) => ['gateway', 'listener'].includes(node.type))
        .map((node) => node.data?.hostnames),
    ).toEqual([['listener.example.com'], ['listener.example.com']]);
  });

  it('combines literal case-insensitive substring filters and preserves graph integrity and counts', () => {
    const filtered = filterResourceGraph(graph, {
      hostname: ' *.EXAMPLE ',
      routeMatch: ' /API ',
      kind: 'HTTPRoute',
      parentRefs: 'COVERED',
    });
    expect(filtered.routeCoverage.map((route) => route.name)).toEqual(['web']);
    expect(filtered.nodes.map((node) => node.id)).toEqual(['route:team-a/web']);
    expect(filtered.summary).toEqual(graph.summary);
    expect(filtered.edges).toEqual([]);
    expect(filterResourceGraph(graph, { hostname: 'anything.example.com' }).routeCoverage).toEqual(
      [],
    );
    expect(
      filterResourceGraph(graph, {
        routeMatch: 'sayhello',
        parentRefs: 'UNCOVERED',
      }).routeCoverage.map((route) => route.name),
    ).toEqual(['rpc']);
    expect(filterResourceGraph(graph, { hostname: 'listener.example.com' }).routeCoverage).toEqual(
      [],
    );
    expect(filterResourceGraph(graph)).toEqual(graph);
  });

  it('uses the same matching in table search, dedicated filters and pagination', () => {
    for (const search of ['TEAM-A', '*.example', '/API', 'get', 'Greeter', 'SayHello']) {
      const table = computeRouteCoverageView({
        rows: graph.routeCoverage,
        search,
        pageSize: 'All',
      });
      expect(table.visible).toEqual(filterResourceGraph(graph, { search }).routeCoverage);
      expect(table.total).toBe(1);
    }
    const table = computeRouteCoverageView({
      rows: graph.routeCoverage,
      hostname: 'example.com',
      routeMatch: '/api',
      page: 10,
      pageSize: 1,
    });
    expect(table).toMatchObject({ total: 1, page: 1, totalPages: 1 });
    expect(matchesRouteFilters(graph.routeCoverage[3], { hostname: 'example.com' })).toBe(false);
    expect(computeRouteCoverageView({ rows: graph.routeCoverage, hostname: 'absent' }).total).toBe(
      0,
    );
  });

  it('preserves header and query distinctions and searches all configured constraints', () => {
    const route: AnyRoute = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: { name: 'headers' },
      spec: {
        rules: [
          {
            matches: [
              {
                headers: [{ name: 'x-version', value: 'v1' }],
                queryParams: [{ name: 'mode', type: 'RegularExpression', value: 'preview.*' }],
              },
              { headers: [{ name: 'x-version', value: 'v2' }] },
            ],
          },
        ],
      },
    };
    expect(configuredRouteMatches(route)).toEqual([
      'PathPrefix / · Header x-version Exact v1 · Query mode RegularExpression preview.*',
      'PathPrefix / · Header x-version Exact v2',
    ]);
    const headerGraph = buildFullGraph({ gateways: [], routes: [route] });
    expect(filterResourceGraph(headerGraph, { routeMatch: 'preview' }).routeCoverage).toHaveLength(
      1,
    );
    expect(filterResourceGraph(headerGraph, { search: 'x-version' }).routeCoverage).toHaveLength(1);
    expect(
      configuredRouteMatches({
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'GRPCRoute',
        metadata: { name: 'rpc-header' },
        spec: { rules: [{ matches: [{ headers: [{ name: 'tenant', value: 'team-a' }] }] }] },
      }),
    ).toEqual(['Any gRPC method · Header tenant Exact team-a']);
  });

  it('discovers listener hostnames by explicit scope and removes unrelated hostname context', () => {
    const filters = { hostname: 'listener.example', hostnameScope: 'LISTENER' as const };
    const filtered = filterResourceGraph(graph, filters);
    expect(filtered.routeCoverage.map((route) => route.name)).toEqual(['web']);
    expect(filtered.routeCoverage[0].listenerHostnames).toEqual(['listener.example.com']);
    expect(computeRouteCoverageView({ rows: graph.routeCoverage, ...filters }).visible).toEqual(
      filtered.routeCoverage,
    );
    expect(filtered.nodes.map((node) => node.type).sort()).toEqual([
      'gateway',
      'listener',
      'route',
    ]);
    expect(filterResourceGraph(graph, { hostname: 'absent', hostnameScope: 'ALL' }).nodes).toEqual(
      [],
    );
    expect(
      filterResourceGraph(graph, { hostname: 'rpc.example.com' }).nodes.map((node) => node.id),
    ).toEqual(['route:default/rpc']);
    const ids = new Set(filtered.nodes.map((node) => node.id));
    expect(filtered.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });

  it('respects parent namespaces, sections, ports and kinds without implying hostname overlap', () => {
    const gateway: Gateway = {
      ...gateways[0],
      spec: {
        listeners: [
          { name: 'one', port: 80, protocol: 'HTTP', hostname: 'one.example.com' },
          { name: 'two', port: 443, protocol: 'HTTPS', hostname: 'two.example.com' },
        ],
      },
    };
    const refs = [
      { name: 'gateway', namespace: 'team-a', sectionName: 'two', port: 443 },
      { name: 'gateway', namespace: 'team-a', sectionName: 'two', port: 80 },
      { name: 'gateway', namespace: 'absent' },
      { name: 'gateway', namespace: 'team-a', kind: 'Service' },
      { name: 'gateway', namespace: 'team-a', group: '' },
    ];
    const linkedRoutes: AnyRoute[] = refs.map((ref, index) => ({
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: { name: `route-${index}` },
      spec: { hostnames: ['different.example.com'], parentRefs: [ref] },
    }));
    const linkedGraph = buildFullGraph({ gateways: [gateway], routes: linkedRoutes });
    expect(linkedGraph.routeCoverage.map((route) => route.listenerHostnames)).toEqual([
      ['two.example.com'],
      [],
      [],
      [],
      [],
    ]);
    expect(
      filterResourceGraph(linkedGraph, {
        hostname: 'two.example',
        hostnameScope: 'ALL',
      }).routeCoverage.map((route) => route.name),
    ).toEqual(['route-0']);
    const standalone = filterResourceGraph(buildFullGraph({ gateways: [gateway], routes: [] }), {
      hostname: 'two.example',
      hostnameScope: 'LISTENER',
    });
    expect(standalone.nodes.map((node) => node.id)).toEqual([
      'gateway:team-a/gateway',
      'gateway:team-a/gateway:listener:two',
    ]);
  });

  it('validates and forwards WebMCP hostname and match filters', () => {
    const host: GatewayApiToolHost = {
      getAuditReport: () => ({}),
      queryResources: (input) => input,
      proposeManifestAudit: async () => ({}),
      setGraphView: (input) => input,
      inspectResource: () => ({}),
    };
    const tools = createGatewayApiTools(host);
    for (const name of ['query_gateway_resources', 'set_graph_view']) {
      const tool = tools.find((tool) => tool.name === name)!;
      expect(
        tool.execute({ hostname: 'example', hostnameScope: 'LISTENER', routeMatch: 'GET' }),
      ).toMatchObject({
        hostname: 'example',
        hostnameScope: 'LISTENER',
        routeMatch: 'GET',
      });
      expect(() => tool.execute({ hostname: 123 })).toThrow('hostname must be a string');
      expect(() => tool.execute({ routeMatch: [] })).toThrow('routeMatch must be a string');
      expect(() => tool.execute({ hostnameScope: 'EFFECTIVE' })).toThrow(
        'hostnameScope must be one of',
      );
    }
  });
});
