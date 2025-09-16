import { describe, it, expect } from 'vitest';
import { containsPotentialSecrets } from './secretDetection.js';
import * as yaml from 'js-yaml';

describe('containsPotentialSecrets', () => {
  it('detects Kubernetes Secret kind', () => {
    const raw = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: mysecret\ndata:\n  password: cGFzcw==`; // base64('pass')
    const parsed = [yaml.load(raw)];
  const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('Kubernetes Secret'))).toBe(true);
  });

  it('detects private key block', () => {
    const raw = `-----BEGIN PRIVATE KEY-----\nABCDEF1234567890ABCDEF==\n-----END PRIVATE KEY-----`;
    const res = containsPotentialSecrets(raw, []);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('Private key block'))).toBe(true);
  });

  it('detects suspicious env var', () => {
    const raw = `API_KEY=supersecretvalue`;
    const res = containsPotentialSecrets(raw, []);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('environment variable'))).toBe(true);
  });

  it('does not flag benign content', () => {
    const raw = `apiVersion: gateway.networking.k8s.io/v1beta1\nkind: Gateway\nmetadata:\n  name: gw\n  namespace: default\nspec: {}`;
    const parsed = [yaml.load(raw)];
  const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).toBeNull();
  });
});
