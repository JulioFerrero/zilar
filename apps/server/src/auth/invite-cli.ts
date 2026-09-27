import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { loadServerConfigOrExit } from '../config';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createInvite, DEFAULT_INVITE_MAX_USES, DEFAULT_INVITE_TTL_DAYS } from './invites';

const inviteCliOptionsSchema = z.object({
  uses: z.coerce.number().int().min(1).max(1000).default(DEFAULT_INVITE_MAX_USES),
  days: z.coerce.number().int().min(1).max(365).default(DEFAULT_INVITE_TTL_DAYS),
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

  return inviteCliOptionsSchema.parse(raw);
}

async function main(): Promise<void> {
  const options = parseInviteCliArgs(process.argv.slice(2));
  const config = loadServerConfigOrExit(process.env);
  const { db, close } = createDb(config.DATABASE_URL);

  try {
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
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
