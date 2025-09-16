import { describe, it, expect } from 'vitest';
import type { RouteCoverageDetail } from './shared.js';
import { computeRouteCoverageView } from './routeCoverageView.js';

function make(name: string, namespace: string, covered: boolean): RouteCoverageDetail {
  return { id: `route:${namespace}/${name}`, name, namespace, covered, parentRefs: [], kind: 'HTTPRoute' };
}

describe('computeRouteCoverageView', () => {
  const rows: RouteCoverageDetail[] = [
    make('a-route','team-a', true),
    make('b-route','team-b', false),
    make('c-route','team-a', true),
    make('d-route','team-c', false),
  ];

  it('filters by coverage', () => {
    const res = computeRouteCoverageView({ rows, filterCoverage: 'UNCOVERED' });
    expect(res.total).toBe(2);
    expect(res.visible.every(r => !r.covered)).toBe(true);
  });

  it('searches across name and namespace', () => {
    const res = computeRouteCoverageView({ rows, search: 'team-a' });
    expect(res.total).toBe(2);
    const res2 = computeRouteCoverageView({ rows, search: 'c-route' });
    expect(res2.total).toBe(1);
  });

  it('sorts by name descending', () => {
    const res = computeRouteCoverageView({ rows, sortCol: 'name', sortDir: 'desc', pageSize: 'All' });
    expect(res.visible.map(r => r.name)).toEqual(['d-route','c-route','b-route','a-route']);
  });

  it('paginates results', () => {
    const res = computeRouteCoverageView({ rows, pageSize: 2, page: 2, sortCol: 'name' });
    expect(res.visible.length).toBe(2);
  });
});
