import {
  createLitellmAdminClient,
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
  type LitellmAdminClient,
} from './litellm-client';

// Spike integration run against a live LiteLLM (127.0.0.1:4000 in the dev
// stack). It is skipped unless GALENA_LITELLM_INTEGRATION=1 and exited non-zero
// if any expectation fails. Run it with the dev creds, e.g.:
//
//   GALENA_LITELLM_INTEGRATION=1 pnpm --filter @galena/server exec \
//     tsx --env-file=../../infra/.env src/ai/integration.ts
//
// It never prints the master key or a provider key, and it revokes the virtual
// key it creates (even on failure).

const MASTER_KEY = process.env.LITELLM_MASTER_KEY;
const BASE_URL = (process.env.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL).replace(/\/+$/, '');

const results: Array<{ name: string; ok: boolean }> = [];

function check(name: string, ok: boolean): void {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

function show(value: string): string {
  return redactSecrets(value, MASTER_KEY ? [MASTER_KEY] : []);
}

async function proxyCall(path: string, apiKey: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function main(): Promise<void> {
  if (!MASTER_KEY) {
    console.error('LITELLM_MASTER_KEY is not set');
    process.exitCode = 1;
    return;
  }

  const client: LitellmAdminClient = createLitellmAdminClient({
    baseUrl: BASE_URL,
    masterKey: MASTER_KEY,
  });

  const health = await fetch(`${BASE_URL}/health/liveliness`);
  console.log(`health: HTTP ${health.status} ${await health.text()}`);
  check('proxy is reachable', health.ok);

  const alias = `galena-t0007-${Date.now()}`;
  let key: string | undefined;
  try {
    console.log(`\n-- issue a virtual key (${alias}) with a 0.01 USD hard cap --`);
    const issued = await client.generateKey({
      models: ['placeholder'],
      maxBudget: 0.01,
      budgetDuration: '1d',
      tpmLimit: 100,
      rpmLimit: 60,
      keyAlias: alias,
    });
    key = issued.key;
    console.log(
      `issued: id=${issued.id} key=${show(issued.key)} maxBudget=${issued.maxBudget} models=${issued.models.join(',')}`,
    );
    check('key is issued with the cap stored', issued.maxBudget === 0.01);

    const info = await client.getKeyInfo(issued.key);
    console.log(
      `key info: spend=${info.spend} maxBudget=${info.maxBudget} tpm=${info.tpmLimit} rpm=${info.rpmLimit}`,
    );
    check('cap and rate limits are readable', info.maxBudget === 0.01 && info.tpmLimit === 100);

    console.log('\n-- call the proxy with the virtual key --');
    const models = await proxyCall('/v1/models', issued.key);
    const modelsText = await models.text();
    console.log(`GET /v1/models: HTTP ${models.status} ${show(modelsText).slice(0, 120)}`);
    check('the virtual key authenticates and completes a proxy call', models.status === 200);

    const chat = await proxyCall('/chat/completions', issued.key, {
      model: 'placeholder',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 5,
    });
    const chatText = await chat.text();
    console.log(`POST /chat/completions: HTTP ${chat.status} ${show(chatText).slice(0, 200)}`);
    check(
      'the proxy forwards the call to the configured provider',
      chatText.includes('placeholder') || chatText.includes('AuthenticationError'),
    );

    console.log('\n-- BYOK: a user-supplied provider key is used instead of the platform key --');
    const byok = await proxyCall('/chat/completions', issued.key, {
      model: 'placeholder',
      messages: [{ role: 'user', content: 'hello' }],
      api_key: 'sk-user-owned-fake-provider-key',
    });
    const byokText = await byok.text();
    console.log(`with api_key override: HTTP ${byok.status} ${show(byokText).slice(0, 200)}`);
    console.log(
      `user key forwarded: ${byokText.includes('sk-user')} | platform key reused: ${chatText.includes('sk-user')}`,
    );
    check(
      'LiteLLM forwards the user key, not the platform placeholder key',
      byokText.includes('sk-user') && !chatText.includes('sk-user'),
    );

    console.log('\n-- hard cap: spend above max_budget is rejected --');
    await client.updateKey({ key: issued.key, spend: 0.02 });
    await client.updateKey({ key: issued.key, maxBudget: 0.01 });
    const over = await proxyCall('/chat/completions', issued.key, {
      model: 'placeholder',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const overText = await over.text();
    console.log(`over cap: HTTP ${over.status} ${show(overText).slice(0, 200)}`);
    check(
      'the cap is enforced: the call is rejected with budget_exceeded',
      over.status === 429 && overText.includes('budget_exceeded'),
    );

    console.log('\n-- revoke: the key stops working --');
    await client.revokeKey(issued.key);
    const afterRevoke = await proxyCall('/v1/models', issued.key);
    const afterText = await afterRevoke.text();
    console.log(`after revoke: HTTP ${afterRevoke.status} ${show(afterText).slice(0, 120)}`);
    check('a revoked key is rejected', afterRevoke.status === 401);
    key = undefined;

    console.log('\n-- BYOK registration probe (/model/new), informational --');
    const modelResponse = await fetch(`${BASE_URL}/model/new`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MASTER_KEY}`,
      },
      body: JSON.stringify({
        model_name: 'probe-byok',
        litellm_params: { model: 'openai/placeholder', api_key: 'sk-user-owned-fake-provider-key' },
      }),
    });
    const modelText = await modelResponse.text();
    console.log(`/model/new: HTTP ${modelResponse.status} ${show(modelText).slice(0, 200)}`);
  } finally {
    if (key !== undefined) {
      try {
        await client.revokeKey(key);
        console.log(`cleaned up virtual key ${alias}`);
      } catch (error) {
        console.error(`could not clean up ${alias}: ${show(String(error))}`);
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

async function guarded(): Promise<void> {
  if (process.env.GALENA_LITELLM_INTEGRATION !== '1') {
    console.log('skipped: set GALENA_LITELLM_INTEGRATION=1 to run against a live LiteLLM');
    return;
  }
  await main();
}

await guarded();
