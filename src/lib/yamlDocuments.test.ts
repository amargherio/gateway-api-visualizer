import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { buildFullGraph, type AnyRoute, type Gateway } from './shared.js';
import { splitYamlDocuments } from './yamlDocuments.js';

function graphForFixture(path: string) {
  const content = readFileSync(new URL(path, import.meta.url), 'utf8');
  const documents = splitYamlDocuments(content).map(document => load(document));
  const gateways = documents.filter((document): document is Gateway => (
    !!document && typeof document === 'object' && (document as { kind?: unknown }).kind === 'Gateway'
  ));
  const routes = documents.filter((document): document is AnyRoute => (
    !!document && typeof document === 'object' && ['HTTPRoute', 'TLSRoute', 'TCPRoute', 'GRPCRoute'].includes((document as { kind?: unknown }).kind as string)
  ));
  return buildFullGraph({ gateways, routes });
}

describe('YAML document handling', () => {
  it('parses both shipped fixtures with js-yaml 5', () => {
    expect(graphForFixture('../../data/sample.yaml').summary).toMatchObject({
      gateways: 1,
      routes: 3,
      coveredRoutes: 2,
      uncoveredRoutes: 1
    });
    expect(graphForFixture('../../data/sample-multi-gateways.yaml').summary).toMatchObject({
      gateways: 3,
      routes: 20,
      coveredRoutes: 17,
      uncoveredRoutes: 3
    });
  });

  it('skips empty, comment-only, and trailing documents', () => {
    const content = '# header\n---\n\n---\n# trailing comment\n';

    expect(() => load('# only a comment')).toThrow();
    expect(splitYamlDocuments(content)).toEqual([]);
  });

  it('keeps valid documents beside comment-only documents', () => {
    const content = '# header\n---\nkind: Gateway\nmetadata:\n  name: gw\n---\n# trailing comment\n';

    expect(splitYamlDocuments(content)).toEqual(['kind: Gateway\nmetadata:\n  name: gw']);
  });
});
