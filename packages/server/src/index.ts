import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { buildCoverageGraph, Gateway, AnyRoute } from '@gav/shared';
import { loadAll } from 'js-yaml';
import { watch } from 'chokidar';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

// Narrow a raw parsed object to Gateway or AnyRoute based on discriminant fields.
function isGateway(obj: unknown): obj is Gateway {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'kind' in obj &&
    (obj as Record<string, unknown>).kind === 'Gateway'
  );
}
function isRoute(obj: unknown): obj is AnyRoute {
  if (!(typeof obj === 'object' && obj !== null && 'kind' in obj)) return false;
  const kind = (obj as Record<string, unknown>).kind;
  return (
    kind === 'HTTPRoute' ||
    kind === 'TLSRoute' ||
    kind === 'TCPRoute' ||
    kind === 'GRPCRoute'
  );
}

function parseYamlDocuments(raw: string): unknown[] {
  // js-yaml loadAll returns any[]; we re-type it to unknown[] to enforce explicit narrowing later.
  return loadAll(raw) as unknown[];
}

function loadResources(): { gateways: Gateway[]; routes: AnyRoute[] } {
  const gateways: Gateway[] = [];
  const routes: AnyRoute[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(DATA_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch {
    return { gateways, routes };
  }
  for (const f of files) {
    const raw = readFileSync(join(DATA_DIR, f), 'utf8');
    const docs = parseYamlDocuments(raw);
    for (const doc of docs) {
      if (isGateway(doc)) gateways.push(doc);
      else if (isRoute(doc)) routes.push(doc);
    }
  }
  return { gateways, routes };
}

let currentGraph = buildCoverageGraph([], []);

function rebuild() {
  const { gateways, routes } = loadResources();
  currentGraph = buildCoverageGraph(gateways, routes);
}

rebuild();

const app = Fastify();

app.get('/api/graph', async () => currentGraph);

app.get('/api/events', async (request: FastifyRequest, reply: FastifyReply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  const interval = setInterval(() => {
    reply.raw.write(`event: ping\ndata: {}\n\n`);
  }, 30000);
  const send = () => {
    reply.raw.write(`event: graph\ndata: ${JSON.stringify(currentGraph)}\n\n`);
  };
  send();
  const watcher = watch(DATA_DIR, { ignoreInitial: true });
  const onChange = () => {
    rebuild();
    send();
  };
  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
  request.raw.on('close', () => {
    clearInterval(interval);
    watcher.close();
  });
  return reply;
});

app.get('/', async () => ({ status: 'ok' }));

app
  .listen({ port: Number(process.env.PORT) || 4000, host: '0.0.0.0' })
  .then(addr => {
    console.log('Server listening', addr);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
