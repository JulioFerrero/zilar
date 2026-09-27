import { Hono } from 'hono';
import { protocolVersion } from '@galena/protocol';
import { serverVersion } from './version';

export const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    name: 'galena-server',
    version: serverVersion,
    protocolVersion,
  }),
);
