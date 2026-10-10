import { Effect, Schema, SchemaGetter } from 'effect';
import { pathToFileURL } from 'node:url';
import { loadServerConfigOrExit } from '../config';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { disposeSqlRuntime, registerSqlRuntime } from '../effect/sql';
import { createInvite, DEFAULT_INVITE_MAX_USES, DEFAULT_INVITE_TTL_DAYS } from './invites';

// Replaces `z.coerce.number().int()`: `Number(value)` (so `'2.5'` fails the
// integer check and `'abc'` fails as `NaN`), then the bounds. The decoded
// default is the encoded string of the same constant.
const toInt = SchemaGetter.transform((value: string) => Number(value));
const toText = SchemaGetter.transform((value: number) => String(value));

function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

function coercedInt(min: number, max: number) {
  return Schema.String.pipe(
    Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
    Schema.check(Schema.isGreaterThanOrEqualTo(min)),
    Schema.check(Schema.isLessThanOrEqualTo(max)),
  );
}

const inviteCliOptionsSchema = Schema.Struct({
  uses: withDefault(coercedInt(1, 1000), String(DEFAULT_INVITE_MAX_USES)),
  days: withDefault(coercedInt(1, 365), String(DEFAULT_INVITE_TTL_DAYS)),
});

export interface InviteCliOptions {
  uses: number;
  days: number;
}

export function parseInviteCliArgs(argv: string[]): InviteCliOptions {
  const raw: { uses?: string; days?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--uses' || argument === '--days') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${argument}`);
      }
      if (argument === '--uses') {
        raw.uses = value;
      } else {
        raw.days = value;
      }
      index += 1;
      continue;
    }
    if (argument?.startsWith('--uses=')) {
      raw.uses = argument.slice('--uses='.length);
      continue;
    }
    if (argument?.startsWith('--days=')) {
      raw.days = argument.slice('--days='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ''}`);
  }

  return Schema.decodeUnknownSync(inviteCliOptionsSchema)(raw);
}

async function main(): Promise<void> {
  const options = parseInviteCliArgs(process.argv.slice(2));
  const config = loadServerConfigOrExit(process.env);
  const { db, close } = createDb(config.DATABASE_URL);

  try {
    // The migrator and `createInvite` both run on `effect/sql`; this process
    // never builds an app, so it registers (and below disposes) the runtime for
    // its own database before the first query.
    registerSqlRuntime(db, config.DATABASE_URL);
    await runMigrations(db);
    const invite = await createInvite(db, {
      createdBy: null,
      maxUses: options.uses,
      expiresInDays: options.days,
    });

    console.log(`Invite link: ${config.PUBLIC_URL}/invite/${invite.code}`);
    console.log(`Code: ${invite.code}`);
    console.log(`Expires at: ${invite.expiresAt.toISOString()}`);
    console.log(`Maximum uses: ${invite.maxUses}`);
  } finally {
    // Dispose the `effect/sql` pool, which owns the connections, before closing.
    await disposeSqlRuntime(db);
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
