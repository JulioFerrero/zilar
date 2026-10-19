import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { WEB_CAPABILITIES, WEB_SEARCH_PROVIDER_IDS } from '@zilar/api-contract';
import { isModelProvider, type ModelTarget } from '../../ai/providers';
import type { KeyCipher } from '../../connections/crypto';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { webSource, type WebSource } from '../../web-tools/sources';

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
  if (row === undefined) {
    return null;
  }
  // A catalog provider is not in `MODEL_PROVIDERS` but stores its base URL at
  // create, so it runs through the pinned OpenAI-compatible path. Its usage and
  // prices stay keyed by its own id (`usageProvider`).
  if (!isModelProvider(row.provider)) {
    if (row.baseUrl === null) {
      return null;
    }
    return {
      provider: 'openai-compatible',
      apiKey: cipher.decrypt(row.encryptedKey),
      model: row.model,
      apiUrl: row.baseUrl,
      usageProvider: row.provider,
    };
  }
  // A custom provider always carries its validated base URL; without one there
  // is no model to call, so the turn is skipped like a missing key.
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

interface WebKeyRow {
  provider: string;
  encryptedKey: string;
}

// A DeepSeek AI uses its model provider's own web tools. Every other AI uses
// the owner's first active web search key that has the needed capability,
// oldest connection first. Only that one key is decrypted.
export async function loadWebSource(
  db: ServerDatabase,
  cipher: KeyCipher,
  aiId: string,
  need: 'search' | 'read',
): Promise<WebSource | null> {
  const target = await loadModelTarget(db, cipher, aiId);
  if (target !== null && target.provider === 'deepseek') {
    return webSource('deepseek', target.apiKey);
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<WebKeyRow>`SELECT pc.provider, pc.encrypted_key
        FROM ais
        INNER JOIN provider_connections pc ON pc.owner = ais.owner
        WHERE ais.id = ${aiId} AND pc.status = 'active'
          AND pc.provider IN ${sql.in(WEB_SEARCH_PROVIDER_IDS)}
        ORDER BY pc.created_at ASC`;
    }),
  );
  for (const row of rows) {
    if (WEB_CAPABILITIES[row.provider]?.[need] === true) {
      return webSource(row.provider, cipher.decrypt(row.encryptedKey));
    }
  }
  return null;
}
