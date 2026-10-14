import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { isModelProvider, type ModelTarget } from '../../ai/providers';
import type { KeyCipher } from '../../connections/crypto';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';

interface ModelTargetRow {
  model: string;
  provider: string;
  encryptedKey: string;
  baseUrl: string | null;
}

// The AI's own provider connection, keyed by the AI id the gateway owns. The
// join is scoped to the AI's owner (`pc.owner = ais.owner`) so a connection can
// never be borrowed across owners, and only an `active` connection counts.
// The key is decrypted in memory for one turn: never stored, logged or
// returned, and added to the turn's redaction secrets by the caller. `null`
// means "no usable connection": the turn is skipped, never thrown.
export async function loadModelTarget(
  db: ServerDatabase,
  cipher: KeyCipher,
  aiId: string,
): Promise<ModelTarget | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ModelTargetRow>`SELECT ais.model, pc.provider, pc.encrypted_key, pc.base_url
        FROM ais
        INNER JOIN provider_connections pc
          ON pc.id = ais.provider_connection_id AND pc.owner = ais.owner
        WHERE ais.id = ${aiId} AND pc.status = 'active'
        LIMIT 1`;
    }),
  );
  if (row === undefined || !isModelProvider(row.provider)) {
    return null;
  }
  // T-1396: a custom provider always carries its validated base URL; without
  // one there is no model to call, so the turn is skipped like a missing key.
  if (row.provider === 'openai-compatible' && row.baseUrl === null) {
    return null;
  }
  const apiKey = cipher.decrypt(row.encryptedKey);
  return {
    provider: row.provider,
    apiKey,
    model: row.model,
    ...(row.baseUrl === null ? {} : { apiUrl: row.baseUrl }),
  };
}
