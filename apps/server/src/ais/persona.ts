import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AiComputerMode } from '@zilar/api-contract';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { defaultPersonaFor, type AiTemplate } from './templates';

export interface AiLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AiLimits {
  perDayUsd: number | null;
  perMonthUsd: number | null;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // `stopped` is the kill switch; `disabled` means provisioning in progress, so
  // a resume can never flip a half-built AI to active.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  // The home machine id, or null when it runs on the platform.
  machineId: string | null;
  // Where the AI's desk runs (`off` by default); the column also allows
  // `runner` and `auto`.
  computerMode: AiComputerMode;
  // Delegation opt-ins, both off by default.
  canDelegate: boolean;
  acceptsDelegation: boolean;
  // Attached at read time; absent (not null) when none, like the chat list.
  avatarUrl?: string | undefined;
  createdAt: Date;
}

export interface AiServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  cipher: KeyCipher;
  logger: AiLogger;
  domain: string;
}

export interface CreateAiInput {
  ownerId: string;
  name: string;
  template: AiTemplate;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  id: string;
  ownerId: string;
  name?: string;
  persona?: string;
  limits?: AiLimits;
  model?: string;
  providerConnectionId?: string;
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
  // `runner` and `auto` need an assigned machine; `updateAi` answers 400 otherwise.
  computerMode?: AiComputerMode;
}

// Matches the API ceiling, so a chat-driven change cannot store more than the
// routes accept.
export const CHAT_PERSONA_MAX_LENGTH = 4000;

// The AI id comes from the gateway's session, never from the model's
// arguments, and only the persona columns change.
export async function setPersonaFromChat(
  db: ServerDatabase,
  aiId: string,
  persona: string,
): Promise<string> {
  const trimmed = persona.trim().slice(0, CHAT_PERSONA_MAX_LENGTH);
  if (trimmed === '') {
    throw new Error('persona must not be empty');
  }
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<{ persona: string }>`SELECT persona FROM ais
            WHERE id = ${aiId} LIMIT 1`;
          if (!row) {
            return yield* Effect.fail(new Error(`AI ${aiId} not found`));
          }
          yield* sql`UPDATE ais
            SET previous_persona = ${row.persona}, persona = ${trimmed}, updated_at = ${new Date()}
            WHERE id = ${aiId}`;
        }),
      );
    }),
  );
  return trimmed;
}

// Swaps the two personas, so a second undo re-applies the change (a toggle,
// one level deep).
export async function revertPersonaFromChat(
  db: ServerDatabase,
  aiId: string,
): Promise<'restored' | 'nothing to undo'> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<{
            persona: string;
            previousPersona: string | null;
          }>`SELECT persona, previous_persona FROM ais
            WHERE id = ${aiId} LIMIT 1`;
          if (!row) {
            return yield* Effect.fail(new Error(`AI ${aiId} not found`));
          }
          if (row.previousPersona === null) {
            return 'nothing to undo' as const;
          }
          yield* sql`UPDATE ais
            SET persona = ${row.previousPersona}, previous_persona = ${row.persona}, updated_at = ${new Date()}
            WHERE id = ${aiId}`;
          return 'restored' as const;
        }),
      );
    }),
  );
}

export function resolvePersona(template: AiTemplate, persona: string | undefined): string {
  const trimmed = persona?.trim() ?? '';
  if (trimmed !== '') {
    return trimmed;
  }
  if (template === 'custom') {
    throw new HttpError(400, 'invalid_request', 'A custom AI needs a persona');
  }
  return defaultPersonaFor(template);
}

// Fixed messages: no gateway or chat-service detail (which could echo a key)
// reaches the client.
export function provisioningFailed(): HttpError {
  return new HttpError(502, 'ai_provisioning_failed', 'The AI could not be provisioned');
}

export function updateFailed(): HttpError {
  return new HttpError(502, 'ai_update_failed', 'The AI could not be updated');
}

export function teardownFailed(): HttpError {
  return new HttpError(502, 'ai_teardown_failed', 'The AI could not be deleted; try again');
}
