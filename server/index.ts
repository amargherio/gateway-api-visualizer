import { buildApiApp } from './app.js';

const app = buildApiApp();
const configuredPort = Number(process.env.PORT ?? 3001);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3001;

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  console.error('Gateway API analysis service failed to start.', error);
  process.exitCode = 1;
}
