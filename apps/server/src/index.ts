import { serve } from '@hono/node-server';
import { app } from './app';

const port = parsePort(process.env.PORT);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`galena-server listening on http://localhost:${info.port}`);
});

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return 3000;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return parsed;
}
