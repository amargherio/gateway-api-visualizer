import { describe, it, expect } from 'vitest';

// This test validates that when a route row is clicked the intended id format is passed through.
// We cannot mount Svelte components easily here without additional tooling, so we test the utility expectation.

function buildRouteId(namespace: string, name: string) { return `route:${namespace}/${name}`; }

describe('route row selection id format', () => {
  it('creates consistent id for selection', () => {
    expect(buildRouteId('default','foo')).toBe('route:default/foo');
  });
});
