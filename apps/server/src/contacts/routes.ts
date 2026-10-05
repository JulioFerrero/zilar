import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { listContacts } from './service';

export interface ContactsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
}

export function createContactsRoutes({ auth, db, config }: ContactsRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/contacts', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const contacts = await listContacts(db, user.id, config.xmpp.domain);
    return c.json(contacts);
  });

  return routes;
}
