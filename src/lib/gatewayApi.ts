import type { JSONSchema } from 'monaco-yaml';
import releaseDefinitions from '../../data/gateway-api-releases.json' with { type: 'json' };

export type GatewayApiVersion = '1.3' | '1.4' | '1.5' | '1.6';
export type GatewayApiChannel = 'standard' | 'experimental';

export interface GatewayApiRelease {
  id: GatewayApiVersion;
  tag: string;
}

export interface GatewayApiFeature {
  name: string;
  channel: GatewayApiChannel;
}

export interface GatewayApiCrd {
  group: string;
  kind: string;
  scope: 'Namespaced' | 'Cluster';
  channel: GatewayApiChannel;
  servedVersions: string[];
  unservedVersions: string[];
  storageVersion: string;
}

export interface GatewayApiSource {
  url: string;
  sha256: string;
}

export interface GatewayApiBundle extends GatewayApiRelease {
  schema: JSONSchema;
  crds: GatewayApiCrd[];
  features: GatewayApiFeature[];
  sources: {
    standard: GatewayApiSource;
    experimental: GatewayApiSource;
    featureFiles: GatewayApiSource[];
  };
}

export interface GatewayApiDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface GatewayApiAuditState {
  version: GatewayApiVersion;
  status: 'loading' | 'ready' | 'error';
  diagnostics: GatewayApiDiagnostic[];
  message?: string;
}

export const gatewayApiReleases: readonly GatewayApiRelease[] =
  releaseDefinitions as readonly GatewayApiRelease[];

export const defaultGatewayApiVersion: GatewayApiVersion = '1.6';

const releasesByVersion = new Map<GatewayApiVersion, GatewayApiRelease>(
  gatewayApiReleases.map((release) => [release.id, release]),
);
const bundleCache = new Map<GatewayApiVersion, Promise<GatewayApiBundle>>();

function isVersion(value: unknown): value is GatewayApiVersion {
  return typeof value === 'string' && releasesByVersion.has(value as GatewayApiVersion);
}

function isChannel(value: unknown): value is GatewayApiChannel {
  return value === 'standard' || value === 'experimental';
}

function isSource(value: unknown): value is GatewayApiSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.url === 'string' && typeof source.sha256 === 'string';
}

function isBundle(value: unknown, release: GatewayApiRelease): value is GatewayApiBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Record<string, unknown>;
  if (
    bundle.id !== release.id ||
    bundle.tag !== release.tag ||
    !bundle.schema ||
    typeof bundle.schema !== 'object' ||
    !Array.isArray(bundle.crds) ||
    bundle.crds.length === 0 ||
    !Array.isArray(bundle.features) ||
    !bundle.sources ||
    typeof bundle.sources !== 'object'
  ) {
    return false;
  }

  const sources = bundle.sources as Record<string, unknown>;
  if (
    !isSource(sources.standard) ||
    !isSource(sources.experimental) ||
    !Array.isArray(sources.featureFiles) ||
    !sources.featureFiles.every(isSource)
  ) {
    return false;
  }

  return (
    bundle.crds.every((crd) => {
      if (!crd || typeof crd !== 'object') return false;
      const item = crd as Record<string, unknown>;
      return (
        typeof item.group === 'string' &&
        typeof item.kind === 'string' &&
        (item.scope === 'Namespaced' || item.scope === 'Cluster') &&
        isChannel(item.channel) &&
        Array.isArray(item.servedVersions) &&
        item.servedVersions.every((version) => typeof version === 'string') &&
        Array.isArray(item.unservedVersions) &&
        item.unservedVersions.every((version) => typeof version === 'string') &&
        typeof item.storageVersion === 'string'
      );
    }) &&
    bundle.features.every((feature) => {
      if (!feature || typeof feature !== 'object') return false;
      const item = feature as Record<string, unknown>;
      return typeof item.name === 'string' && isChannel(item.channel);
    })
  );
}

export function loadGatewayApiBundle(version: GatewayApiVersion): Promise<GatewayApiBundle> {
  if (!isVersion(version)) {
    return Promise.reject(new Error(`Unknown Gateway API version: ${String(version)}`));
  }

  const cached = bundleCache.get(version);
  if (cached) return cached;

  const release = releasesByVersion.get(version)!;
  const request = fetch(`${import.meta.env.BASE_URL}gateway-api/${release.tag}.json`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Could not load Gateway API ${release.id}: ${response.status} ${response.statusText}`,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new Error(`Gateway API ${release.id} bundle is not valid JSON.`);
      }
    })
    .then((bundle) => {
      if (!isBundle(bundle, release)) {
        throw new Error(`Gateway API ${release.id} bundle has an invalid shape.`);
      }
      return bundle;
    });

  bundleCache.set(version, request);
  void request.catch(() => {
    if (bundleCache.get(version) === request) bundleCache.delete(version);
  });
  return request;
}
