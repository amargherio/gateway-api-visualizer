import { describe, it, expect } from 'vitest';
import { buildFullGraph, Gateway, HTTPRoute, Service, Deployment, GatewayClass, ReferenceGrant } from './shared.js';

describe('buildFullGraph', () => {
  it('links gateway to gatewayclass and route to listener & backend service', () => {
    const gc: GatewayClass = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'GatewayClass', metadata: { name: 'example' } };
    const gw: Gateway = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'Gateway', metadata: { name: 'gw', namespace: 'default' }, spec: { gatewayClassName: 'example', listeners: [{ name: 'http', port: 80, protocol: 'HTTP' }] } };
    const route: HTTPRoute = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'HTTPRoute', metadata: { name: 'r1', namespace: 'default' }, spec: { parentRefs: [{ name: 'gw', sectionName: 'http' }], rules: [{ backendRefs: [{ name: 'svc1', port: 80 }] }] } };
    const svc: Service = { apiVersion: 'v1', kind: 'Service', metadata: { name: 'svc1', namespace: 'default' }, spec: { selector: { app: 'demo' }, ports: [{ port: 80 }] } };
    const deploy: Deployment = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'demo', namespace: 'default' }, spec: { selector: { matchLabels: { app: 'demo' } }, template: { metadata: { labels: { app: 'demo' } } } } };

    const graph = buildFullGraph({ gateways: [gw], routes: [route], services: [svc], deployments: [deploy], gatewayClasses: [gc] });
    const routeNode = graph.nodes.find(n => n.id === 'route:default/r1');
    expect(routeNode).toBeTruthy();
    const gcNode = graph.nodes.find(n => n.id === 'gatewayclass:example');
    expect(gcNode).toBeTruthy();
    const svcNode = graph.nodes.find(n => n.id === 'service:default/svc1');
    expect(svcNode).toBeTruthy();
    const backendEdge = graph.edges.find(e => e.type === 'backend');
    expect(backendEdge).toBeTruthy();
    const classEdge = graph.edges.find(e => e.type === 'class-of');
    expect(classEdge).toBeTruthy();
    const servesEdge = graph.edges.find(e => e.type === 'serves');
    expect(servesEdge).toBeTruthy();
    const rc = graph.routeCoverage.find(r => r.name === 'r1');
    expect(rc?.backendRefs?.length).toBe(1);
    expect(graph.summary.services).toBe(1);
    expect(graph.summary.workloads).toBe(1);
  });

  it('marks missing backend service and cross-namespace grant', () => {
    const gw: Gateway = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'Gateway', metadata: { name: 'gw', namespace: 'edge' }, spec: { listeners: [{ name: 'http', port: 80, protocol: 'HTTP' }] } };
    const route: HTTPRoute = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'HTTPRoute', metadata: { name: 'r2', namespace: 'edge' }, spec: { parentRefs: [{ name: 'gw', sectionName: 'http' }], rules: [{ backendRefs: [{ name: 'svc-missing' }] }] } };
    const grant: ReferenceGrant = { apiVersion: 'gateway.networking.k8s.io/v1beta1', kind: 'ReferenceGrant', metadata: { name: 'grant1', namespace: 'edge' }, spec: { from: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: 'edge' }], to: [{ group: '', kind: 'Service', name: 'svc-missing' }] } };
    const graph = buildFullGraph({ gateways: [gw], routes: [route], referenceGrants: [grant] });
    const rc = graph.routeCoverage.find(r => r.name === 'r2');
    expect(rc?.missingBackends?.length).toBe(1);
    expect(graph.summary.missingBackends).toBe(1);
  });
});
