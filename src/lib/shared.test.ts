import { buildCoverageGraph, Gateway, HTTPRoute, TLSRoute, TCPRoute, RouteCoverageDetail } from './shared.js';
import { describe, it, expect } from 'vitest';

describe('buildCoverageGraph', () => {
  it('computes coverage summary correctly (HTTPRoute)', () => {
    const gateways: Gateway[] = [
      {
        apiVersion: 'gateway.networking.k8s.io/v1beta1',
        kind: 'Gateway',
        metadata: { name: 'gw', namespace: 'default' },
        spec: { listeners: [{ name: 'web', port: 80, protocol: 'HTTP' }] }
      }
    ];
    const routes: HTTPRoute[] = [
      {
        apiVersion: 'gateway.networking.k8s.io/v1beta1',
        kind: 'HTTPRoute',
        metadata: { name: 'covered', namespace: 'default' },
        spec: { parentRefs: [{ name: 'gw', sectionName: 'web' }], rules: [] }
      },
      {
        apiVersion: 'gateway.networking.k8s.io/v1beta1',
        kind: 'HTTPRoute',
        metadata: { name: 'uncovered', namespace: 'default' },
        spec: { rules: [] }
      }
    ];

    const graph = buildCoverageGraph(gateways, routes);
    expect(graph.summary.coveredRoutes).toBe(1);
    expect(graph.summary.uncoveredRoutes).toBe(1);
    expect(graph.summary.coveragePercent).toBeCloseTo(50);
    const rcCovered = graph.routeCoverage.find((r: RouteCoverageDetail) => r.name === 'covered');
    const rcUncovered = graph.routeCoverage.find((r: RouteCoverageDetail) => r.name === 'uncovered');
    expect(rcCovered?.covered).toBe(true);
    expect(rcUncovered?.covered).toBe(false);
  });
  it('handles TLSRoute and TCPRoute kinds', () => {
    const gateways: Gateway[] = [
      {
        apiVersion: 'gateway.networking.k8s.io/v1beta1',
        kind: 'Gateway',
        metadata: { name: 'gw2', namespace: 'edge' },
        spec: { listeners: [{ name: 'tls', port: 443, protocol: 'HTTPS' }, { name: 'tcp', port: 9000, protocol: 'TCP' }] }
      }
    ];
    const tls: TLSRoute = {
      apiVersion: 'gateway.networking.k8s.io/v1alpha2',
      kind: 'TLSRoute',
      metadata: { name: 'secure-app', namespace: 'edge' },
      spec: { parentRefs: [{ name: 'gw2', sectionName: 'tls' }], rules: [] }
    };
    const tcp: TCPRoute = {
      apiVersion: 'gateway.networking.k8s.io/v1alpha2',
      kind: 'TCPRoute',
      metadata: { name: 'stream-app', namespace: 'edge' },
      spec: { parentRefs: [{ name: 'gw2', sectionName: 'tcp' }], rules: [] }
    };
    const graph = buildCoverageGraph(gateways, [tls, tcp]);
    const tlsRc = graph.routeCoverage.find((r: RouteCoverageDetail) => r.name === 'secure-app');
    const tcpRc = graph.routeCoverage.find((r: RouteCoverageDetail) => r.name === 'stream-app');
    expect(tlsRc?.covered).toBe(true);
    expect(tcpRc?.covered).toBe(true);
    expect(tlsRc?.kind).toBe('TLSRoute');
    expect(tcpRc?.kind).toBe('TCPRoute');
  });
});
