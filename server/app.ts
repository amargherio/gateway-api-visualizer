import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import * as formats from 'ajv-formats';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';

import { classifyResources, isGatewayApiObject } from '../src/lib/manifestAnalysis.js';
import { containsPotentialSecrets } from '../src/lib/secretDetection.js';
import { buildFullGraph, type CoverageGraph } from '../src/lib/shared.js';
import { gatewayApiReleases, type GatewayApiBundle, type GatewayApiVersion } from '../src/lib/gatewayApi.js';
import {
  analyzeRequestSchema,
  analyzeResponseSchema,
  apiErrorSchema,
  openApiDocument,
  type AnalyzeRequest,
  type ApiErrorCode,
} from './contracts.js';
import { loadApiBundleFromDisk } from './gatewayApiBundle.js';

const MAX_BODY_BYTES = 1024 * 1024;
const validators = new Map<GatewayApiVersion, ValidateFunction>();

interface CompatibilityDiagnostic {
  resourceIndex: number;
  path: string;
  severity: 'error';
  message: string;
}

interface AnalyzeResponse {
  gatewayApiVersion: GatewayApiVersion;
  releaseTag: string;
  resourceDiagnostics: ReturnType<typeof classifyResources>['diagnostics'];
  compatibilityDiagnostics: CompatibilityDiagnostic[];
  secretDetection: ReturnType<typeof containsPotentialSecrets>;
  support: {
    crds: Array<{ kind: string; channel: 'standard' | 'experimental'; servedVersions: string[] }>;
    features: Array<{ name: string; channel: 'standard' | 'experimental' }>;
  };
  graph: CoverageGraph | null;
}

function createSchemaValidator(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const addFormats = formats.default as unknown as (target: Ajv) => void;
  addFormats(ajv);
  ajv.addFormat('int32', {
    type: 'number',
    validate: (value: number) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
  });
  ajv.addFormat('int64', {
    type: 'number',
    validate: (value: number) => Number.isSafeInteger(value),
  });
  return ajv;
}

const schemaAjv = createSchemaValidator();

function isSupportedVersion(value: string): value is GatewayApiVersion {
  return gatewayApiReleases.some((release) => release.id === value);
}

function gatewayApiIdentity(resource: Record<string, unknown>): { group: string; version: string } | null {
  const apiVersion = resource.apiVersion;
  if (typeof apiVersion !== 'string' || !isGatewayApiObject(resource)) return null;
  const [group, ...versionParts] = apiVersion.split('/');
  return { group, version: versionParts.join('/') };
}

function encodePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function schemaDiagnosticPath(resourceIndex: number, error: ErrorObject): string {
  let path = `/resources/${resourceIndex}${error.instancePath}`;
  if (error.keyword === 'required') {
    const missingProperty = (error.params as { missingProperty?: unknown }).missingProperty;
    if (typeof missingProperty === 'string') path += `/${encodePointerSegment(missingProperty)}`;
  }
  return path || `/resources/${resourceIndex}`;
}

function schemaDiagnosticMessage(error: ErrorObject): string {
  return error.message ? `Schema validation: ${error.message}` : 'Schema validation failed.';
}

async function validatorFor(version: GatewayApiVersion, bundle: GatewayApiBundle): Promise<ValidateFunction> {
  const cached = validators.get(version);
  if (cached) return cached;
  const validator = schemaAjv.compile(bundle.schema);
  validators.set(version, validator);
  return validator;
}

async function findCompatibilityDiagnostics(
  resources: Record<string, unknown>[],
  version: GatewayApiVersion,
  bundle: GatewayApiBundle,
): Promise<CompatibilityDiagnostic[]> {
  const validator = await validatorFor(version, bundle);
  const diagnostics: CompatibilityDiagnostic[] = [];

  for (const [resourceIndex, resource] of resources.entries()) {
    const identity = gatewayApiIdentity(resource);
    if (!identity) continue;

    const kind = typeof resource.kind === 'string' ? resource.kind : null;
    if (kind) {
      const crd = bundle.crds.find((candidate) => candidate.group === identity.group && candidate.kind === kind);
      if (!crd || !crd.servedVersions.includes(identity.version)) {
        diagnostics.push({
          resourceIndex,
          path: `/resources/${resourceIndex}/apiVersion`,
          severity: 'error',
          message: `Gateway API ${resource.apiVersion} ${kind} is not served by release ${version}.`,
        });
        continue;
      }
    }

    if (!validator(resource)) {
      for (const error of validator.errors ?? []) {
        diagnostics.push({
          resourceIndex,
          path: schemaDiagnosticPath(resourceIndex, error),
          severity: 'error',
          message: schemaDiagnosticMessage(error),
        });
      }
    }
  }

  return diagnostics;
}

function projectSupport(bundle: GatewayApiBundle): AnalyzeResponse['support'] {
  return {
    crds: bundle.crds.map((crd) => ({
      kind: crd.kind,
      channel: crd.channel,
      servedVersions: crd.servedVersions,
    })),
    features: bundle.features.map((feature) => ({ name: feature.name, channel: feature.channel })),
  };
}

function errorBody(code: ApiErrorCode, message: string) {
  return { error: { code, message } };
}

function isUnsupportedVersionError(error: FastifyError): boolean {
  const validation = error.validation as Array<{ instancePath?: unknown; keyword?: unknown }> | undefined;
  return Boolean(validation?.some((issue) => issue.instancePath === '/gatewayApiVersion' && issue.keyword === 'enum'))
    && !validation?.some((issue) => issue.instancePath === '/gatewayApiVersion' && issue.keyword === 'type');
}

function asFastifyError(error: unknown): FastifyError | null {
  // Fastify forwards ordinary Error instances to this handler with its additional fields.
  return error instanceof Error ? error as FastifyError : null;
}

function sendError(reply: FastifyReply, statusCode: number, code: ApiErrorCode, message: string): FastifyReply {
  return reply.code(statusCode).send(errorBody(code, message));
}

export function buildApiApp(): FastifyInstance {
  const app = Fastify({ bodyLimit: MAX_BODY_BYTES, logger: false });
  app.setValidatorCompiler(({ schema }) => schemaAjv.compile(schema));

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.raw.url?.split('?')[0];
    const contentType = request.headers['content-type'];
    if (
      request.method === 'POST' &&
      pathname === '/api/analyze' &&
      (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
    ) {
      return sendError(reply, 415, 'unsupported_media_type', 'Content-Type must be application/json.');
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = asFastifyError(error);
    if (fastifyError?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return sendError(reply, 413, 'payload_too_large', 'Request body exceeds the 1 MiB limit.');
    }
    if (fastifyError?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendError(reply, 415, 'unsupported_media_type', 'Content-Type must be application/json.');
    }
    if (fastifyError?.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return sendError(reply, 400, 'invalid_json', 'Request body is not valid JSON.');
    }
    if (fastifyError?.validation) {
      if (isUnsupportedVersionError(fastifyError)) {
        return sendError(reply, 400, 'unsupported_version', 'Gateway API version is not supported.');
      }
      return sendError(reply, 400, 'invalid_request', 'Request body does not match the API contract.');
    }
    return sendError(reply, 500, 'internal_error', 'An unexpected server error occurred.');
  });

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, 'not_found', 'The requested API endpoint does not exist.'),
  );

  app.get('/api/schema', async () => openApiDocument);

  app.post(
    '/api/analyze',
    {
      schema: {
        body: analyzeRequestSchema,
        response: {
          200: analyzeResponseSchema,
          400: apiErrorSchema,
          413: apiErrorSchema,
          415: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request): Promise<AnalyzeResponse> => {
      const body = request.body as AnalyzeRequest;
      const version = body.gatewayApiVersion;
      if (!isSupportedVersion(version)) {
        // The request schema normally handles this branch. Keep it explicit for callers using a custom validator.
        throw new Error('Unsupported Gateway API version.');
      }

      const bundle = await loadApiBundleFromDisk(version);
      const classification = classifyResources(body.resources);
      const compatibilityDiagnostics = await findCompatibilityDiagnostics(body.resources, version, bundle);
      const categorized = classification.categorized;
      const graph = classification.diagnostics.length
        ? null
        : buildFullGraph({
            gateways: categorized.gateways,
            routes: categorized.routes,
            services: categorized.services,
            deployments: categorized.deployments,
            statefulSets: categorized.statefulSets,
            daemonSets: categorized.daemonSets,
            gatewayClasses: categorized.gatewayClasses,
            referenceGrants: categorized.referenceGrants,
          });

      return {
        gatewayApiVersion: version,
        releaseTag: bundle.tag,
        resourceDiagnostics: classification.diagnostics,
        compatibilityDiagnostics,
        secretDetection: containsPotentialSecrets(JSON.stringify(body.resources), body.resources),
        support: projectSupport(bundle),
        graph,
      };
    },
  );

  return app;
}
