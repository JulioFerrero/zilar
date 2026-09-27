import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadServerConfig } from '../config';
import * as schema from '../db/schema';
import { createAuth } from './auth';
import type { Mailer } from './mailer';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

const noopMailer: Mailer = {
  sendOtp: async () => {},
};

const noopAdminClient: EjabberdAdminClient = {
  registerUser: async () => ({ created: false }),
  userExists: async () => false,
  changePassword: async () => {},
  createRoom: async () => ({ created: false }),
  setAffiliation: async () => {},
  getAffiliations: async () => [],
  destroyRoom: async () => {},
  addRosterItem: async () => {},
  deleteRosterItem: async () => {},
  getRoster: async () => [],
};

const config = loadServerConfig({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://galena:CHANGE_ME@127.0.0.1:5432/galena',
  BETTER_AUTH_SECRET: 'schema-generation-placeholder-secret-0000000000',
  EJABBERD_ADMIN_JID: 'admin@galena.localhost',
  EJABBERD_ADMIN_PASSWORD: 'CHANGE_ME',
  GALENA_XMPP_JWT_SECRET: 'schema-generation-placeholder-xmpp-secret-000',
});

const db = drizzle(postgres(config.DATABASE_URL, { max: 1 }), { schema });

export const auth = createAuth({ db, config, mailer: noopMailer, adminClient: noopAdminClient });
