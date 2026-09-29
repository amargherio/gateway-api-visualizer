import { readFile } from 'node:fs/promises';

import {
  gatewayApiReleases,
  type GatewayApiBundle,
  type GatewayApiChannel,
  type GatewayApiCrd,
  type GatewayApiFeature,
  type GatewayApiRelease,
  type GatewayApiSource,
  type GatewayApiVersion,
} from '../src/lib/gatewayApi.js';

const bundles = new Map<GatewayApiVersion, GatewayApiBundle>();
const loadingBundles = new Map<GatewayApiVersion, Promise<GatewayApiBundle>>();

function isChannel(value: unknown): value is GatewayApiChannel {
  return value === 'standard' || value === 'experimental';
}

function isSource(value: unknown): value is GatewayApiSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.url === 'string' && typeof source.sha256 === 'string';
}

function isCrd(value: unknown): value is GatewayApiCrd {
  if (!value || typeof value !== 'object') return false;
  const crd = value as Record<string, unknown>;
  return (
    typeof crd.group === 'string' &&
    typeof crd.kind === 'string' &&
    (crd.scope === 'Namespaced' || crd.scope === 'Cluster') &&
    isChannel(crd.channel) &&
    Array.isArray(crd.servedVersions) &&
    crd.servedVersions.every((version) => typeof version === 'string') &&
    Array.isArray(crd.unservedVersions) &&
    crd.unservedVersions.every((version) => typeof version === 'string') &&
    typeof crd.storageVersion === 'string'
  );
}

function isFeature(value: unknown): value is GatewayApiFeature {
  if (!value || typeof value !== 'object') return false;
  const feature = value as Record<string, unknown>;
  return typeof feature.name === 'string' && isChannel(feature.channel);
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
  return (
    bundle.crds.every(isCrd) &&
    bundle.features.every(isFeature) &&
    isSource(sources.standard) &&
    isSource(sources.experimental) &&
    Array.isArray(sources.featureFiles) &&
    sources.featureFiles.every(isSource)
  );
}

function findRelease(version: GatewayApiVersion): GatewayApiRelease {
  const release = gatewayApiReleases.find((candidate) => candidate.id === version);
  if (!release) throw new Error(`Unknown Gateway API version: ${String(version)}`);
  return release;
}

async function readBundle(release: GatewayApiRelease): Promise<GatewayApiBundle> {
  const asset = new URL(`../public/gateway-api/${release.tag}.json`, import.meta.url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(asset, 'utf8'));
  } catch (error) {
    throw new Error(`Could not load Gateway API ${release.id} bundle.`, { cause: error });
  }

  if (!isBundle(parsed, release)) {
    throw new Error(`Gateway API ${release.id} bundle has an invalid shape.`);
  }
  return parsed;
}

/**
 * Loads a checked-in Gateway API release bundle. Completed loads are cached, while failed
 * reads are deliberately not retained so a transient filesystem failure can be retried.
 */
export function loadApiBundleFromDisk(version: GatewayApiVersion): Promise<GatewayApiBundle> {
  const release = findRelease(version);
  const cached = bundles.get(version);
  if (cached) return Promise.resolve(cached);

  const inFlight = loadingBundles.get(version);
  if (inFlight) return inFlight;

  const request = readBundle(release).then((bundle) => {
    bundles.set(version, bundle);
    return bundle;
  });
  loadingBundles.set(version, request);
  void request.finally(() => {
    if (loadingBundles.get(version) === request) loadingBundles.delete(version);
  }).catch(() => undefined);
  return request;
}
