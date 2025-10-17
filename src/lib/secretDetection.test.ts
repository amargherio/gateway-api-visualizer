import { describe, it, expect } from 'vitest';
import { containsPotentialSecrets } from './secretDetection.js';
import * as yaml from 'js-yaml';

describe('containsPotentialSecrets', () => {
  it('detects Kubernetes Secret kind with context', () => {
    const raw = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: mysecret\ndata:\n  password: cGFzcw==`; // base64('pass')
    const parsed = [yaml.load(raw)];
    const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('Secret/mysecret: Kubernetes Secret manifest'))).toBe(true);
  });

  it('detects private key block (raw context)', () => {
    const raw = `-----BEGIN PRIVATE KEY-----\nABCDEF1234567890ABCDEF==\n-----END PRIVATE KEY-----`;
    const res = containsPotentialSecrets(raw, []);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('raw: Private key block present'))).toBe(true);
  });

  it('detects suspicious env var (raw context)', () => {
    const raw = `API_KEY=supersecretvalue`;
    const res = containsPotentialSecrets(raw, []);
    expect(res).not.toBeNull();
    expect(res?.reasons.some(r => r.includes('raw: Suspicious environment variable'))).toBe(true);
  });

  it('does not flag benign content', () => {
    const raw = `apiVersion: gateway.networking.k8s.io/v1beta1\nkind: Gateway\nmetadata:\n  name: gw\n  namespace: default\nspec: {}`;
    const parsed = [yaml.load(raw)];
  const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).toBeNull();
  });

  it('does not flag secretName reference fields', () => {
    const raw = `apiVersion: gateway.networking.k8s.io/v1beta1\nkind: Gateway\nmetadata:\n  name: gw\n  namespace: default\nspec:\n  tls:\n    certificateRefs:\n      - kind: Secret\n        name: my-cert-secret\n    secretName: my-cert-secret`; // typical reference style usage
    const parsed = [yaml.load(raw)];
    const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).toBeNull();
  });

  it('does not flag cert-manager.io annotations', () => {
    const raw = `apiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata:\n  name: mycert\n  annotations:\n    cert-manager.io/issuer: letsencrypt-prod\n    cert-manager.io/some-setting: value\nspec:\n  secretName: mycert-tls\n  commonName: example.com\n  dnsNames:\n    - example.com\n    - www.example.com`;
    const parsed = [yaml.load(raw)];
    const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).toBeNull();
  });

  it('includes context for multiple resources', () => {
    const raw = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: first\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: second`; // two secrets
    const parsed = raw.split(/---/).map(d => yaml.load(d));
    const res = containsPotentialSecrets(raw, parsed as unknown[]);
    expect(res).not.toBeNull();
    const joined = res!.reasons.join('\n');
    expect(joined).toMatch(/Secret\/first: Kubernetes Secret manifest/);
    expect(joined).toMatch(/Secret\/second: Kubernetes Secret manifest/);
  });
});
