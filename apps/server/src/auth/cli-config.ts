import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadServerConfig } from '../config';
import * as schema from '../db/schema';
import { createAuth } from './auth';
import type { Mailer } from './mailer';

const noopMailer: Mailer = {
  sendOtp: async () => {},
};

const config = loadServerConfig({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://galena:CHANGE_ME@127.0.0.1:5432/galena',
  BETTER_AUTH_SECRET: 'schema-generation-placeholder-secret-0000000000',
});

const db = drizzle(postgres(config.DATABASE_URL, { max: 1 }), { schema });

export const auth = createAuth({ db, config, mailer: noopMailer });
