import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { LitellmAdminClient } from '../ai/litellm-client';
import { defaultPersonaFor, type AiTemplate } from './templates';

export interface AiLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AiLimits {
  perDayUsd: number;
  perMonthUsd: number;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // `stopped` is the kill-switch (T-0080): the owner paused the AI. It is
  // distinct from `disabled` (provisioning in progress), so a resume can
  // never be allowed to flip a half-built AI to `active`.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  // T-0091: the AI's home machine id, or null when it runs on the platform.
  // CamelCase like the rest of the public AI fields.
  machineId: string | null;
  // T-0474: delegation opt-ins (plan §8, decision 3). `canDelegate` lets the
  // AI hand out tasks; `acceptsDelegation` lets it receive them. Both off by
  // default.
  canDelegate: boolean;
  acceptsDelegation: boolean;
  // T-0165: the AI's picture, when it has one. Attached at read time by
  // the routes; absent (not null) when none, like the chat list.
  avatarUrl?: string | undefined;
  createdAt: Date;
}

export interface AiServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  litellm: LitellmAdminClient;
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
  // T-0474: the two delegation opt-ins, owner only like the rest.
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
}

// The persona ceiling the API enforces (`CreateAiSchema`), repeated here so a
// chat-driven change can never store more than the routes accept.
export const CHAT_PERSONA_MAX_LENGTH = 4000;

// Shapes an AI's persona from its DM, for the gateway only. The AI id always
// comes from the gateway's own session, never from the model's arguments, and
// only `persona`/`previous_persona` change: the model, limits, keys and name
// are untouched. In one transaction the current persona is kept as
// `previous_persona` and the new one stored. Returns the stored persona.
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

// Undoes the latest chat-driven persona change, for the gateway only. When
// there is nothing to undo it returns `"nothing to undo"` and stores nothing.
// Otherwise it swaps the two, so a second undo re-applies the change (a
// toggle, one level deep).
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
// ever reaches the client.
export function provisioningFailed(): HttpError {
  return new HttpError(502, 'ai_provisioning_failed', 'The AI could not be provisioned');
}

export function updateFailed(): HttpError {
  return new HttpError(502, 'ai_update_failed', 'The AI could not be updated');
}

export function teardownFailed(): HttpError {
  return new HttpError(502, 'ai_teardown_failed', 'The AI could not be deleted; try again');
}
