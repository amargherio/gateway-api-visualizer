#!/usr/bin/env node
/*
 * Generates pinned Gateway API audit bundles from the Kubernetes Gateway API
 * release assets. The generated artifacts retain upstream source URLs and
 * SHA-256 digests; the upstream manifests are Apache-2.0 licensed.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import releaseDefinitions from '../data/gateway-api-releases.json' with { type: 'json' };
import * as yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outputDirectory = resolve(root, 'public/gateway-api');
const releases = releaseDefinitions;
const githubApi = 'https://api.github.com/repos/kubernetes-sigs/gateway-api';
const githubRaw = 'https://raw.githubusercontent.com/kubernetes-sigs/gateway-api';
const gatewayGroups = ['gateway.networking.k8s.io', 'gateway.networking.x-k8s.io'];
const sourceLicense = 'Apache-2.0; Copyright The Kubernetes Authors';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

/**
 * Convert Kubernetes OpenAPI schema extensions to the JSON Schema subset used
 * by monaco-yaml. This function is intentionally pure: importing this module
 * never accesses the network or writes generated artifacts.
 */
export function normalizeCrdSchema(schema) {
  if (typeof schema === 'boolean') return schema;
  if (!plainObject(schema)) throw new Error('CRD schema must be an object or boolean.');

  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable' || key === 'x-kubernetes-int-or-string') continue;
    if (key === 'properties' && plainObject(value)) {
      normalized.properties = Object.fromEntries(
        Object.entries(value).map(([property, propertySchema]) => [
          property,
          normalizeCrdSchema(propertySchema),
        ]),
      );
    } else if (key === 'items') {
      normalized.items = Array.isArray(value)
        ? value.map(normalizeCrdSchema)
        : normalizeCrdSchema(value);
    } else if (
      key === 'additionalProperties' &&
      (plainObject(value) || typeof value === 'boolean')
    ) {
      normalized.additionalProperties = normalizeCrdSchema(value);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key) && Array.isArray(value)) {
      normalized[key] = value.map(normalizeCrdSchema);
    } else if (key === 'not' && (plainObject(value) || typeof value === 'boolean')) {
      normalized.not = normalizeCrdSchema(value);
    } else if (key === 'if' || key === 'then' || key === 'else') {
      normalized[key] = normalizeCrdSchema(value);
    } else {
      normalized[key] = clone(value);
    }
  }

  if (schema['x-kubernetes-int-or-string'] === true) {
    delete normalized.type;
    const integerOrString = [{ type: 'integer' }, { type: 'string' }];
    if (normalized.anyOf !== undefined) {
      const { anyOf, allOf, ...rest } = normalized;
      return {
        ...rest,
        allOf: [
          ...(Array.isArray(allOf) ? allOf : allOf === undefined ? [] : [allOf]),
          { anyOf },
          { anyOf: integerOrString },
        ],
      };
    }
    return { ...normalized, anyOf: integerOrString };
  }

  if (schema.nullable === true && normalized.type !== undefined) {
    const types = Array.isArray(normalized.type) ? normalized.type : [normalized.type];
    normalized.type = [...new Set([...types, 'null'])];
  }

  if (
    plainObject(normalized.properties) &&
    normalized.additionalProperties === undefined &&
    schema['x-kubernetes-preserve-unknown-fields'] !== true
  ) {
    normalized.additionalProperties = false;
  }

  return normalized;
}

function metadataSchema(description) {
  return {
    ...(description ? { description } : {}),
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      namespace: { type: 'string' },
      labels: { type: 'object', additionalProperties: { type: 'string' } },
      annotations: { type: 'object', additionalProperties: { type: 'string' } },
    },
    additionalProperties: true,
  };
}

function normalizeResourceSchema(schema) {
  const normalized = normalizeCrdSchema(schema);
  if (!plainObject(normalized)) return normalized;
  if (plainObject(normalized.properties) && plainObject(schema.properties?.metadata)) {
    normalized.properties.metadata = metadataSchema(schema.properties.metadata.description);
  }
  return normalized;
}

function sourceUrl(tag, file) {
  return `${githubRaw}/${tag}/${file}`;
}

async function fetchWithRetry(url, purpose) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'gateway-api-visualizer-generator',
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolveAfter) => setTimeout(resolveAfter, 250 * (attempt + 1)));
    }
  }
  throw new Error(
    `Could not fetch ${purpose} from ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function fetchJson(url, purpose) {
  const response = await fetchWithRetry(url, purpose);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      `Could not parse ${purpose} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fetchBytes(url, purpose) {
  const response = await fetchWithRetry(url, purpose);
  return Buffer.from(await response.arrayBuffer());
}

function yamlDocuments(bytes, source) {
  const documents = [];
  try {
    yaml.loadAll(bytes.toString('utf8'), (document) => {
      if (document !== undefined && document !== null) documents.push(document);
    });
  } catch (error) {
    throw new Error(
      `Could not parse ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return documents;
}

function crdsFromAsset(bytes, tag, source) {
  const crds = [];
  for (const document of yamlDocuments(bytes, source)) {
    if (!plainObject(document) || document.kind !== 'CustomResourceDefinition') continue;
    const annotations = document.metadata?.annotations;
    const bundleTag = annotations?.['gateway.networking.k8s.io/bundle-version'];
    const channel = annotations?.['gateway.networking.k8s.io/channel'];
    if (bundleTag !== tag || (channel !== 'standard' && channel !== 'experimental')) {
      throw new Error(`${source} contains a CRD with invalid Gateway API source annotations.`);
    }
    const spec = document.spec;
    if (
      !plainObject(spec) ||
      typeof spec.group !== 'string' ||
      !plainObject(spec.names) ||
      typeof spec.names.kind !== 'string'
    ) {
      throw new Error(`${source} contains a CRD with invalid group or kind.`);
    }
    if (spec.scope !== 'Namespaced' && spec.scope !== 'Cluster') {
      throw new Error(`${source} contains a CRD with invalid scope.`);
    }
    if (!Array.isArray(spec.versions) || spec.versions.length === 0) {
      throw new Error(`${source} contains a CRD without versions.`);
    }
    const versions = spec.versions.map((version) => {
      if (
        !plainObject(version) ||
        typeof version.name !== 'string' ||
        typeof version.served !== 'boolean' ||
        typeof version.storage !== 'boolean' ||
        !plainObject(version.schema) ||
        !('openAPIV3Schema' in version.schema)
      ) {
        throw new Error(`${source} contains a CRD version without a complete schema.`);
      }
      return {
        name: version.name,
        served: version.served,
        storage: version.storage,
        schema: version.schema.openAPIV3Schema,
      };
    });
    const storageVersions = versions.filter((version) => version.storage);
    if (storageVersions.length !== 1)
      throw new Error(`${source} has a CRD without exactly one storage version.`);
    crds.push({
      group: spec.group,
      kind: spec.names.kind,
      scope: spec.scope,
      versions,
    });
  }
  if (crds.length === 0) throw new Error(`${source} contained no CustomResourceDefinitions.`);
  return crds;
}

function assertNoDuplicateVersions(crds, source) {
  const keys = new Set();
  for (const crd of crds) {
    for (const version of crd.versions) {
      const key = `${crd.group}/${crd.kind}/${version.name}`;
      if (keys.has(key)) throw new Error(`${source} contains duplicate CRD ${key}.`);
      keys.add(key);
    }
  }
}

function parenthesized(text, openingParenthesis) {
  let depth = 0;
  let quote = null;
  for (let index = openingParenthesis; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openingParenthesis + 1, index);
    }
  }
  throw new Error('Unterminated Go parenthesized expression.');
}

function braced(text, openingBrace) {
  let depth = 0;
  let quote = null;
  for (let index = openingBrace; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openingBrace + 1, index);
    }
  }
  throw new Error('Unterminated Go struct literal.');
}

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function featureCatalog(files) {
  const sourceFiles = files.map((file) => ({ ...file, source: withoutComments(file.text) }));
  const source = sourceFiles.map((file) => file.source).join('\n');
  const filenameFor = (snippet) =>
    sourceFiles.find((file) => file.source.includes(snippet))?.path ?? 'pkg/features/unknown.go';
  const names = new Map();
  const channels = new Map([
    ['FeatureChannelStandard', 'standard'],
    ['FeatureChannelExperimental', 'experimental'],
  ]);
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s+FeatureName\s*=\s*"([^"]+)"/g))
    names.set(match[1], match[2]);
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s+FeatureChannel\s*=\s*"([^"]+)"/g))
    channels.set(match[1], match[2]);
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*"([^"]+)"/g)) {
    if (!names.has(match[1])) names.set(match[1], match[2]);
  }

  const resolveFeature = (literal, filename) => {
    const namedName = literal.match(/\bName\s*:\s*([^,}\n]+)/)?.[1]?.trim();
    const namedChannel = literal.match(/\bChannel\s*:\s*([^,}\n]+)/)?.[1]?.trim();
    const positional = literal
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const rawName = namedName ?? positional[0];
    const rawChannel = namedChannel ?? positional[1];
    if (!rawName || !rawChannel) throw new Error(`Unsupported Feature literal in ${filename}.`);
    const nameMatch = rawName.match(/^FeatureName\("([^"]+)"\)$/);
    const featureName = nameMatch ? nameMatch[1] : names.get(rawName);
    const directChannel =
      rawChannel.match(/^FeatureChannel\("(standard|experimental)"\)$/)?.[1] ??
      rawChannel.replace(/^"|"$/g, '');
    const channel = channels.get(rawChannel) ?? directChannel;
    if (!featureName) throw new Error(`Unresolved feature name ${rawName} in ${filename}.`);
    if (channel !== 'standard' && channel !== 'experimental')
      throw new Error(`Unknown feature channel ${rawChannel} for ${featureName} in ${filename}.`);
    return { name: featureName, channel };
  };

  const namedFeatures = new Map();
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*Feature\s*\{/g)) {
    const body = braced(source, match.index + match[0].lastIndexOf('{'));
    namedFeatures.set(match[1], resolveFeature(body, filenameFor(body)));
  }

  const sets = new Map();
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*sets\.New(?:\[Feature\])?\s*\(/g)) {
    if (match[1] === 'AllFeatures') continue;
    const body = parenthesized(source, match.index + match[0].lastIndexOf('('));
    const features = [];
    const literalSpans = [];
    for (const literal of body.matchAll(/Feature\s*\{/g)) {
      const opening = literal.index + literal[0].lastIndexOf('{');
      const content = braced(body, opening);
      literalSpans.push([literal.index, opening + content.length + 2]);
      features.push(resolveFeature(content, filenameFor(content)));
    }
    let remaining = body;
    for (const [start, end] of literalSpans.reverse())
      remaining = `${remaining.slice(0, start)}${remaining.slice(end)}`;
    for (const name of remaining
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const feature = namedFeatures.get(name);
      if (!feature)
        throw new Error(`${filenameFor(body)} has unsupported feature set expression ${name}.`);
      features.push(feature);
    }
    if (features.length === 0)
      throw new Error(`${filenameFor(body)} feature set ${match[1]} is empty or unresolved.`);
    sets.set(match[1], features);
  }

  const allMatch = source.match(/\bAllFeatures\s*=\s*sets\.New(?:\[Feature\])?\s*\(\)/);
  if (!allMatch || allMatch.index === undefined)
    throw new Error('pkg/features/features.go has no resolvable AllFeatures declaration.');
  const until = source.indexOf('\n\n', allMatch.index);
  const allExpression = source.slice(allMatch.index, until === -1 ? source.length : until);
  const setNames = [
    ...allExpression.matchAll(/\.\s*Insert\(\s*([A-Za-z_]\w*)\.UnsortedList\(\)\.\.\.\s*\)/g),
  ].map((match) => match[1]);
  if (setNames.length === 0)
    throw new Error(
      `${filenameFor(allExpression)} AllFeatures does not reference any feature sets.`,
    );

  const features = new Map();
  for (const setName of setNames) {
    const set = sets.get(setName);
    if (!set)
      throw new Error(
        `${filenameFor(allExpression)} AllFeatures references unresolved feature set ${setName}.`,
      );
    for (const feature of set) {
      const existing = features.get(feature.name);
      if (existing && existing.channel !== feature.channel)
        throw new Error(`Feature ${feature.name} has conflicting channels.`);
      features.set(feature.name, feature);
    }
  }
  return [...features.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchFeatures(tag) {
  const listing = await fetchJson(
    `${githubApi}/contents/pkg/features?ref=${tag}`,
    `${tag} feature directory`,
  );
  if (!Array.isArray(listing)) throw new Error(`${tag} feature directory is not a file listing.`);
  const entries = listing
    .filter(
      (entry) =>
        plainObject(entry) &&
        typeof entry.name === 'string' &&
        entry.name.endsWith('.go') &&
        !entry.name.endsWith('_test.go') &&
        typeof entry.path === 'string',
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length === 0) throw new Error(`${tag} has no feature source files.`);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const url = sourceUrl(tag, entry.path);
      const bytes = await fetchBytes(url, `${tag} ${entry.path}`);
      return { path: entry.path, url, sha256: sha256(bytes), text: bytes.toString('utf8') };
    }),
  );
  return {
    features: featureCatalog(files),
    featureFiles: files.map(({ url, sha256: digest }) => ({ url, sha256: digest })),
  };
}

function buildSchema(tag, crds) {
  const definitions = {};
  const guards = [];
  const groupBranches = new Map();
  for (const crd of crds) {
    for (const version of crd.versions.filter((version) => version.served)) {
      const apiVersion = `${crd.group}/${version.name}`;
      const key = `${crd.group}/${version.name}/${crd.kind}`;
      definitions[key] = normalizeResourceSchema(version.schema);
      const discriminator = {
        required: ['apiVersion', 'kind'],
        properties: {
          apiVersion: { const: apiVersion },
          kind: { const: crd.kind },
        },
      };
      guards.push({
        if: discriminator,
        then: { $ref: `#/definitions/${key.replace(/~/g, '~0').replace(/\//g, '~1')}` },
      });
      if (!groupBranches.has(crd.group)) groupBranches.set(crd.group, []);
      groupBranches.get(crd.group).push({
        required: ['apiVersion', 'kind'],
        properties: { apiVersion: { const: apiVersion }, kind: { const: crd.kind } },
      });
    }
  }
  const groupGuards = gatewayGroups.map((group) => ({
    if: {
      required: ['apiVersion'],
      properties: { apiVersion: { pattern: `^${group.replaceAll('.', '\\.')}/` } },
    },
    then: { anyOf: groupBranches.get(group) ?? [{ not: {} }] },
  }));

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `inmemory://schema/gateway-api/${tag}.json`,
    title: `Gateway API ${tag} manifest`,
    type: ['object', 'null'],
    required: ['apiVersion', 'kind', 'metadata'],
    properties: {
      apiVersion: { type: 'string' },
      kind: { type: 'string' },
      metadata: metadataSchema(),
    },
    additionalProperties: true,
    definitions,
    allOf: [...groupGuards, ...guards],
  };
}

async function generateRelease(release) {
  const metadata = await fetchJson(
    `${githubApi}/releases/tags/${release.tag}`,
    `${release.tag} release metadata`,
  );
  if (
    !plainObject(metadata) ||
    metadata.tag_name !== release.tag ||
    !Array.isArray(metadata.assets)
  ) {
    throw new Error(`Release metadata for ${release.tag} did not match its pin.`);
  }
  const expectedAssets = new Map(metadata.assets.map((asset) => [asset?.name, asset]));
  const acquireAsset = async (name) => {
    const asset = expectedAssets.get(name);
    if (
      !plainObject(asset) ||
      (asset.digest !== null &&
        typeof asset.digest !== 'undefined' &&
        typeof asset.digest !== 'string')
    ) {
      throw new Error(`Release ${release.tag} has no valid ${name} asset metadata.`);
    }
    const url = `https://github.com/kubernetes-sigs/gateway-api/releases/download/${release.tag}/${name}`;
    const bytes = await fetchBytes(url, `${release.tag} ${name}`);
    const digest = sha256(bytes);
    if (typeof asset.digest === 'string' && asset.digest !== `sha256:${digest}`) {
      throw new Error(`${release.tag} ${name} digest differs from the official release metadata.`);
    }
    return { bytes, source: { url, sha256: digest } };
  };
  const [standard, experimental, featureData] = await Promise.all([
    acquireAsset('standard-install.yaml'),
    acquireAsset('experimental-install.yaml'),
    fetchFeatures(release.tag),
  ]);
  const standardCrds = crdsFromAsset(
    standard.bytes,
    release.tag,
    `${release.tag} standard-install.yaml`,
  );
  const experimentalCrds = crdsFromAsset(
    experimental.bytes,
    release.tag,
    `${release.tag} experimental-install.yaml`,
  );
  assertNoDuplicateVersions(standardCrds, `${release.tag} standard-install.yaml`);
  assertNoDuplicateVersions(experimentalCrds, `${release.tag} experimental-install.yaml`);
  const standardKinds = new Set(standardCrds.map((crd) => `${crd.group}/${crd.kind}`));
  const crds = experimentalCrds
    .map((crd) => ({
      ...crd,
      channel: standardKinds.has(`${crd.group}/${crd.kind}`) ? 'standard' : 'experimental',
      servedVersions: crd.versions
        .filter((version) => version.served)
        .map((version) => version.name),
      unservedVersions: crd.versions
        .filter((version) => !version.served)
        .map((version) => version.name),
      storageVersion: crd.versions.find((version) => version.storage).name,
    }))
    .sort((left, right) =>
      `${left.group}/${left.kind}`.localeCompare(`${right.group}/${right.kind}`),
    );

  return {
    id: release.id,
    tag: release.tag,
    attribution: {
      license: sourceLicense,
      upstream: `https://github.com/kubernetes-sigs/gateway-api/releases/tag/${release.tag}`,
    },
    schema: buildSchema(release.tag, crds),
    crds: crds.map(
      ({ group, kind, scope, channel, servedVersions, unservedVersions, storageVersion }) => ({
        group,
        kind,
        scope,
        channel,
        servedVersions,
        unservedVersions,
        storageVersion,
      }),
    ),
    features: featureData.features,
    sources: {
      standard: standard.source,
      experimental: experimental.source,
      featureFiles: featureData.featureFiles,
    },
  };
}

export async function generateGatewayApiBundles() {
  const bundles = await Promise.all(releases.map(generateRelease));
  await mkdir(outputDirectory, { recursive: true });
  const staged = [];
  try {
    for (const bundle of bundles) {
      const finalPath = resolve(outputDirectory, `${bundle.tag}.json`);
      const temporaryPath = `${finalPath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`);
      staged.push({ temporaryPath, finalPath });
    }
    for (const { temporaryPath, finalPath } of staged) await rename(temporaryPath, finalPath);
  } catch (error) {
    await Promise.all(staged.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
    throw error;
  }
  return bundles.map((bundle) => ({
    tag: bundle.tag,
    crds: bundle.crds.length,
    features: bundle.features.length,
  }));
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  generateGatewayApiBundles()
    .then((summary) => {
      for (const item of summary)
        console.log(`${item.tag}: ${item.crds} CRDs, ${item.features} features`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
