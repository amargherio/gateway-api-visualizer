import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { buildCoverageGraph, Gateway, AnyRoute } from '@gav/shared';
import { loadAll } from 'js-yaml';
import { watch } from 'chokidar';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

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
    const docs = loadAll(raw) as any[];
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;
      if (doc.kind === 'Gateway') gateways.push(doc as Gateway);
      else if (doc.kind === 'HTTPRoute' || doc.kind === 'TLSRoute' || doc.kind === 'TCPRoute' || doc.kind === 'GRPCRoute') routes.push(doc as AnyRoute);
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
